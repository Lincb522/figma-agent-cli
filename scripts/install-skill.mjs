import { access, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ options: { 'skills-dir': { type: 'string' } } });
const skills = resolve(values['skills-dir'] ?? join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'skills'));
const target = join(skills, 'figma-agent');
const shellQuote = value => "'" + value.replaceAll("'", "'\\''") + "'";
let temporary;
try {
  await access(join(project, 'dist/cli.js'));
  const existing = await lstat(target).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (existing) throw new Error(`Skill already exists at ${target}. Your existing skill was preserved. Choose another --skills-dir or move the existing skill before installing.`);
  const source = join(project, 'skills/figma-agent');
  const template = await readFile(join(source, 'SKILL.md'), 'utf8');
  const content = template.replaceAll('{{PROJECT_ROOT}}', project).replaceAll('{{CLI_SHELL_PATH}}', shellQuote(join(project, 'dist/cli.js')));
  const metadata = await readFile(join(source, 'agents/openai.yaml'), 'utf8');
  await mkdir(skills, { recursive: true });
  temporary = await mkdtemp(join(skills, '.figma-agent-'));
  await mkdir(join(temporary, 'agents'));
  await writeFile(join(temporary, 'SKILL.md'), content);
  await writeFile(join(temporary, 'agents/openai.yaml'), metadata);
  await rename(temporary, target); temporary = undefined;
  console.log(`Installed figma-agent: ${target}\nCLI: ${join(project, 'dist/cli.js')}\nUse $figma-agent in Codex with your design request.`);
} catch (error) {
  console.error(error.message); process.exitCode = 1;
} finally {
  if (temporary) await rm(temporary, { recursive: true, force: true });
}
