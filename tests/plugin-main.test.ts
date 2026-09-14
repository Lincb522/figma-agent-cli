import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { fixture } from './figma-fixture.js';

async function boot(readFailure = false, startupFailure = false) {
  const { api, page } = fixture();
  const messages: any[] = [];
  const events = new Map<string, () => void>();
  const host = api as any;
  host.showUI = () => {};
  host.ui = { postMessage: (message: any) => messages.push(message) };
  host.on = (name: string, callback: () => void) => { if (startupFailure) throw new Error('Synthetic event registration failure'); events.set(name, callback); };
  const root = host.root;
  Object.defineProperty(host, 'root', { get() { if (readFailure) throw new Error('Synthetic document read failure'); return root; } });
  runInNewContext(await readFile('dist/plugin/code.js', 'utf8'), { figma: host, __html__: '<p>UI fixture</p>', console: { error() {} } });
  return { host, page, messages, events, recover: () => { readFailure = false; } };
}
test('built plugin sends initial context without waiting for ready and refreshes page changes', async () => {
  const { host, page, messages, events } = await boot();
  assert.equal(messages[0]?.type, 'runtime-ready');
  assert.equal(messages[0].version, JSON.parse(await readFile('package.json', 'utf8')).version);
  assert.equal(messages[1]?.type, 'context');
  assert.equal(messages[1].context.document, 'Fixture');
  page.name = 'Updated page'; events.get('currentpagechange')!();
  assert.equal(messages.at(-1).context.page, 'Updated page');
  await host.ui.onmessage({ type: 'context' });
  assert.equal(messages.at(-1).context.pageId, page.id);
});
test('document read failure reaches the panel and a later explicit request can recover', async () => {
  const { host, messages, recover } = await boot(true);
  assert.equal(messages[1]?.type, 'context-error');
  assert.match(messages[1].error.message, /Synthetic document read failure/);
  await host.ui.onmessage({ type: 'ready' });
  assert.equal(messages.at(-1).type, 'context-error');
  recover(); await host.ui.onmessage({ type: 'context' });
  assert.equal(messages.at(-1).type, 'context'); assert.equal(messages.at(-1).context.document, 'Fixture');
});

test('startup errors after opening the UI reach the panel with the actual cause', async () => {
  const { messages } = await boot(false, true);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, 'runtime-error');
  assert.match(messages[0].error.message, /Synthetic event registration failure/);
});
