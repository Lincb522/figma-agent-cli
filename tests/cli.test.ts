import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startBridge } from '../src/bridge/server.js';
import { execute } from '../src/plugin/commands.js';
import { fault } from '../src/protocol.js';
import { fixture } from './figma-fixture.js';
const exec = promisify(execFile);
test('built CLI creates, retries once, executes, and exports through the real bridge without corrupting files on errors', async t => {
  const bridge = await startBridge({ port: 0, token: 'synthetic-cli-integration', pairingCode: '123456' });
  const evidence = resolve(process.env.FIGMA_AGENT_TEST_OUTPUT ?? 'work/verification'); await mkdir(evidence, { recursive: true });
  const dir = await mkdtemp(resolve(evidence, 'cli-')); t.after(async () => { await bridge.close(); await rm(dir, { recursive: true, force: true }); });
  await writeFile(resolve(dir, 'session.json'), JSON.stringify({ protocol: 1, port: bridge.port, token: bridge.token }), { mode: 0o600 });
  const f = fixture();
  const http = async (path: string, data: any, token?: string) => (await fetch(`http://127.0.0.1:${bridge.port}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(data) })).json() as Promise<any>;
  const paired = await http('/pair', { code: '123456', context: { document: 'CLI fixture', page: 'Page', pageId: '0:1', selection: [] } });
  const cli = async (args: string[]) => {
    try { const value = await exec(process.execPath, ['dist/cli.js', ...args, '--state-dir', dir], { timeout: 10_000 }); return { code: 0, ...value }; }
    catch (e: any) { return { code: e.code, stdout: e.stdout, stderr: e.stderr }; }
  };
  const drive = async (args: string[]) => {
    const response = cli(args);
    const { command } = await http('/plugin/poll', {}, paired.token);
    let reply: any;
    try { reply = { ok: true, id: command.id, result: await execute(f.api, command) }; }
    catch (error) { reply = { ok: false, id: command.id, error: fault(error) }; }
    await http('/plugin/result', reply, paired.token); return response;
  };
  const specPath = resolve(dir, 'screen.json');
  await writeFile(specPath, JSON.stringify({ nodes: [{ key: 'screen', type: 'FRAME', props: { name: 'Screen', width: 390, height: 844 }, children: [{ type: 'TEXT', props: { characters: 'Hello' } }] }] }));
  const created = await drive(['apply', specPath, '--request-id', 'create-once']); assert.equal(created.code, 0);
  const createdJSON = JSON.parse(created.stdout); const id = createdJSON.result.keys.screen; const count = f.nodes.size;
  const repeated = await cli(['apply', specPath, '--request-id', 'create-once']); assert.equal(repeated.code, 0); assert.deepEqual(JSON.parse(repeated.stdout), createdJSON); assert.equal(f.nodes.size, count);
  const base=f.api.createEllipse(),cutter=f.api.createEllipse();base.name='Base';cutter.name='Cutter';cutter.x=30;
  const boolean=await drive(['boolean','subtract',base.id,cutter.id,'--keep-inputs']);assert.equal(boolean.code,0);assert.equal(JSON.parse(boolean.stdout).result.operation,'subtract');assert.ok(f.nodes.has(base.id));
  const changed=await drive(['boolean','set',JSON.parse(boolean.stdout).result.id,'exclude']);assert.equal(JSON.parse(changed.stdout).result.operation,'EXCLUDE');
  const iconDir=resolve(dir,'icon');const icon=await cli(['icon','build','search','--dir',iconDir,'--kind','app','--plate','circle']);assert.equal(icon.code,0);assert.match(await readFile(resolve(iconDir,'icon.svg'),'utf8'),/<circle id="base"/);
  const gridDir=resolve(dir,'grid');assert.equal((await cli(['icon','grid','--dir',gridDir,'--size','1024'])).code,0);
  const board=JSON.parse((await drive(['apply',resolve(gridDir,'figma.json')])).stdout).result.keys;
  const circle=JSON.parse((await drive(['icon','shape',board.workbench,'circle'])).stdout).result;
  const inner=JSON.parse((await drive(['icon','shape',board.workbench,'inner-circle'])).stdout).result;
  const ring=JSON.parse((await drive(['boolean','subtract',circle.id,inner.id])).stdout).result;assert.equal(ring.type,'BOOLEAN_OPERATION');
  const hotspot=f.nodes.get(id); hotspot.reactions=[];
  hotspot.setReactionsAsync=async (value:any)=>{hotspot.reactions=structuredClone(value);};
  const reactionsPath=resolve(dir,'reactions.json');
  await writeFile(reactionsPath,JSON.stringify([{trigger:{type:'ON_CLICK'},actions:[{type:'BACK'}]}]));
  const prototype=await drive(['prototype','set',id,reactionsPath]); assert.equal(prototype.code,0); assert.equal(JSON.parse(prototype.stdout).result.reactions.length,1);
  assert.equal(JSON.parse((await drive(['prototype','get',id])).stdout).result.reactions[0].actions[0].type,'BACK');
  assert.equal(JSON.parse((await drive(['prototype','clear',id])).stdout).result.reactions.length,0);
  const schema=JSON.parse((await cli(['schema'])).stdout);assert.ok(schema.nodeTypes.includes('BOOLEAN'));assert.ok(schema.nodeTypes.includes('IMAGE'));assert.ok(schema.icon.names.includes('search'));
  const brief=resolve(dir,'brief.txt'),job=resolve(dir,'generated-job');await writeFile(brief,'An app icon for the synthetic CLI handoff test');
  assert.equal((await cli(['design','prepare',brief,'--kind','appicon','--dir',job])).code,0);
  const handoff=JSON.parse((await cli(['design','generate',job])).stdout).result;assert.equal(handoff.tool,'image_gen');assert.equal(handoff.generated,false);
  const second=await cli(['design','generate',job]);assert.equal(JSON.parse(second.stderr).error.code,'GENERATION_ALREADY_STARTED');
  const fixturePNG=resolve(dir,'reference-fixture.png');await writeFile(fixturePNG,await readFile('docs/keyline-grid.png'));
  const accepted=JSON.parse((await cli(['design','accept',job,fixturePNG,'--generation-id',handoff.generationId,'--result-ref','synthetic-cli-result'])).stdout).result;
  assert.equal(accepted.job.reference.source,'image_gen');assert.equal(accepted.job.generation.receipt.provenance,'agent-reported');
  const invalidTimeout=await cli(['design','capture','missing','--timeout','0']);assert.equal(JSON.parse(invalidTimeout.stderr).error.code,'INVALID_TIMEOUT');
  const scriptPath = resolve(dir, 'rename.js'); await writeFile(scriptPath, `const node = await h.node(${JSON.stringify(id)}); node.name = 'Renamed by CLI'; return { id: node.id, name: node.name };`);
  const executed = await drive(['exec', scriptPath]); assert.equal(JSON.parse(executed.stdout).result.name, 'Renamed by CLI');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=', 'base64');
  f.nodes.get(id).exportAsync = async () => new Uint8Array(png);
  (f.api as any).base64Encode = (value: Uint8Array) => Buffer.from(value).toString('base64');
  const output = resolve(dir, 'preview.png');
  const exported = await drive(['export', id, '--out', output]); assert.equal(exported.code, 0); assert.deepEqual(await readFile(output), png);
  const failed = await drive(['export', 'missing-node', '--out', output]); assert.equal(failed.code, 1); assert.equal(JSON.parse(failed.stdout).error.code, 'NODE_NOT_FOUND'); assert.deepEqual(await readFile(output), png);
});
