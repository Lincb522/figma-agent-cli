import { randomUUID } from 'node:crypto';
import { setInterval, clearInterval, setTimeout, clearTimeout } from 'node:timers';
import { AgentError, type Command, type Context, type Reply } from '../protocol.js';

interface Job {
  command: Command; fingerprint: string; sessionId: string;
  state: 'queued' | 'running' | 'completed'; result?: Reply;
  waiters: ((reply: Reply) => void)[]; timer: ReturnType<typeof setTimeout>;
}
interface Session { id: string; context: Context; lastSeen: number; active?: string; paused?: boolean; queue: string[]; poll?: (command: Command | null) => void }
export class Broker {
  private sessions = new Map<string, Session>();
  private jobs = new Map<string, Job>();
  private sweep = setInterval(() => this.expire(), 10_000);
  constructor() { (this.sweep as unknown as NodeJS.Timeout).unref(); }
  register(context: Context) {
    const id = randomUUID();
    this.sessions.set(id, { id, context, lastSeen: Date.now(), queue: [] });
    return id;
  }
  private session(id: string) {
    const session = this.sessions.get(id);
    if (!session) throw new AgentError('SESSION_GONE', 'The Figma plugin session has ended.', 'Reconnect the plugin and run sessions.');
    return session;
  }
  list() {
    this.expire();
    return [...this.sessions.values()].map(s => ({ id: s.id, ...s.context, lastSeen: s.lastSeen, busy: !!s.active, queued: s.queue.length }));
  }
  touch(id: string, context?: Context) { const s = this.session(id); s.lastSeen = Date.now(); if (context) s.context = context; }
  pause(id: string, paused: boolean) { const s = this.session(id); s.paused = paused; this.deliver(s); }
  private deliver(s: Session) {
    if (s.active || s.paused || !s.poll) return;
    const id = s.queue.shift();
    if (!id) return;
    const job = this.jobs.get(id)!;
    job.state = 'running'; s.active = id;
    const poll = s.poll; s.poll = undefined; poll(job.command);
  }
  poll(id: string): { promise: Promise<Command | null>; cancel: () => void } {
    const s = this.session(id); this.touch(id);
    if (s.poll) throw new AgentError('ALREADY_POLLING', 'This session already has a pending poll.');
    let resolve!: (c: Command | null) => void;
    const promise = new Promise<Command | null>(r => { resolve = r; });
    const timer = setTimeout(() => { if (s.poll === complete) s.poll = undefined; resolve(null); }, 20_000);
    const complete = (c: Command | null) => { clearTimeout(timer); resolve(c); };
    s.poll = complete; this.deliver(s);
    return { promise, cancel: () => { if (s.poll === complete) s.poll = undefined; complete(null); } };
  }
  submit(command: Command, target?: string): Promise<Reply> {
    const old = this.jobs.get(command.id);
    const fingerprint = JSON.stringify({ method: command.method, params: command.params });
    if (old) {
      if (old.fingerprint !== fingerprint || (target && old.sessionId !== target)) throw new AgentError('REQUEST_ID_CONFLICT', 'This request ID was already used for another command or session.');
      if (old.result) return Promise.resolve(old.result);
      return new Promise(resolve => old.waiters.push(resolve));
    }
    this.expire();
    if (this.jobs.size >= 5000) throw new AgentError('HISTORY_FULL', 'This bridge has reached 5000 requests.', 'Finish pending work, then restart the bridge.');
    if (!target) {
      if (this.sessions.size !== 1) throw new AgentError(this.sessions.size ? 'AMBIGUOUS_SESSION' : 'NO_SESSION', this.sessions.size ? 'More than one Figma file is connected.' : 'No Figma plugin is connected.', 'Open the plugin, pair it, then pass --session from figma-agent sessions.');
      target = this.sessions.keys().next().value!;
    }
    const s = this.session(target);
    if (s.queue.length >= 100) throw new AgentError('QUEUE_FULL', 'This Figma session already has 100 queued commands.');
    const promise = new Promise<Reply>(resolve => {
      const timer = setTimeout(() => {
        const job = this.jobs.get(command.id)!;
        if (job.state === 'completed') return;
        const running = job.state === 'running';
        const reply: Reply = { ok: false, id: command.id, error: { code: running ? 'EXECUTION_UNCERTAIN' : 'QUEUE_TIMEOUT', message: running ? 'The plugin did not return before the deadline; the command may still be running.' : 'The command expired before execution and was removed from the queue.', recovery: running ? 'Do not rerun with a new ID. Use request <id> to check the outcome; inspect Figma before retrying.' : 'Submit a new request when the session is available.' } };
        if (!running) { job.state = 'completed'; s.queue = s.queue.filter(id => id !== command.id); }
        job.result = reply;
        for (const waiter of job.waiters.splice(0)) waiter(reply);
      }, command.timeoutMs);
      this.jobs.set(command.id, { command, fingerprint, sessionId: target!, state: 'queued', timer, waiters: [resolve] });
    });
    s.queue.push(command.id); this.deliver(s);
    return promise;
  }
  result(sessionId: string, reply: Reply) {
    const s = this.session(sessionId); this.touch(sessionId);
    const job = this.jobs.get(reply.id);
    if (!job || job.sessionId !== sessionId) throw new AgentError('UNKNOWN_REQUEST', 'This result does not belong to this session.');
    if (job.state === 'completed') return;
    if (s.active !== reply.id) throw new AgentError('NOT_RUNNING', 'This request has not been dispatched.');
    clearTimeout(job.timer); job.state = 'completed'; job.result = reply; s.active = undefined;
    for (const waiter of job.waiters.splice(0)) waiter(reply);
    this.deliver(s);
  }
  request(id: string) {
    const job = this.jobs.get(id);
    if (!job) throw new AgentError('UNKNOWN_REQUEST', 'No request with this ID exists in this bridge process.', 'Request history is retained only until the bridge stops. Inspect the document before resubmitting a mutation.');
    return { id, state: job.state, sessionId: job.sessionId, reply: job.result };
  }
  disconnect(id: string) {
    const s = this.sessions.get(id); if (!s) return;
    s.poll?.(null);
    for (const requestId of [...s.queue, ...(s.active ? [s.active] : [])]) {
      const job = this.jobs.get(requestId)!; clearTimeout(job.timer);
      const wasRunning = job.state === 'running'; job.state = 'completed';
      job.result = { ok: false, id: requestId, error: { code: wasRunning ? 'EXECUTION_UNCERTAIN' : 'SESSION_GONE', message: wasRunning ? 'The plugin disconnected during execution; document changes may have occurred.' : 'The plugin disconnected before this command ran.', recovery: 'Reconnect and inspect the document before resubmitting any mutation.' } };
      for (const waiter of job.waiters.splice(0)) waiter(job.result);
    }
    this.sessions.delete(id);
  }
  private expire() { for (const s of this.sessions.values()) if (Date.now() - s.lastSeen > 65_000) this.disconnect(s.id); }
  close() { clearInterval(this.sweep); for (const id of this.sessions.keys()) this.disconnect(id); }
}
