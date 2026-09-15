import { access, cp, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ options: { 'skills-dir': { type: 'string' }, setup: { type: 'boolean' }, update: { type: 'boolean' } } });
const skills = resolve(values['skills-dir'] ?? join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'skills'));
const target = join(skills, 'figma-agent');
let temporary;
let backup;
try {
  await access(join(project, 'dist/cli.js'));
  const existing = await lstat(target).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  const source = join(project, 'skills/figma-agent');
  const template = await readFile(join(source, 'SKILL.md'), 'utf8');
  const metadata = await readFile(join(source, 'agents/openai.yaml'), 'utf8');
  const helper = await readFile(join(source, 'scripts/setup.mjs'), 'utf8');
  const config = JSON.stringify({ project }, null, 2) + '\n';
  const files = { 'SKILL.md': template, 'agents/openai.yaml': metadata, 'scripts/setup.mjs': helper, 'local-install.json': config };
  const identical = existing && (await Promise.all(Object.entries(files).map(async ([name, value]) =>
    (await readFile(join(target, name), 'utf8').catch(() => null)) === value))).every(Boolean);
  if (existing && !identical && !values.update) throw new Error(`Skill already exists at ${target}. Your existing skill was preserved. Run again with --update to back it up and install this version.`);
  if (!identical) {
    await mkdir(skills, { recursive: true });
    temporary = await mkdtemp(join(skills, '.figma-agent-'));
    await cp(source, temporary, { recursive: true });
    await writeFile(join(temporary, 'local-install.json'), config);
    if (existing) {
      const backups = join(dirname(skills), 'skill-backups');
      await mkdir(backups, { recursive: true });
      backup = join(backups, `figma-agent-${Date.now()}`);
      await rename(target, backup);
    }
    try { await rename(temporary, target); temporary = undefined; }
    catch (error) { if (backup) await rename(backup, target); throw error; }
  }
  if (backup) console.log(`Previous skill saved: ${backup}`);
  console.log(`Installed figma-agent: ${target}\nCLI: ${join(project, 'dist/cli.js')}\nLoad figma-agent in your agent with your design request. Codex users can use $figma-agent.`);
  if (values.setup) execFileSync(process.execPath, [join(target, 'scripts/setup.mjs'), ...(!existing ? ['--pair'] : [])], { stdio: 'inherit' });
} catch (error) {
  console.error(error.message); process.exitCode = 1;
} finally {
  if (temporary) await rm(temporary, { recursive: true, force: true });
}
