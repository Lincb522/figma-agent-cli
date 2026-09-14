import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PNG } from 'pngjs';
import { startBridge } from '../src/bridge/server.ts';
const exec = promisify(execFile);
let server, url, artifacts;
const evidence = resolve(process.env.FIGMA_AGENT_TEST_OUTPUT ?? 'work/verification');
test.beforeAll(async () => {
  await mkdir(evidence, { recursive: true });
  const ui = await readFile('dist/plugin/ui.html', 'utf8');
  artifacts = await mkdtemp(resolve(evidence,'browser-artifacts-'));
  const cli = async (...args) => exec(process.execPath,['dist/cli.js',...args]);
  await cli('icon','build','search','--dir',resolve(artifacts,'ui-icon'));
  await cli('icon','build','play','--kind','app','--dir',resolve(artifacts,'app-icon'));
  await cli('icon','grid','--size','1024','--dir',resolve(artifacts,'keyline-grid'));
  await writeFile(resolve(artifacts,'long.json'),JSON.stringify({name:'很长的图标名称用于验证窄窗口和英文 Long icon name '.repeat(3),paths:[{name:'mark',d:'M4 12h16m-7-7 7 7-7 7'}]}));
  await cli('icon','build',resolve(artifacts,'long.json'),'--dir',resolve(artifacts,'long-icon'));
  const reference=new PNG({width:320,height:240});reference.data.fill(255);
  await writeFile(resolve(artifacts,'reference.png'),PNG.sync.write(reference));
  const render=new PNG({width:320,height:240});render.data.fill(255);for(let y=50;y<110;y++)for(let x=40;x<210;x++){const i=(y*320+x)*4;render.data[i]=40;render.data[i+1]=99;render.data[i+2]=75;}
  await writeFile(resolve(artifacts,'render.png'),PNG.sync.write(render));
  await writeFile(resolve(artifacts,'brief.txt'),'Synthetic browser comparison fixture');
  await cli('design','prepare',resolve(artifacts,'brief.txt'),'--dir',resolve(artifacts,'job'));
  await cli('design','import',resolve(artifacts,'job'),resolve(artifacts,'reference.png'));
  await cli('design','compare',resolve(artifacts,'job'),resolve(artifacts,'render.png'));
  const pages = new Map();
  for (const name of ['ui-icon','app-icon','long-icon']) pages.set('/'+name,await readFile(resolve(artifacts,name,'preview.html'),'utf8'));
  pages.set('/keyline-grid',await readFile(resolve(artifacts,'keyline-grid/preview.html'),'utf8'));
  pages.set('/comparison',await readFile(resolve(artifacts,'job/external-comparison/comparison.html'),'utf8'));
  server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if(pages.has(req.url)){res.end(pages.get(req.url));return;}
    if (req.url === '/plugin') { res.end(ui); return; }
    if (req.url === '/relay') { res.end(`<!doctype html><html><body style="margin:0"><iframe title="Plugin" src="/plugin" style="display:block;border:0;width:100vw;height:100vh" sandbox="allow-scripts allow-forms"></iframe><script>window.addEventListener('message',e=>{if(e.data?.pluginMessage)parent.postMessage(e.data,'*');});</script></body></html>`); return; }
    if (req.url === '/nested') { res.end(`<!doctype html><html><body style="margin:0"><iframe title="Host relay" src="/relay" style="display:block;border:0;width:100vw;height:100vh"></iframe><script>window.addEventListener('message',e=>{const child=document.querySelector('iframe').contentWindow.frames[0];const m=e.data?.pluginMessage;if(m?.type==='ready'||m?.type==='context')child.postMessage({pluginMessage:{type:'context',context:{document:'Nested host document',page:'Main',pageId:'0:1',selection:[]}}},'*');if(m?.type==='command')child.postMessage({pluginMessage:{type:'result',reply:{ok:true,id:m.command.id,result:{nodes:2}}}},'*');});</script></body></html>`); return; }

    res.end(`<!doctype html><html><body style="margin:0"><iframe title="Plugin" src="/plugin" style="display:block;border:0;width:100vw;height:100vh" sandbox="allow-scripts allow-forms"></iframe><script>const child = document.querySelector('iframe'); window.addEventListener('message', e => { if(e.data?.pluginMessage?.type === 'ready' || e.data?.pluginMessage?.type === 'context') child.contentWindow.postMessage({pluginMessage:{type:'context',context:{document:'工作台设计',page:'主要页面',pageId:'0:1',selection:[]}}},'*'); if(e.data?.pluginMessage?.type === 'command') child.contentWindow.postMessage({pluginMessage:{type:'result',reply:{ok:true,id:e.data.pluginMessage.command.id,result:{nodes:2}}}},'*'); });</script></body></html>`);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); url = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => { if(server){server.closeAllConnections();await new Promise(r => server.close(r));}if(artifacts)await rm(artifacts,{recursive:true,force:true}); });
async function mock(page, mode = 'success') {
  let delivered = false;
  await page.route('http://localhost:38471/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'POST, OPTIONS' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (path === '/pair' && mode === 'error') return route.fulfill({ status: 400, headers, json: { ok: false, error: { code: 'INVALID_PAIRING_CODE', message: 'Wrong code' } } });
    if (path === '/pair' && mode === 'loading') { await new Promise(r => setTimeout(r, 1500)); }
    let result = { ok: true };
    if (path === '/pair') result = { ok: true, sessionId: 'synthetic-session-for-ui-test', token: 'synthetic-test-only' };
    if (path === '/plugin/poll') {
      await new Promise(r => setTimeout(r, 100));
      result = { ok: true, command: !delivered ? { id: 'ui-command', method: 'apply', params: {}, timeoutMs: 1000 } : null }; delivered = true;
    }
    await route.fulfill({ headers, json: result }).catch(() => {});
  });
}
const frame = page => page.frameLocator('iframe');
async function noOverflow(page) {
  const dimensions = await page.frames()[1].evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width);
}
for (const width of [260, 368, 640]) {
  test(`pairing and connected panel fit width ${width}, including long Chinese content`, async ({ page }) => {
    await page.setViewportSize({ width, height: 600 }); await mock(page); await page.goto(url);
    await expect(frame(page).locator('#document')).toHaveText('工作台设计'); await noOverflow(page);
    await page.evaluate(() => document.querySelector('iframe').contentWindow.postMessage({pluginMessage:{type:'context',context:{document:'非常长的项目名称用于测试窄窗口下文件名仍能完整换行展示'.repeat(4),page:'设置与账号管理 / Settings and account management'.repeat(3),pageId:'0:1',selection:[]}}},'*'));
    await noOverflow(page);
    await frame(page).getByLabel('六位配对码').fill('123456'); await frame(page).getByRole('button', { name: '连接', exact: true }).click();
    await expect(frame(page).locator('#activity')).toContainText('apply · 完成'); await noOverflow(page);
    await frame(page).getByRole('button', { name: '暂停接收' }).click(); await expect(frame(page).locator('#status')).toHaveText('已暂停接收');
    await page.screenshot({ path: resolve(evidence, `plugin-${width}.png`), fullPage: true });
    await frame(page).getByRole('button', { name: '继续接收' }).click(); await frame(page).getByRole('button', { name: '断开连接' }).click();
    await expect(frame(page).locator('#pair-form')).toBeVisible();
  });
}
test('invalid pairing presents an accessible error and supports keyboard recovery', async ({ page }) => {
  await page.setViewportSize({ width: 368, height: 540 }); await mock(page, 'error'); await page.goto(url);
  const input = frame(page).getByLabel('六位配对码'); await input.fill('123456'); await input.press('Tab');
  await expect(frame(page).getByRole('button', { name: '连接', exact: true })).toBeFocused(); await page.keyboard.press('Enter');
  await expect(frame(page).getByRole('alert')).toContainText('配对码不正确');
  await expect(frame(page).getByRole('button', { name: '连接', exact: true })).toBeEnabled(); await noOverflow(page);
  await page.screenshot({ path: resolve(evidence, 'plugin-error.png'), fullPage: true });
});
test('nested host delivers document and command results from the top window', async ({ page }) => {
  await mock(page); await page.goto(url + '/nested');
  const panel = page.frameLocator('iframe').frameLocator('iframe');
  await expect(panel.locator('#document')).toHaveText('Nested host document');
  await panel.getByLabel('六位配对码').fill('123456');
  await panel.getByRole('button', { name: '连接', exact: true }).click();
  await expect(panel.locator('#activity')).toContainText('apply · 完成');
  await panel.getByRole('button', { name: '断开连接' }).click();
});
test('null-source plugin messages deliver context and execution results while malformed context is ignored', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await mock(page); await page.goto(url + '/plugin');
  await page.evaluate(() => {
    window.dispatchEvent(new MessageEvent('message', { data: { pluginMessage: { type: 'context', context: { document: 'Malformed', selection: null } } } }));
  });
  await expect(page.locator('#document')).toHaveText('等待 Figma 文档');
  await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: { pluginMessage: { type: 'context-error', error: { message: '文档读取异常 / Synthetic host read failure '.repeat(4) } } } })));
  await expect(page.getByRole('alert')).toContainText('文档读取异常');
  for (const width of [260, 640]) {
    await page.setViewportSize({ width, height: 600 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  await page.setViewportSize({ width: 368, height: 600 });
  await page.evaluate(() => {
    window.addEventListener('message', e => {
      const message = e.data?.pluginMessage;
      if (message?.type === 'command') window.dispatchEvent(new MessageEvent('message', { data: { pluginMessage: { type: 'result', reply: { ok: true, id: message.command.id, result: { source: 'null-source-fixture' } } } } }));
    });
    window.dispatchEvent(new MessageEvent('message', { data: { pluginMessage: { type: 'context', context: { document: 'Host-delivered document', page: 'Main', pageId: '0:1', selection: [] } } } }));
  });
  await expect(page.locator('#document')).toHaveText('Host-delivered document');
  await expect(page.getByRole('alert')).toBeHidden();
  await page.getByLabel('六位配对码').fill('123456'); await page.getByRole('button', { name: '连接', exact: true }).click();
  await expect(page.locator('#activity')).toContainText('apply · 完成'); expect(errors).toEqual([]);
  await page.getByRole('button', { name: '断开连接' }).click();
});
test('connect can request missing context, times out without network pairing, and recovers on retry', async ({ page }) => {
  let paired = false;
  await mock(page, 'error');
  page.on('request', request => { if (request.url() === 'http://localhost:38471/pair' && request.method() === 'POST') paired = true; });
  await page.clock.install(); await page.goto(url + '/plugin');
  await page.getByLabel('六位配对码').fill('123456'); await page.getByRole('button', { name: '连接', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('正在读取 Figma 文件');
  await expect(page.getByRole('button', { name: '连接', exact: true })).toBeDisabled();
  await page.clock.fastForward(6001);
  await expect(page.getByRole('alert')).toContainText('未收到 Figma 文件信息'); expect(paired).toBe(false);
  await expect(page.locator('#diagnostics')).toBeVisible();
  await expect(page.locator('#diagnostic-text')).toContainText('尚未收到启动响应');
  await expect(page.locator('#diagnostic-text')).not.toContainText('123456');
  await page.evaluate(() => window.addEventListener('message', e => {
    if (e.data?.pluginMessage?.type === 'context') window.dispatchEvent(new MessageEvent('message', { data: { pluginMessage: { type: 'context', context: { document: 'Recovered document', page: 'Page', pageId: '0:1', selection: [] } } } }));
  }));
  await page.getByRole('button', { name: '连接', exact: true }).click();
  await expect(page.locator('#document')).toHaveText('Recovered document');
  await expect(page.locator('#diagnostics')).toBeHidden();
  await expect(page.getByRole('alert')).toContainText('配对码不正确'); expect(paired).toBe(true);
});
test('startup failure shows actionable diagnostics at narrow and wide widths without pairing', async ({ page }) => {
  let paired = false;
  page.on('request', request => { if (request.url().endsWith('/pair')) paired = true; });
  await page.goto(url + '/plugin');
  await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: { pluginMessage: { type: 'runtime-error', version: 'fixture', error: { message: 'Synthetic startup failure / 初始化错误 '.repeat(12) } } } })));
  await expect(page.locator('#document')).toHaveText('插件初始化失败');
  await expect(page.getByRole('alert')).toContainText('Synthetic startup failure');
  await expect(page.locator('#diagnostics')).toBeVisible();
  const version = JSON.parse(await readFile('package.json', 'utf8')).version;
  await expect(page.locator('#diagnostic-text')).toContainText(`面板 ${version}`);
  for (const width of [260, 368, 640]) {
    await page.setViewportSize({ width, height: 600 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const summary = page.locator('#diagnostics summary'); await summary.focus(); await page.keyboard.press('Enter');
    await expect(page.locator('#diagnostic-text')).toBeHidden(); await page.keyboard.press('Enter');
    await expect(page.locator('#diagnostic-text')).toBeVisible();
    await page.screenshot({ path: resolve(evidence, `plugin-startup-error-${width}.png`), fullPage: true });
  }
  await page.getByLabel('六位配对码').fill('123456'); await page.getByRole('button', { name: '连接', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('插件主线程初始化失败');
  expect(paired).toBe(false);
});
test('loading state disables duplicate pairing, and dark/reduced-motion panel stays usable', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' }); await page.setViewportSize({ width: 368, height: 540 }); await mock(page, 'loading'); await page.goto(url);
  await frame(page).getByLabel('六位配对码').fill('123456'); await frame(page).getByRole('button', { name: '连接', exact: true }).click();
  await expect(frame(page).getByRole('button', { name: '连接', exact: true })).toBeDisabled(); await expect(frame(page).locator('#status')).toHaveText('正在连接本地 CLI');
  await page.screenshot({ path: resolve(evidence, 'plugin-loading-dark.png'), fullPage: true });
  await expect(frame(page).locator('#connected')).toBeVisible(); await noOverflow(page);
});
test('manifest localhost connection works through real Chrome CSP, CORS and bridge sockets', async ({ page }) => {
  const manifest = JSON.parse(await readFile('dist/plugin/manifest.json', 'utf8'));
  const builtUI = await readFile('dist/plugin/ui.html', 'utf8');
  const declared = new URL(manifest.networkAccess.devAllowedDomains[0]);
  expect(declared.hostname).toBe('localhost');
  const bridge = await startBridge({ port: 0, token: 'synthetic-browser-cli-token', pairingCode: '123456' });
  const origin = `http://localhost:${bridge.port}`;
  // Substitute only the test port; preserve the built request hostname and scheme.
  const ui = builtUI.replaceAll(declared.port, String(bridge.port));
  const web = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (req.url === '/plugin') {
      res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src ${origin}`);
      res.end(ui); return;
    }
    res.end(`<!doctype html><html><body style="margin:0"><iframe title="Plugin" src="/plugin" style="display:block;border:0;width:100vw;height:100vh" sandbox="allow-scripts allow-forms"></iframe><script>const child=document.querySelector('iframe');window.addEventListener('message',e=>{const m=e.data?.pluginMessage;if(m?.type==='ready'||m?.type==='context')child.contentWindow.postMessage({pluginMessage:{type:'context',context:{document:'Localhost transport fixture',page:'Page',pageId:'0:1',selection:[]}}},'*');if(m?.type==='command')child.contentWindow.postMessage({pluginMessage:{type:'result',reply:{ok:true,id:m.command.id,result:{transport:'localhost-browser-fixture'}}}},'*');});</script></body></html>`);
  });
  try {
    await new Promise(resolve => web.listen(0, '127.0.0.1', resolve));
    await page.setViewportSize({ width: 368, height: 600 });
    await page.goto(`http://127.0.0.1:${web.address().port}`);
    await expect(frame(page).locator('#document')).toHaveText('Localhost transport fixture');
    await frame(page).getByLabel('六位配对码').fill('123456');
    await frame(page).getByRole('button', { name: '连接', exact: true }).click();
    await expect(frame(page).locator('#connected')).toBeVisible();
    const response = await fetch(`http://127.0.0.1:${bridge.port}/commands`, {
      method: 'POST', headers: { Authorization: 'Bearer synthetic-browser-cli-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'real-browser-localhost', method: 'document', params: {}, timeoutMs: 5000 }),
    });
    const reply = await response.json(); expect(reply.ok).toBe(true); expect(reply.result.transport).toBe('localhost-browser-fixture');
    await expect(frame(page).locator('#activity')).toContainText('document · 完成');
    await frame(page).getByText('连接与执行说明', { exact: true }).click();
    await expect(frame(page).locator('details').filter({ hasText: '连接与执行说明' })).toContainText(`localhost:${bridge.port}`); await noOverflow(page);
    await page.screenshot({ path: resolve(evidence, 'plugin-localhost-real-transport.png'), fullPage: true });
    await frame(page).getByRole('button', { name: '断开连接' }).click();
    await expect(frame(page).locator('#pair-form')).toBeVisible();
  } finally { await page.goto('about:blank'); web.closeAllConnections(); await new Promise(resolve => web.close(resolve)); await bridge.close(); }
});
for(const width of [320,1280]) {
  test(`icon previews preserve small-size geometry, keyboard toggle and long labels at ${width}px`,async({page})=>{
    await page.setViewportSize({width,height:800});
    for(const name of ['ui-icon','app-icon','long-icon']) {
      const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(url+'/'+name);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      const paths=await page.locator('.sample svg').evaluateAll(elements=>elements.map(svg=>({width:svg.getBoundingClientRect().width,view:svg.viewBox.baseVal.width,bounds:[...svg.querySelectorAll('path')].map(p=>{const b=p.getBBox();return{x:b.x,y:b.y,w:b.width,h:b.height};})})));
      expect(paths.length).toBeGreaterThan(3);for(const svg of paths){for(const box of svg.bounds){expect(box.w+box.h).toBeGreaterThan(0);expect(box.x).toBeGreaterThanOrEqual(-.1);expect(box.y).toBeGreaterThanOrEqual(-.1);expect(box.x+box.w).toBeLessThanOrEqual(svg.view+.1);expect(box.y+box.h).toBeLessThanOrEqual(svg.view+.1);}}
      if(name==='ui-icon')expect(paths.map(p=>p.width)).toEqual([16,20,24,32,48,64]);
      await page.keyboard.press('Tab');const toggle=page.getByRole('button',{name:/[深浅]色背景/});await expect(toggle).toBeFocused();await page.keyboard.press('Enter');await expect(toggle).toHaveAttribute('aria-pressed','true');
      const guides=page.getByRole('checkbox',{name:'显示构造辅助线'});await expect(guides).toBeChecked();await guides.uncheck();await expect(page.locator('#guide-overlay')).toBeHidden();await guides.check();
      expect(errors).toEqual([]);await page.screenshot({path:resolve(evidence,`${name}-${width}.png`),fullPage:true});
    }
  });
  test(`keyline construction grid matches concentric reference geometry and fits ${width}px`,async({page})=>{
    await page.setViewportSize({width,height:850});await page.goto(url+'/keyline-grid');
    await expect(page.getByRole('heading',{level:1})).toContainText('1024 × 1024');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const geometry=await page.locator('#keylines').evaluate(g=>({ellipses:g.querySelectorAll('ellipse').length,rectangles:g.querySelectorAll('rect').length,circles:[...g.querySelectorAll('ellipse')].map(e=>({x:Number(e.getAttribute('cx')),y:Number(e.getAttribute('cy')),r:Number(e.getAttribute('rx'))}))}));
    expect(geometry.ellipses).toBe(2);expect(geometry.rectangles).toBe(4);expect(geometry.circles.map(c=>c.x)).toEqual([512,512]);expect(geometry.circles[0].r/geometry.circles[1].r).toBeCloseTo(2,4);
    const checkbox=page.getByRole('checkbox',{name:'显示构造辅助线'});await checkbox.focus();await page.keyboard.press('Space');await expect(page.locator('#guide-overlay')).toBeHidden();await page.keyboard.press('Space');await expect(page.locator('#guide-overlay')).toBeVisible();
    await page.screenshot({path:resolve(evidence,`keylines-${width}.png`),fullPage:true});
  });
  test(`comparison viewer labels external provenance and supports slider, buttons and keyboard at ${width}px`,async({page})=>{
    await page.setViewportSize({width,height:800});await page.goto(url+'/comparison');
    await expect(page.getByRole('heading')).toHaveText('参考图与外部 PNG 对比');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const slider=page.getByRole('slider');await slider.focus();await page.keyboard.press('ArrowRight');await expect(page.locator('#value')).toHaveText('51%');await expect(page.locator('#render')).toHaveCSS('opacity','0.51');
    await page.getByRole('button',{name:'仅参考图'}).click();await expect(slider).toHaveValue('0');
    await page.getByRole('button',{name:'仅复刻图'}).click();await expect(page.locator('#render')).toHaveCSS('opacity','1');
    await page.screenshot({path:resolve(evidence,`comparison-${width}.png`),fullPage:true});
  });
}
