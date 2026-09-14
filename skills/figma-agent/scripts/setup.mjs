import { execFile, spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, open, readFile, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const archiveURL = 'https://codeload.github.com/Lincb522/figma-agent-cli/tar.gz/refs/heads/main';
const exists = path => access(path).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const cli = (project, args, timeout = 12_000) => exec(process.execPath, [join(project, 'dist/cli.js'), ...args], { timeout, maxBuffer: 1024 * 1024 });

export async function installTool(project, url = archiveURL) {
  if (await exists(join(project, 'dist/cli.js'))) {
    await access(join(project, 'dist/plugin/manifest.json'));
    return false;
  }
  if (await exists(project)) throw new Error(`工具目录已存在但缺少 CLI，未覆盖：${project}。请修复该目录或用 --project 指定已有安装。`);
  await mkdir(dirname(project), { recursive: true });
  const temporary = await mkdtemp(join(dirname(project), '.figma-agent-download-'));
  try {
    const archive = join(temporary, 'source.tar.gz');
    const extracted = join(temporary, 'tool');
    await mkdir(extracted);
    await exec('curl', ['--fail', '--silent', '--show-error', '--location', '--connect-timeout', '15', '--max-time', '120', '--output', archive, url], { timeout: 125_000 });
    await exec('tar', ['-xzf', archive, '--strip-components=1', '-C', extracted], { timeout: 30_000 });
    await access(join(extracted, 'dist/plugin/manifest.json'));
    await cli(extracted, ['--help']);
    await rename(extracted, project);
    return true;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

async function sessions(project) {
  try {
    const { stdout } = await cli(project, ['sessions'], 2500);
    const result = JSON.parse(stdout);
    if (!result.ok || !Array.isArray(result.result)) throw new Error('连接状态格式无效。');
    return result;
  } catch (error) {
    let code;
    try { code = JSON.parse(error.stderr).error.code; } catch { /* Non-CLI failures are not a stopped bridge. */ }
    if (code === 'BRIDGE_NOT_RUNNING' || code === 'BRIDGE_UNREACHABLE') return null;
    throw new Error('无法确认已有桥接的连接状态，未启动第二个服务。请检查本地安装和端口占用。');
  }
}

export async function ensureBridge(project) {
  const existing = await sessions(project);
  if (existing) return { started: false, sessions: existing };
  const state = join(project, '.figma-agent');
  await mkdir(state, { recursive: true, mode: 0o700 });
  const lock = join(state, 'setup.lock');
  try { await mkdir(lock); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error(`另一个安装流程正在启动桥接。请稍后重试；若流程已退出，删除 ${lock} 后重试。`);
    throw error;
  }
  let child;
  let ready = false;
  try {
    const raced = await sessions(project);
    if (raced) return { started: false, sessions: raced };
    const logPath = join(state, 'bridge.log');
    const log = await open(logPath, 'a', 0o600);
    let spawnError;
    try {
      child = spawn(process.execPath, [join(project, 'dist/cli.js'), 'serve', '--quiet'], {
        cwd: project, detached: true, stdio: ['ignore', log.fd, log.fd],
      });
      child.on('error', error => { spawnError = error; });
      child.unref();
    } finally { await log.close(); }
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (spawnError || child.exitCode !== null || child.signalCode !== null) break;
      const status = await sessions(project);
      if (status) {
        ready = true;
        return { started: true, pid: child.pid, logPath, sessions: status };
      }
      await pause(200);
    }
    throw new Error(`桥接启动失败。请检查 ${logPath}；若 38471 端口已有服务，请使用它所属的安装目录。未停止已有服务。`);
  } finally {
    if (child && !ready && child.exitCode === null) child.kill('SIGTERM');
    await rm(lock, { recursive: true, force: true });
  }
}

export async function setup(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    project: { type: 'string' }, 'skills-dir': { type: 'string' },
    'install-skill': { type: 'boolean' }, pair: { type: 'boolean' },
  } });
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('请先安装 Node.js 22 或更新版本，再运行安装命令。');
  const skills = resolve(values['skills-dir'] ?? join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'skills'));
  let saved;
  for (const config of [join(here, '../local-install.json'), join(skills, 'figma-agent/local-install.json')]) {
    if (await exists(config)) { saved = JSON.parse(await readFile(config, 'utf8')).project; break; }
  }
  const project = resolve(values.project ?? process.env.FIGMA_AGENT_HOME ?? saved ?? join(homedir(), '.local/share/figma-agent-cli'));
  console.log(`工具目录：${project}`);
  const downloaded = await installTool(project);
  let firstSkill = false;
  if (values['install-skill']) {
    firstSkill = !await exists(join(skills, 'figma-agent'));
    try {
      const installed = await exec(process.execPath, [join(project, 'scripts/install-skill.mjs'), '--skills-dir', skills], { timeout: 15_000 });
      process.stdout.write(installed.stdout);
    } catch (error) {
      if (error.stderr?.includes('Skill already exists')) throw new Error(`已有不同版本的 Skill，已保留。请在 ${project} 中运行 npm run skill:install -- --update，备份后升级。`);
      throw error;
    }
  }
  const bridge = await ensureBridge(project);
  console.log(bridge.started ? `桥接已在后台启动（PID ${bridge.pid}），可以关闭终端。日志：${bridge.logPath}` : '已复用正在运行的桥接。');
  console.log(`CLI：${join(project, 'dist/cli.js')}\n插件文件：${join(project, 'dist/plugin/manifest.json')}`);
  if (values.pair || downloaded || firstSkill) {
    const paired = await cli(project, ['pair']);
    process.stdout.write(paired.stdout);
    console.log('在 Figma 桌面版打开设计稿 → Plugins → Development → Import plugin from manifest…\n选择上面的插件文件，运行 Figma Agent，输入六位配对码并点击「连接」。');
  } else {
    console.log(`当前连接 ${bridge.sessions.result.length} 个设计稿。打开 Figma Agent 后，已保存的绑定会自动恢复。\n首次绑定或需要新码时，用相同 setup 命令加 --pair。`);
  }
  console.log('回到 Codex，新建对话使用：$figma-agent 帮我设计一个可编辑的 App 首页。');
  return { project, ...bridge };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  setup().catch(error => {
    // Child output may contain private project data; report only known installer errors.
    console.error(error.cmd ? '安装命令执行失败。请检查网络、Node.js 与目录权限；已有安装已保留。' : error.message);
    process.exitCode = 1;
  });
}
