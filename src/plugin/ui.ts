import { PORT, type Command, type Context, type Reply } from '../protocol.js';
const base = `http://localhost:${PORT}`;
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let context: Context | undefined;
let token = '';
let resumeToken = '';
// getRandomValues also works in iframe contexts where randomUUID is unavailable.
function messageId() { return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join(''); }
let instanceId = messageId();
const requests = new Set<AbortController>();
let connecting = false;
let resumePaused = false;
const storageRequests = new Map<string, (message: any) => void>();
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
function storage(operation: 'get' | 'set' | 'delete', value?: string): Promise<unknown> {
  const id = messageId();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { storageRequests.delete(id); reject(new ConnectionError('Figma 未响应授权存储请求。请关闭并重新打开插件。', 'STORAGE_FAILED')); }, 6000);
    storageRequests.set(id, message => {
      clearTimeout(timer); storageRequests.delete(id);
      if (message.ok) resolve(message.value);
      else reject(new ConnectionError('无法读写 Figma 本机授权。请检查本机存储，或关闭并重新打开插件。', 'STORAGE_FAILED'));
    });
    send({ type: 'authorization', operation, id, value });
  });
}
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
  const controller = new AbortController(); requests.add(controller);
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(credential ? { Authorization: `Bearer ${credential}` } : {}) }, body: JSON.stringify(data), signal: controller.signal });
    const result = await response.json();
    if (!response.ok || result.ok === false) throw new ConnectionError(result.error?.message ?? '本地 CLI 请求失败。', result.error?.code ?? 'CONNECTION_FAILED');
    return result;
  } finally { clearTimeout(timer); requests.delete(controller); }
}
function disconnected(message?: string) {
  generation++; token = ''; paused = false; executing = false; connecting = false;
  pendingContext?.reject(new ConnectionError('连接已取消。', 'CANCELLED'));
  for (const request of requests) request.abort();
  el('pair-form').hidden = !!resumeToken; el('connected').hidden = true;
  el('remembered').hidden = !resumeToken; el('forget').hidden = !resumeToken;
  el('stop-reconnect').hidden = true;
  el<HTMLButtonElement>('retry').disabled = false; el<HTMLButtonElement>('forget').disabled = false;
  el<HTMLButtonElement>('connect').disabled = false;
  status(message ? '连接中断' : '未连接', message ? 'error' : 'disconnected');
  error(message ?? '');
}
async function activate(result: any, g: number, warning = '') {
  if (g !== generation) return;
  token = result.token; paused = resumePaused;
  if (paused) await post('/plugin/pause', { paused: true }, token, 6000);
  if (g !== generation) return;
  connecting = false;
  el<HTMLInputElement>('code').value = ''; el('pair-form').hidden = true; el('remembered').hidden = true; el('connected').hidden = false;
  el('stop-reconnect').hidden = true;
  el('forget').hidden = !resumeToken; el<HTMLButtonElement>('forget').disabled = false;
  el('session').textContent = result.sessionId; el('pause').textContent = paused ? '继续接收' : '暂停接收'; el<HTMLButtonElement>('disconnect').disabled = false;
  el('persistence').textContent = resumeToken ? '已记住此设备。重开插件或切换文件后自动连接。' : '此连接尚未持久化。';
  status(paused ? '已暂停接收' : '已连接，等待命令', paused ? 'paused' : 'connected'); error(warning); log('已连接此文件');
  void heartbeat(g); void listen(g);
}
async function resume(retired: Promise<unknown> = Promise.resolve(), notice = '') {
  if (connecting || !resumeToken) return;
  connecting = true; const g = ++generation;
  const attemptInstance = instanceId;
  el('pair-form').hidden = true; el('remembered').hidden = false;
  el('stop-reconnect').hidden = false;
  el<HTMLButtonElement>('retry').disabled = true; el<HTMLButtonElement>('forget').disabled = true;
  error(notice);
  status('正在恢复已保存的连接', 'connecting');
  await retired;
  for (let attempt = 0; g === generation && resumeToken; attempt++) {
    try {
      status(attempt ? '等待本地 CLI，正在重试' : '正在恢复已保存的连接', 'connecting');
      const current = await requireContext();
      const result = await post('/resume', { context: current, instanceId: attemptInstance }, resumeToken, 6000);
      if (g !== generation) { void post('/plugin/disconnect', {}, result.token, 3000).catch(() => {}); return; }
      await activate(result, g, notice); return;
    } catch (e) {
      if (g !== generation) return;
      if (e instanceof ConnectionError && e.code === 'AUTHORIZATION_REVOKED') {
        resumeToken = '';
        try { await storage('delete'); } catch { /* The invalid grant cannot authorize another connection. */ }
        disconnected('此设备的绑定已失效。让 Agent 获取新配对码，再填写一次即可。'); return;
      }
      if (e instanceof ConnectionError && ['CONTEXT_TIMEOUT', 'CONTEXT_FAILED', 'STARTUP_FAILED'].includes(e.code)) { disconnected(e.message); showDiagnostics(); return; }
      error('本地 CLI 暂时不可用，正在自动重连。启动 CLI 后会恢复，无需新配对码。');
      await delay(Math.min(500 * 2 ** Math.min(attempt, 5), 15_000));
    }
  }
}
function connectionLost(message: string) {
  const uncertain = executing;
  const notice = uncertain ? '命令可能已在 Figma 执行，结果未确认。请让 agent 检查画布后再继续；不要重复发送该命令。' : '';
  const old = token;
  resumePaused = paused;
  instanceId = messageId();
  disconnected(notice || message);
  if (uncertain) log('上一条命令结果未确认，请检查画布');
  // Retire the old poll/queue before another session can accept work for this panel.
  const retired = old ? post('/plugin/disconnect', {}, old, 3000).catch(() => {}) : Promise.resolve();
  if (resumeToken) void resume(retired, notice);
}
async function heartbeat(g: number) {
  while (g === generation && token) {
    send({ type: 'context' });
    try { await post('/plugin/heartbeat', { context }, token, 6000); }
    catch { if (g === generation && !executing) { connectionLost('连接中断，正在自动恢复。'); return; } }
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
      executing = true; el<HTMLButtonElement>('disconnect').disabled = true; el<HTMLButtonElement>('forget').disabled = true;
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
      executing = false; el<HTMLButtonElement>('disconnect').disabled = false; el<HTMLButtonElement>('forget').disabled = false;
      log(`${command.method} · ${reply.ok ? '完成' : '失败'}`);
      if (!reply.ok) error(`${reply.error.message}${reply.error.recovery ? ' ' + reply.error.recovery : ''}`); else error();
      status(paused ? '已暂停接收' : '已连接，等待命令', paused ? 'paused' : 'connected');
    } catch (e) {
      if (g !== generation) return;
      failures++;
      if (executing || (e instanceof ConnectionError && ['SESSION_GONE','UNAUTHORIZED'].includes(e.code)) || failures >= 6) { connectionLost('无法连接本地 CLI。请确认 npm start 正在运行。'); return; }
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
  if (message.type === 'authorization-result' && typeof message.id === 'string') storageRequests.get(message.id)?.(message);
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
  const g = ++generation; connecting = true; resumePaused = false;
  el<HTMLButtonElement>('connect').disabled = true;
  try {
    status(context ? '正在连接本地 CLI' : '正在读取 Figma 文件', 'connecting');
    const current = await requireContext();
    status('正在连接本地 CLI', 'connecting');
    const result = await post('/pair', { code: el<HTMLInputElement>('code').value, context: current, instanceId }, '', 6000);
    let warning = '';
    if (typeof result.resumeToken === 'string' && /^[a-f0-9]{64}$/.test(result.resumeToken)) {
      try { await storage('set', result.resumeToken); resumeToken = result.resumeToken; }
      catch { warning = '已连接，但授权未能保存。重开插件后需要重新配对；请检查 Figma 本机存储。'; }
    } else warning = '当前 CLI 版本不支持保存绑定。请更新并重启 CLI，再配对一次。';
    await activate(result, g, warning);
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
el('disconnect').addEventListener('click', async () => { const old = token; resumePaused = false; instanceId = messageId(); disconnected(); try { await post('/plugin/disconnect', {}, old, 3000); } catch { /* A disconnected session also expires on the bridge. */ } });
el('retry').addEventListener('click', () => { void resume(); });
el('stop-reconnect').addEventListener('click', () => { const old = token; instanceId = messageId(); disconnected('自动重连已停止。点击“重试连接”可继续。'); if (old) void post('/plugin/disconnect', {}, old, 3000).catch(() => {}); });
el('forget').addEventListener('click', async () => {
  disconnected(); connecting = true;
  el<HTMLButtonElement>('retry').disabled = true;
  el<HTMLButtonElement>('forget').disabled = true;
  try {
    if (resumeToken) {
      try { await post('/forget', {}, resumeToken, 6000); }
      catch (e) { if (!(e instanceof ConnectionError) || e.code !== 'AUTHORIZATION_REVOKED') throw e; }
    }
    await storage('delete'); resumeToken = ''; resumePaused = false;
    disconnected(); log('已取消此设备绑定');
  } catch { error('取消绑定未完成。请确认 CLI 正在运行后重试。'); }
  finally { connecting = false; el<HTMLButtonElement>('forget').disabled = false; el<HTMLButtonElement>('retry').disabled = false; }
});
window.addEventListener('pagehide', () => {
  if (!token) return;
  void fetch(base + '/plugin/disconnect', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: '{}', keepalive: true }).catch(() => {});
});
send({ type: 'ready' });
const initialGeneration = generation;
void storage('get').then(value => {
  if (generation !== initialGeneration) return;
  if (typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)) { resumeToken = value; el('forget').hidden = false; void resume(); }
}).catch(() => { /* Manual pairing remains available when clientStorage cannot be read. */ });
document.body.dataset.uiReady = 'true';
el<HTMLButtonElement>('connect').disabled = false;
