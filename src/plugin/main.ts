import { fault, validateCommand, type Reply } from '../protocol.js';
import { execute, getContext } from './commands.js';
declare const __PLUGIN_VERSION__: string;

figma.showUI(__html__, { width: 368, height: 540, themeColors: true });
function start() {
  let busy = false;
  const authorizationKey = 'figma-agent.authorization.v1';
  const replies = new Map<string, { fingerprint: string; reply: Reply }>();
  const context = () => {
    let message;
    try { message = { type: 'context', context: getContext(figma) }; }
    catch (error) { message = { type: 'context-error', error: fault(error) }; }
    figma.ui.postMessage(message);
  };
  figma.on('selectionchange', context);
  figma.on('currentpagechange', context);
  figma.ui.onmessage = async message => {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'ready' || message.type === 'context') { context(); return; }
    if (message.type === 'authorization' && typeof message.id === 'string') {
      try {
        let value: unknown;
        if (message.operation === 'get') value = await figma.clientStorage.getAsync(authorizationKey);
        else if (message.operation === 'set' && typeof message.value === 'string' && /^[a-f0-9]{64}$/.test(message.value)) await figma.clientStorage.setAsync(authorizationKey, message.value);
        else if (message.operation === 'delete') await figma.clientStorage.deleteAsync(authorizationKey);
        else throw new Error('Invalid authorization storage operation.');
        figma.ui.postMessage({ type: 'authorization-result', id: message.id, ok: true, value });
      } catch {
        figma.ui.postMessage({ type: 'authorization-result', id: message.id, ok: false });
      }
      return;
    }
    if (message.type !== 'command') return;
    const id = message.command?.id ?? '';
    let reply: Reply;
    let ownsBusy = false;
    let fingerprint = '';
    try {
      const command = validateCommand(message.command);
      fingerprint = JSON.stringify({ method: command.method, params: command.params });
      const cached = replies.get(id);
      if (cached) {
        if (cached.fingerprint !== fingerprint) throw new Error('Request ID was reused with different command data.');
        figma.ui.postMessage({ type: 'result', reply: cached.reply }); return;
      }
      if (busy) throw new Error('The previous command is still running.');
      busy = true; ownsBusy = true;
      const isMutation = ['apply', 'patch', 'delete', 'image', 'boolean', 'boolean-set', 'icon-shape', 'prototype-set', 'eval'].includes(command.method);
      if (isMutation) figma.commitUndo();
      try {
        const result = await execute(figma, command);
        const json = JSON.stringify(result ?? null);
        if (json.length > 23 * 1024 * 1024) throw new Error('Result exceeds 23 MiB. Return a smaller summary.');
        reply = { ok: true, id, result: JSON.parse(json) };
      } finally { if (isMutation) figma.commitUndo(); }
    } catch (error) { reply = { ok: false, id, error: fault(error) }; }
    finally { if (ownsBusy) busy = false; }
    if (ownsBusy) {
      replies.set(id, { fingerprint, reply });
      if (replies.size > 200) replies.delete(replies.keys().next().value!);
    }
    figma.ui.postMessage({ type: 'result', reply }); context();
  };
  // Figma queues UI messages until the iframe is loaded.
  figma.ui.postMessage({ type: 'runtime-ready', version: __PLUGIN_VERSION__ });
  context();
}
try { start(); }
catch (error) {
  const failure = fault(error);
  console.error('[Figma Agent] Initialization failed:', failure.message);
  figma.ui.postMessage({ type: 'runtime-error', version: __PLUGIN_VERSION__, error: failure });
}
