import { PORT, type Command, type Context, type Reply } from '../protocol.js';
const base = `http://localhost:${PORT}`;
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let context: Context | undefined;
let token = '';
let generation = 0;
let paused = false;
let executing = false;
let pending: { id: string; resolve: (reply: Reply) => void } | undefined;
let pendingContext: { resolve: (context: Context) => void; reject: (error: ConnectionError) => void } | undefined;
let contextFailure = false;
let startupFailure: ConnectionError | undefined;
const diagnostic = { received: 0, invalidContext: 0, source: '尚未收到', main: '尚未收到启动响应' };
function showDiagnostics() {
  el('diagnostics').hidden = false;
  el<HTMLDetailsElement>('diagnostics').open = true;
  el('diagnostic-text').textContent = `面板 ${document.body.dataset.version}；主线程：${diagnostic.main}；插件消息 ${diagnostic.received} 条；无效文档信息 ${diagnostic.invalidContext} 条；最近来源：${diagnostic.source}。`;
}
const send = (message: unknown) => parent.postMessage({ pluginMessage: message }, '*');
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function status(text: string, state: string) { el('status').textContent = text; el('dot').dataset.state = state; }
function error(message = '') { el('error').textContent = message; el('error').hidden = !message; }
function log(message: string) {
  el('empty').hidden = true;
  const li = document.createElement('li'); const span = document.createElement('span'); span.textContent = message;
  const time = document.createElement('time'); time.textContent = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  li.append(span, time); el('activity').prepend(li);
  while (el('activity').children.length > 15) el('activity').lastElementChild?.remove();
}
class ConnectionError extends Error { constructor(message: string, public code: string) { super(message); } }
function validContext(value: any): value is Context {
  return value && typeof value.document === 'string' && typeof value.page === 'string' && typeof value.pageId === 'string' && value.pageId.length > 0 && Array.isArray(value.selection) && value.selection.every((node: any) => node && typeof node.id === 'string' && typeof node.name === 'string' && typeof node.type === 'string');
}
async function requireContext(): Promise<Context> {
  if (startupFailure) throw startupFailure;
  if (context) return context;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingContext = undefined;
      showDiagnostics();
      reject(new ConnectionError('未收到 Figma 文件信息。请将下方连接诊断和插件开发控制台的首条错误提供给开发者。', 'CONTEXT_TIMEOUT'));
    }, 6000);
    pendingContext = {
      resolve(value) { clearTimeout(timer); pendingContext = undefined; resolve(value); },
      reject(error) { clearTimeout(timer); pendingContext = undefined; reject(error); },
    };
    send({ type: 'context' });
  });
}
async function post(path: string, data: unknown, credential = token, timeout = 28_000): Promise<any> {
  const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(credential ? { Authorization: `Bearer ${credential}` } : {}) }, body: JSON.stringify(data), signal: AbortSignal.timeout(timeout) });
  const result = await response.json();
  if (!response.ok || result.ok === false) throw new ConnectionError(result.error?.message ?? '本地 CLI 请求失败。', result.error?.code ?? 'CONNECTION_FAILED');
  return result;
}
function disconnected(message?: string) {
  generation++; token = ''; paused = false; executing = false;
  el('pair-form').hidden = false; el('connected').hidden = true;
  el<HTMLButtonElement>('connect').disabled = false;
  status(message ? '连接中断' : '未连接', message ? 'error' : 'disconnected');
  error(message ?? '');
}
async function heartbeat(g: number) {
  while (g === generation && token) {
    send({ type: 'context' });
    try { await post('/plugin/heartbeat', { context }, token, 6000); }
    catch (e) { if (g === generation && e instanceof ConnectionError && ['SESSION_GONE','UNAUTHORIZED'].includes(e.code)) { disconnected('会话已结束，请重新生成配对码并连接。'); return; } }
    await delay(10_000);
  }
}
async function listen(g: number) {
  let failures = 0;
  while (g === generation && token) {
    if (paused) { await delay(250); continue; }
    try {
      const { command }: { command: Command | null } = await post('/plugin/poll', {});
      if (g !== generation) return;
      failures = 0;
      if (!command) { status(paused ? '已暂停接收' : '已连接，等待命令', paused ? 'paused' : 'connected'); continue; }
      executing = true; el<HTMLButtonElement>('disconnect').disabled = true;
      status(`正在执行 ${command.method}`, 'running'); log(`${command.method} · 执行中`);
      const result = new Promise<Reply>(resolve => { pending = { id: command.id, resolve }; });
      send({ type: 'command', command });
      const reply = await result; pending = undefined;
      if (g !== generation) return;
      // Retry delivery of this result only. Never repeat a document mutation after a lost response.
      let delivered = false;
      for (let attempt = 0; attempt < 6 && g === generation; attempt++) {
        try { await post('/plugin/result', reply, token, 6000); delivered = true; break; }
        catch (e) {
          if (e instanceof ConnectionError && ['SESSION_GONE', 'UNAUTHORIZED', 'UNKNOWN_REQUEST'].includes(e.code)) throw e;
          status('正在重传执行结果', 'error'); await delay(Math.min(1000 * 2 ** attempt, 6000));
        }
      }
      if (!delivered) throw new ConnectionError('命令已在 Figma 执行，但结果未送达。重新连接后请先检查画布。', 'RESULT_UNDELIVERED');
      executing = false; el<HTMLButtonElement>('disconnect').disabled = false;
      log(`${command.method} · ${reply.ok ? '完成' : '失败'}`);
      if (!reply.ok) error(`${reply.error.message}${reply.error.recovery ? ' ' + reply.error.recovery : ''}`); else error();
      status(paused ? '已暂停接收' : '已连接，等待命令', paused ? 'paused' : 'connected');
    } catch (e) {
      if (g !== generation) return;
      failures++;
      if (executing || (e instanceof ConnectionError && ['SESSION_GONE','UNAUTHORIZED'].includes(e.code)) || failures >= 6) { disconnected(e instanceof ConnectionError ? e.message + ' 运行 npm run cli -- pair 重新配对。' : '无法连接本地 CLI。请确认 npm start 正在运行，并重新配对。'); return; }
      status('连接暂时中断，正在重连', 'error'); await delay(Math.min(1000 * 2 ** failures, 10_000));
    }
  }
}
window.addEventListener('message', event => {
  // Figma guarantees the pluginMessage envelope, not a particular Window source.
  const message = event.data?.pluginMessage;
  if (!message || typeof message !== 'object' || typeof message.type !== 'string') return;
  diagnostic.received++;
  diagnostic.source = event.source === null ? '空来源' : event.source === window ? '当前窗口' : event.source === parent ? '父窗口' : event.source === top ? '顶层窗口' : '宿主转发窗口';
  if (message.type === 'runtime-ready' && typeof message.version === 'string') diagnostic.main = `${message.version} 已启动`;
  if (message.type === 'context' && !validContext(message.context)) diagnostic.invalidContext++;
  if (message.type === 'runtime-error' && typeof message.error?.message === 'string') {
    diagnostic.main = '初始化失败';
    startupFailure = new ConnectionError(`插件主线程初始化失败：${message.error.message}。请将连接诊断提供给开发者。`, 'STARTUP_FAILED');
    context = undefined; contextFailure = true;
    el('document').textContent = '插件初始化失败'; el('page').textContent = '查看下方错误和连接诊断';
    error(startupFailure.message); showDiagnostics(); pendingContext?.reject(startupFailure);
  }
  if (message?.type === 'context' && validContext(message.context)) {
    context = message.context;
    el('document').textContent = context!.document; el('page').textContent = context!.page;
    el('selection').textContent = context!.selection.length ? `已选择 ${context!.selection.length} 个图层` : '尚未选择图层';
    if (contextFailure) { error(); contextFailure = false; }
    el('diagnostics').hidden = true;
    pendingContext?.resolve(context!);
  }
  if (message?.type === 'context-error' && typeof message.error?.message === 'string') {
    context = undefined; contextFailure = true;
    el('document').textContent = '无法读取 Figma 文件'; el('page').textContent = '点击连接可重新读取';
    const failure = new ConnectionError(`读取 Figma 文件失败：${message.error.message}。点击连接重试。`, 'CONTEXT_FAILED');
    if (pendingContext) pendingContext.reject(failure); else error(failure.message);
    showDiagnostics();
  }
  if (message?.type === 'result' && message.reply?.id === pending?.id) pending?.resolve(message.reply);
  if (!el('diagnostics').hidden) showDiagnostics();
});
el<HTMLFormElement>('pair-form').addEventListener('submit', async event => {
  event.preventDefault(); error();
  if (el<HTMLButtonElement>('connect').disabled) return;
  el<HTMLButtonElement>('connect').disabled = true;
  try {
    status(context ? '正在连接本地 CLI' : '正在读取 Figma 文件', 'connecting');
    const current = await requireContext();
    status('正在连接本地 CLI', 'connecting');
    const result = await post('/pair', { code: el<HTMLInputElement>('code').value, context: current }, '', 6000);
    token = result.token; const g = ++generation; paused = false;
    el<HTMLInputElement>('code').value = ''; el('pair-form').hidden = true; el('connected').hidden = false;
    el('session').textContent = result.sessionId; el('pause').textContent = '暂停接收'; el<HTMLButtonElement>('disconnect').disabled = false;
    status('已连接，等待命令', 'connected'); log('已连接此文件');
    void heartbeat(g); void listen(g);
  } catch (e) {
    if (e instanceof ConnectionError && ['CONTEXT_TIMEOUT', 'CONTEXT_FAILED', 'STARTUP_FAILED'].includes(e.code)) { contextFailure = true; disconnected(e.message); showDiagnostics(); }
    else disconnected(e instanceof ConnectionError ? (e.code === 'INVALID_PAIRING_CODE' ? '配对码不正确，请检查终端中的六位数字。' : '配对失败。请运行 npm run cli -- pair 获取新配对码。') : '无法连接本地 CLI。请先运行 npm start，并允许 Figma 访问本地网络。');
  }
});
el('pause').addEventListener('click', async () => {
  const button = el<HTMLButtonElement>('pause'); button.disabled = true;
  try {
    const next = !paused; await post('/plugin/pause', { paused: next }, token, 6000); paused = next;
    button.textContent = paused ? '继续接收' : '暂停接收';
    status(executing && paused ? '当前命令完成后暂停' : paused ? '已暂停接收' : '已连接，等待命令', paused ? 'paused' : 'connected');
  } catch { error('暂停状态未能更新，请检查本地 CLI 连接。'); }
  finally { button.disabled = false; }
});
el('disconnect').addEventListener('click', async () => { const old = token; disconnected(); try { await post('/plugin/disconnect', {}, old, 3000); } catch { /* A disconnected session also expires on the bridge. */ } });
send({ type: 'ready' });
