import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Broker } from '../src/bridge/broker.js';
import type { Command } from '../src/protocol.js';
const context = { document: 'Test', page: 'Page 1', pageId: '0:1', selection: [] };
const command = (id: string, timeoutMs = 1000): Command => ({ id, method: 'document', params: {}, timeoutMs });

test('same request ID is dispatched once and duplicate callers receive the same result', async t => {
  const b = new Broker(); t.after(() => b.close()); const s = b.register(context);
  const one = b.submit(command('one')); const two = b.submit(command('one'));
  const dispatched = await b.poll(s).promise; assert.equal(dispatched?.id, 'one');
  b.result(s, { ok: true, id: 'one', result: { count: 1 } });
  assert.deepEqual(await one, await two); assert.deepEqual(await b.submit(command('one')), await one);
  assert.throws(() => b.submit({ ...command('one'), params: { changed: true } }), /already used/);
});
test('commands execute serially within the target file', async t => {
  const b = new Broker(); t.after(() => b.close()); const s = b.register(context);
  const one = b.submit(command('one')); const two = b.submit(command('two'));
  assert.equal((await b.poll(s).promise)?.id, 'one');
  const waiting = b.poll(s); assert.equal(b.request('two').state, 'queued');
  b.result(s, { ok: true, id: 'one', result: 1 });
  assert.equal((await waiting.promise)?.id, 'two'); b.result(s, { ok: true, id: 'two', result: 2 }); await Promise.all([one, two]);
});
test('queue expiry removes work without later execution', async t => {
  const b = new Broker(); t.after(() => b.close()); b.register(context);
  const result = await b.submit(command('expires', 30)); assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'QUEUE_TIMEOUT');
  assert.equal(b.list()[0].queued, 0); assert.equal(b.request('expires').state, 'completed');
});
test('running timeout preserves the active slot and accepts a late definitive result', async t => {
  const b = new Broker(); t.after(() => b.close()); const s = b.register(context);
  const result = b.submit(command('slow', 30)); await b.poll(s).promise;
  const timeout = await result; assert.equal(timeout.ok, false); if (!timeout.ok) assert.equal(timeout.error.code, 'EXECUTION_UNCERTAIN');
  assert.equal(b.list()[0].busy, true); assert.equal(b.request('slow').state, 'running');
  assert.deepEqual(await b.submit(command('slow')), timeout);
  b.result(s, { ok: true, id: 'slow', result: 'finished' }); assert.equal(b.list()[0].busy, false);
  assert.deepEqual(b.request('slow').reply, { ok: true, id: 'slow', result: 'finished' });
});
test('multiple documents require explicit routing and cannot supply each other’s results', async t => {
  const b = new Broker(); t.after(() => b.close()); const a = b.register(context); const other = b.register(context);
  assert.throws(() => b.submit(command('one')), /More than one/);
  const result = b.submit(command('one'), a); await b.poll(a).promise;
  assert.throws(() => b.result(other, { ok: true, id: 'one', result: 1 }), /does not belong/);
  b.result(a, { ok: true, id: 'one', result: 1 }); await result;
});
test('pause prevents already waiting polls from receiving new commands', async t => {
  const b = new Broker(); t.after(() => b.close()); const s = b.register(context); const poll = b.poll(s);
  b.pause(s, true); const reply = b.submit(command('one')); assert.equal(b.request('one').state, 'queued');
  b.pause(s, false); assert.equal((await poll.promise)?.id, 'one'); b.result(s, { ok: true, id: 'one', result: 1 }); await reply;
});
test('disconnect distinguishes dispatched operations from queued operations', async t => {
  const b = new Broker(); t.after(() => b.close()); const s = b.register(context);
  const active = b.submit(command('active')); const queued = b.submit(command('queued')); await b.poll(s).promise; b.disconnect(s);
  const a = await active; const q = await queued;
  assert.equal(a.ok, false); assert.equal(q.ok, false);
  if (!a.ok) assert.equal(a.error.code, 'EXECUTION_UNCERTAIN'); if (!q.ok) assert.equal(q.error.code, 'SESSION_GONE');
});
