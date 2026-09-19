import pLimit from 'p-limit';
import { AgentError, fault, validateCommand, type Command, type Reply } from '../protocol.js';

export interface Route { name: string; sessionId: string; commands: Command[] }
export interface Batch { concurrency: number; routes: Route[] }
export function parseBatch(input: any, override?: number): Batch {
  const concurrency = override ?? input?.concurrency ?? 4;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32)
    throw new AgentError('INVALID_CONCURRENCY', 'concurrency must be an integer from 1 to 32.');
  if (!Array.isArray(input?.routes) || !input.routes.length || input.routes.length > 100)
    throw new AgentError('INVALID_BATCH', 'Supply 1–100 routes.');
  const names = new Set<string>(), sessions = new Set<string>(), ids = new Set<string>();
  let count = 0;
  const routes = input.routes.map((route: any): Route => {
    if (!route || typeof route.name !== 'string' || !route.name.trim() || names.has(route.name)
      || typeof route.sessionId !== 'string' || !route.sessionId.trim() || sessions.has(route.sessionId))
      throw new AgentError('INVALID_ROUTE', 'Each route needs a unique name and unique explicit sessionId. Combine steps targeting one session into one route.');
    names.add(route.name); sessions.add(route.sessionId);
    if (!Array.isArray(route.commands) || !route.commands.length) throw new AgentError('INVALID_ROUTE', 'Each route needs commands.');
    const commands = route.commands.map((value: any) => {
      const cmd = validateCommand({ ...value, timeoutMs: value?.timeoutMs ?? 60_000 });
      if (ids.has(cmd.id)) throw new AgentError('INVALID_BATCH', 'Request IDs must be unique across the batch.');
      ids.add(cmd.id);
      if (++count > 1000) throw new AgentError('INVALID_BATCH', 'A batch supports at most 1000 commands.');
      return { id: cmd.id, method: cmd.method, params: cmd.params, timeoutMs: cmd.timeoutMs };
    });
    return { name: route.name, sessionId: route.sessionId, commands };
  });
  return { concurrency, routes };
}

// Limit whole routes, not individual steps: a busy document cannot consume every slot.
export async function runBatch(batch: Batch, send: (command: Command, sessionId: string) => Promise<Reply>) {
  const limit = pLimit(batch.concurrency);
  const routes = await Promise.all(batch.routes.map(route => limit(async () => {
    const results: Reply[] = [];
    for (const command of route.commands) {
      let reply: Reply;
      try { reply = await send(command, route.sessionId); }
      catch (error) { reply = { ok: false, id: command.id, error: fault(error) }; }
      results.push(reply);
      if (!reply.ok) break;
    }
    return { name: route.name, sessionId: route.sessionId, ok: results.every(r => r.ok), results,
      skipped: route.commands.slice(results.length).map(c => c.id) };
  })));
  return { ok: routes.every(r => r.ok), concurrency: batch.concurrency, routes };
}
