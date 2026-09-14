import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { AgentError, fault, MAX_BODY, PORT, VERSION, validateCommand, type Context } from '../protocol.js';
import { Broker } from './broker.js';

function equal(a: string, b: string) { const left = Buffer.from(a); const right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right); }
function send(res: ServerResponse, status: number, value: unknown) { if (!res.destroyed) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); } }
async function body(req: IncomingMessage) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new AgentError('INVALID_CONTENT_TYPE', 'Content-Type must be application/json.');
  let bytes = 0; const chunks: Buffer[] = [];
  for await (const chunk of req) { bytes += chunk.length; if (bytes > MAX_BODY) throw new AgentError('BODY_TOO_LARGE', 'Request exceeds 24 MiB.'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new AgentError('INVALID_JSON', 'The request is not valid JSON.'); }
}
function context(input: any): Context {
  if (!input || typeof input.document !== 'string' || typeof input.page !== 'string' || typeof input.pageId !== 'string' || !Array.isArray(input.selection)) throw new AgentError('INVALID_CONTEXT', 'Invalid Figma document context.');
  return { document: input.document.slice(0,500), page: input.page.slice(0,500), pageId: input.pageId.slice(0,100), selection: input.selection.slice(0,100).map((n: any) => ({ id: String(n.id).slice(0,100), name: String(n.name).slice(0,500), type: String(n.type).slice(0,100) })) };
}
export async function startBridge(options: { port?: number; token?: string; pairingCode?: string } = {}) {
  const token = options.token ?? randomBytes(32).toString('hex');
  const broker = new Broker();
  let pin = options.pairingCode ?? String(randomInt(100000, 1000000));
  let pinExpiry = Date.now() + 10 * 60_000;
  let attempts = 0;
  const pluginTokens = new Map<string, string>();
  const server = createServer((req, res) => { void (async () => {
    const host = req.headers.host;
    const expectedHost = `127.0.0.1:${(server.address() as { port: number }).port}`;
    const pluginHost = `localhost:${(server.address() as { port: number }).port}`;
    if (host !== expectedHost && host !== pluginHost) return send(res, 403, { ok: false, error: { code: 'INVALID_HOST', message: 'Only localhost or 127.0.0.1 with the bridge port is accepted.' } });
    const origin = req.headers.origin;
    if (origin && origin !== 'null' && origin !== 'https://www.figma.com' && origin !== `http://${expectedHost}` && origin !== `http://${pluginHost}`) return send(res, 403, { ok: false, error: { code: 'INVALID_ORIGIN', message: 'Origin is not permitted.' } });
    if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    const url = new URL(req.url ?? '/', `http://${expectedHost}`);
    if (url.pathname === '/health' && req.method === 'GET') return send(res, 200, { ok: true, service: 'figma-agent', protocol: VERSION });
    if (url.pathname === '/pair' && req.method === 'POST') {
      const input = await body(req);
      if (attempts >= 10 || Date.now() > pinExpiry) throw new AgentError('PAIRING_EXPIRED', 'The pairing code expired or too many attempts were made.', 'Run figma-agent pair to generate a new code.');
      attempts++;
      if (typeof input.code !== 'string' || !equal(input.code, pin)) throw new AgentError('INVALID_PAIRING_CODE', 'The pairing code is incorrect.', 'Enter the six-digit code from the local terminal.');
      const c = context(input.context);
      pinExpiry = 0;
      const sessionId = broker.register(c); const pluginToken = randomBytes(32).toString('hex'); pluginTokens.set(pluginToken, sessionId);
      return send(res, 200, { ok: true, sessionId, token: pluginToken, protocol: VERSION });
    }
    const bearer = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
    const cli = equal(bearer, token);
    const sessionId = pluginTokens.get(bearer);
    if (!cli && !sessionId) return send(res, 401, { ok: false, error: { code: 'UNAUTHORIZED', message: 'Authentication is required.', recovery: 'Reconnect the plugin or restart the CLI bridge.' } });
    if (url.pathname.startsWith('/plugin/')) {
      if (!sessionId) throw new AgentError('ROLE_MISMATCH', 'A plugin session is required.');
      if (req.method !== 'POST') throw new AgentError('METHOD_NOT_ALLOWED', 'Use POST.');
      const input = await body(req);
      if (url.pathname === '/plugin/poll') {
        const poll = broker.poll(sessionId); res.on('close', poll.cancel);
        const command = await poll.promise; res.off('close', poll.cancel); return send(res, 200, { ok: true, command });
      }
      if (url.pathname === '/plugin/heartbeat') { broker.touch(sessionId, context(input.context)); return send(res, 200, { ok: true }); }
      if (url.pathname === '/plugin/pause') { if (typeof input.paused !== 'boolean') throw new AgentError('INVALID_PAUSE', 'paused must be a boolean.'); broker.pause(sessionId, input.paused); return send(res, 200, { ok: true }); }
      if (url.pathname === '/plugin/result') {
        if (!input || typeof input.id !== 'string' || typeof input.ok !== 'boolean' || (!input.ok && (!input.error || typeof input.error.message !== 'string' || typeof input.error.code !== 'string'))) throw new AgentError('INVALID_RESULT', 'Invalid plugin result.');
        broker.result(sessionId, input); return send(res, 200, { ok: true });
      }
      if (url.pathname === '/plugin/disconnect') { broker.disconnect(sessionId); pluginTokens.delete(bearer); return send(res, 200, { ok: true }); }
    } else {
      if (!cli) throw new AgentError('ROLE_MISMATCH', 'A local CLI credential is required.');
      if (url.pathname === '/sessions' && req.method === 'GET') return send(res, 200, { ok: true, result: broker.list() });
      if (url.pathname.startsWith('/requests/') && req.method === 'GET') return send(res, 200, { ok: true, result: broker.request(decodeURIComponent(url.pathname.slice(10))) });
      if (url.pathname === '/pairing' && req.method === 'POST') {
        await body(req); pin = String(randomInt(100000, 1000000)); pinExpiry = Date.now() + 600_000; attempts = 0;
        return send(res, 200, { ok: true, result: { code: pin, expiresAt: pinExpiry } });
      }
      if (url.pathname === '/commands' && req.method === 'POST') { const input = await body(req); const command = validateCommand(input); return send(res, 200, await broker.submit(command, input.sessionId)); }
    }
    send(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'Unknown endpoint.' } });
  })().catch(error => send(res, 400, { ok: false, error: fault(error) })); });
  server.requestTimeout = 30_000;
  try { await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? PORT, '127.0.0.1', () => { server.off('error', reject); resolve(); }); }); }
  catch (error) { broker.close(); throw error; }
  return { server, broker, token, pairingCode: pin, port: (server.address() as { port: number }).port, async close() { broker.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
