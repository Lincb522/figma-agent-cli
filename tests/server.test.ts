import { test } from 'node:test';
import assert from 'node:assert/strict';
import { get } from 'node:http';
import { startBridge } from '../src/bridge/server.js';
const context = { document: 'Fixture', page: 'Page', pageId: '0:1', selection: [] };
test('the Figma localhost endpoint accepts pairing and CORS without accepting other hosts or ports', async t => {
  const b = await startBridge({ port: 0, token: 'synthetic-localhost-token', pairingCode: '123456' }); t.after(() => b.close());
  const local = `http://localhost:${b.port}`;
  const preflight = await fetch(local + '/pair', { method: 'OPTIONS', headers: { Origin: 'null', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-origin'), 'null');
  assert.equal((await fetch(local + '/health', { headers: { Origin: local } })).status, 200);
  const pairing: any = await (await fetch(local + '/pair', { method: 'POST', headers: { Origin: 'null', 'Content-Type': 'application/json' }, body: JSON.stringify({ code: '123456', context }) })).json();
  assert.equal(pairing.ok, true);
  const numeric = `http://127.0.0.1:${b.port}`;
  const sessions: any = await (await fetch(numeric + '/sessions', { headers: { Authorization: 'Bearer synthetic-localhost-token' } })).json();
  assert.equal(sessions.result.length, 1);
  for (const host of [`localhost.evil.example:${b.port}`, `localhost:${b.port + 1}`, `127.0.0.1.evil.example:${b.port}`]) {
    const code = await new Promise<number | undefined>((resolve, reject) => { get(numeric + '/health', { headers: { Host: host } }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject); });
    assert.equal(code, 403);
  }
  assert.equal((await fetch(local + '/health', { headers: { Origin: `http://localhost:${b.port + 1}` } })).status, 403);
});
test('HTTP pairing, authentication, dispatch, result, and request recovery complete over real sockets', async t => {
  const b = await startBridge({ port: 0, token: 'synthetic-cli-token', pairingCode: '123456' }); t.after(() => b.close());
  const base = `http://127.0.0.1:${b.port}`;
  const post = (path: string, data: any, token?: string) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(data) });
  assert.equal((await fetch(base + '/sessions')).status, 401);
  assert.equal((await fetch(base + '/health', { headers: { Origin: 'https://unrelated.example' } })).status, 403);
  const badHost = await new Promise<number | undefined>((resolve, reject) => { get(base + '/health', { headers: { Host: 'unrelated.example' } }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject); });
  assert.equal(badHost, 403);
  const preflight = await fetch(base + '/commands', { method: 'OPTIONS', headers: { Origin: 'null' } });
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-origin'), 'null');
  assert.equal((await post('/pair', { code: '错错错错错错', context })).status, 400);
  const pairing: any = await (await post('/pair', { code: '123456', context })).json(); assert.equal(pairing.ok, true);
  assert.equal((await post('/pair', { code: '123456', context })).status, 400);
  assert.equal((await post('/commands', { id: 'bad', method: 'document', params: {}, timeoutMs: 1000 }, pairing.token)).status, 400);
  const result = post('/commands', { id: 'cmd-1', method: 'document', params: {}, timeoutMs: 2000 }, b.token);
  const poll: any = await (await post('/plugin/poll', {}, pairing.token)).json(); assert.equal(poll.command.id, 'cmd-1');
  assert.equal((await post('/plugin/result', { ok: true, id: 'cmd-1', result: { hello: 'Figma' } }, pairing.token)).status, 200);
  const reply: any = await (await result).json(); assert.deepEqual(reply.result, { hello: 'Figma' });
  const recovered: any = await (await fetch(base + '/requests/cmd-1', { headers: { Authorization: `Bearer ${b.token}` } })).json(); assert.equal(recovered.result.state, 'completed');
});
test('pairing stops accepting guesses after ten failures until local CLI rotates the code', async t => {
  const b = await startBridge({ port: 0, token: 'synthetic', pairingCode: '123456' }); t.after(() => b.close());
  const base = `http://127.0.0.1:${b.port}`;
  const pair = async (code: string) => (await fetch(base + '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, context }) })).json() as Promise<any>;
  for (let i = 0; i < 10; i++) assert.equal((await pair('000000')).error.code, 'INVALID_PAIRING_CODE');
  assert.equal((await pair('123456')).error.code, 'PAIRING_EXPIRED');
  const rotated: any = await (await fetch(base + '/pairing', { method: 'POST', headers: { Authorization: 'Bearer synthetic', 'Content-Type': 'application/json' }, body: '{}' })).json();
  assert.equal((await pair(rotated.result.code)).ok, true);
});
