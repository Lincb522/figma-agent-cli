import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { startBridge } from '../src/bridge/server.js';
// @ts-expect-error The portable skill helper runs directly in Node without a build.
import { ensureBridge, installTool } from '../skills/figma-agent/scripts/setup.mjs';

const exec = promisify(execFile);
async function temporary(t: any) {
  const base = resolve(process.env.FIGMA_AGENT_TEST_OUTPUT ?? 'work/verification');
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(resolve(base, 'setup-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('tool download installs prebuilt files, reuses them, and preserves incomplete directories', async t => {
  const directory = await temporary(t);
  const source = resolve(directory, 'archive-source/repo');
  await mkdir(source, { recursive: true });
  await cp('dist', resolve(source, 'dist'), { recursive: true });
  const archive = resolve(directory, 'source.tar.gz');
  await exec('tar', ['-czf', archive, '-C', resolve(directory, 'archive-source'), 'repo']);
  const target = resolve(directory, "User's tool $with spaces");
  assert.equal(await installTool(target, pathToFileURL(archive).href), true);
  assert.match((await exec(process.execPath, [resolve(target, 'dist/cli.js'), '--help'])).stdout, /Figma Agent CLI 0.7.0/);
  assert.equal(await installTool(target, 'https://invalid.invalid/unused'), false);
  const incomplete = resolve(directory, 'existing-project');
  await mkdir(incomplete);
  await writeFile(resolve(incomplete, 'user.txt'), 'preserve');
  await assert.rejects(installTool(incomplete), /未覆盖/);
  assert.equal(await readFile(resolve(incomplete, 'user.txt'), 'utf8'), 'preserve');
  assert.ok(!(await readdir(directory)).some(name => name.startsWith('.figma-agent-download-')));
});

test('setup reuses a real bridge through the CLI without changing its pairing code', async t => {
  const directory = await temporary(t);
  const project = resolve(directory, 'project');
  await cp('dist', resolve(project, 'dist'), { recursive: true });
  const bridge = await startBridge({ port: 0, pairingCode: '654321' });
  t.after(() => bridge.close());
  await mkdir(resolve(project, '.figma-agent'));
  await writeFile(resolve(project, '.figma-agent/session.json'), JSON.stringify({ protocol: 1, port: bridge.port, token: bridge.token }));
  const result = await ensureBridge(project);
  assert.equal(result.started, false);
  assert.deepEqual(result.sessions.result, []);
  assert.equal(await readFile(resolve(project, '.figma-agent/session.json'), 'utf8'), JSON.stringify({ protocol: 1, port: bridge.port, token: bridge.token }));
  assert.equal(bridge.pairingCode, '654321');
});

test('first setup starts a detached bridge, pairs once, and subsequent setup reuses it', async t => {
  const directory = await temporary(t);
  const project = resolve(directory, "User's project $spaces");
  await mkdir(resolve(project, 'dist/plugin'), { recursive: true });
  await writeFile(resolve(project, 'dist/plugin/manifest.json'), '{}');
  await writeFile(resolve(project, 'package.json'), JSON.stringify({ type: 'commonjs' }));
  // The fixture uses a real isolated HTTP process and the shipped CLI client.
  // Only serve's fixed Figma port is replaced, so tests cannot touch the user's bridge.
  await writeFile(resolve(project, 'dist/cli.js'), `
    const fs = require('node:fs');
    const path = require('node:path');
    const state = path.resolve(__dirname, '../.figma-agent');
    if (process.argv[2] !== 'serve') {
      const r = require('node:child_process').spawnSync(process.execPath, [${JSON.stringify(resolve('dist/cli.js'))}, ...process.argv.slice(2), '--state-dir', state], {encoding:'utf8'});
      process.stdout.write(r.stdout); process.stderr.write(r.stderr); process.exit(r.status);
    }
    const server = require('node:http').createServer((req, res) => {
      res.setHeader('Content-Type','application/json');
      if(req.url === '/sessions') res.end(JSON.stringify({ok:true, persistentPairing:true, result:[]}));
      else if(req.url === '/pairing') { fs.appendFileSync(path.join(state,'pairs'), 'pair\\n'); res.end(JSON.stringify({ok:true, result:{code:'123456', expiresIn:600000}})); }
      else { res.statusCode=404; res.end('{}'); }
    });
    server.listen(0, '127.0.0.1', () => fs.writeFileSync(path.join(state,'session.json'), JSON.stringify({protocol:1,port:server.address().port,token:'synthetic',pid:process.pid})));
    process.on('SIGTERM', () => server.close(() => process.exit(0)));
  `);
  await cp('skills', resolve(project, 'skills'), { recursive: true });
  await mkdir(resolve(project, 'scripts'));
  await cp('scripts/install-skill.mjs', resolve(project, 'scripts/install-skill.mjs'));
  const args = [resolve('skills/figma-agent/scripts/setup.mjs'), '--project', project, '--skills-dir', resolve(directory, 'personal-skills'), '--install-skill'];
  const first = await exec(process.execPath, args, { timeout: 20_000 });
  const state = JSON.parse(await readFile(resolve(project, '.figma-agent/session.json'), 'utf8'));
  t.after(() => { try { process.kill(state.pid, 'SIGTERM'); } catch {} });
  assert.match(first.stdout, /Installed figma-agent/);
  assert.match(first.stdout, /后台启动/);
  assert.match(first.stdout, /123456/);
  assert.match(first.stdout, /Import plugin from manifest/);
  const second = await exec(process.execPath, args, { timeout: 10_000 });
  const installed = await exec(process.execPath, [resolve(directory, 'personal-skills/figma-agent/scripts/setup.mjs')], { timeout: 10_000 });
  assert.match(installed.stdout, /复用正在运行/);
  assert.match(second.stdout, /复用正在运行/);
  assert.doesNotMatch(second.stdout, /123456|synthetic/);
  assert.equal(await readFile(resolve(project, '.figma-agent/pairs'), 'utf8'), 'pair\n');
  assert.ok(!(await readdir(resolve(project, '.figma-agent'))).includes('setup.lock'));
});

test('failed startup reports a recovery path and releases its lock', async t => {
  const directory = await temporary(t);
  await mkdir(resolve(directory, 'dist'));
  await writeFile(resolve(directory, 'dist/cli.js'), `
    if(process.argv[2]==='sessions') process.stderr.write(JSON.stringify({error:{code:'BRIDGE_NOT_RUNNING'}}));
    else process.stderr.write('port occupied');
    process.exit(1);
  `);
  await assert.rejects(ensureBridge(directory), /桥接启动失败.*bridge.log/);
  assert.ok(!(await readdir(resolve(directory, '.figma-agent'))).includes('setup.lock'));
  assert.match(await readFile(resolve(directory, '.figma-agent/bridge.log'), 'utf8'), /port occupied/);
});


test('setup entrypoint executes through a filesystem alias such as macOS temporary directories', async t => {
  const directory = await temporary(t);
  const alias = resolve(directory, 'setup-alias.mjs');
  await symlink(resolve('skills/figma-agent/scripts/setup.mjs'), alias);
  await assert.rejects(exec(process.execPath, [alias, '--project', directory]), (error: any) => /未覆盖/.test(error.stderr));
});
