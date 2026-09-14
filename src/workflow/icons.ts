import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import svgpath from 'svgpath';
import { constructionSpec } from '../plugin/keylines.js';
import { constructionSvg, constructionPanel, constructionStyle, constructionScript } from './keyline-output.js';
import { AgentError } from '../protocol.js';
import { solid, type DesignSpec, type NodeSpec } from '../plugin/design.js';

export interface IconPath { name: string; d: string; fill?: boolean; fillRule?: 'nonzero' | 'evenodd' }
export interface IconDefinition { name: string; paths: IconPath[] }
export interface IconOptions {
  kind?: 'ui' | 'app'; size?: number; plate?: 'rounded' | 'circle' | 'square' | 'none';
  background?: string; foreground?: string; padding?: number; radius?: number; stroke?: number;
}
const line = (name: string, d: string): IconPath => ({ name, d });
export const ICONS: Record<string, IconDefinition> = Object.fromEntries(Object.entries({
  search: [line('lens', 'M10.5 17a6.5 6.5 0 1 0 0-13a6.5 6.5 0 0 0 0 13Z'), line('handle', 'm15.2 15.2 5 5')],
  home: [line('house', 'M3 10.5 12 3l9 7.5M5.5 9v11h4.25v-6h4.5v6h4.25V9')],
  plus: [line('plus', 'M12 5v14M5 12h14')],
  close: [line('close', 'm6 6 12 12M18 6 6 18')],
  check: [line('check', 'm4.5 12 5 5 10-10')],
  folder: [line('folder', 'M3 8V6a2 2 0 0 1 2-2h4l3 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8h18')],
  bell: [line('bell', 'M5 17c2-2 2-4 2-7a5 5 0 0 1 10 0c0 3 0 5 2 7H5Zm5 3a2 2 0 0 0 4 0')],
  play: [{ name: 'play', d: 'M7 4.5Q6 4 6 5v14q0 1 1 .5l13-7q1-.5 0-1Z', fill: true }],
  pause: [{ name: 'pause', d: 'M6 5h4v14H6ZM14 5h4v14h-4Z', fill: true }],
  heart: [line('heart', 'M12 20 4.5 12.5C-1 7 6 0 12 6c6-6 13 1 7.5 6.5Z')],
  star: [line('star', 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9Z')],
  bookmark: [line('bookmark', 'M6 4h12v17l-6-4-6 4V4Z')],
  user: [line('head', 'M16 7a4 4 0 1 1-8 0a4 4 0 0 1 8 0Z'), line('shoulders', 'M4 21v-2a8 6 0 0 1 16 0v2')],
  grid: [line('tiles', 'M4 4h6v6H4ZM14 4h6v6h-6ZM4 14h6v6H4ZM14 14h6v6h-6Z')],
  settings: [line('sliders', 'M5 3v5m0 5v8M12 3v10m0 5v3M19 3v2m0 5v11M2.5 8h5v5h-5ZM9.5 13h5v5h-5ZM16.5 5h5v5h-5Z')],
  trash: [line('bin', 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7')],
  'arrow-right': [line('arrow', 'M4 12h16m-7-7 7 7-7 7')],
  download: [line('download', 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5')],
}).map(([name, paths]) => [name, { name, paths }]));

const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;' }[c]!));
const round = (n: number) => Math.round(n * 1000) / 1000;
export function validateIcon(value: unknown): IconDefinition {
  const icon = value as IconDefinition;
  if (!icon || typeof icon.name !== 'string' || !icon.name.trim() || icon.name.length > 160 || !Array.isArray(icon.paths) || !icon.paths.length || icon.paths.length > 32) throw new AgentError('INVALID_ICON', 'An icon needs a name and 1–32 named paths on a 24 × 24 grid.');
  const names = new Set<string>();
  const paths = icon.paths.map(p => {
    if (!p || typeof p.name !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(p.name) || names.has(p.name)) throw new AgentError('INVALID_ICON', 'Path names must be unique lowercase identifiers, starting with a letter.');
    names.add(p.name);
    if (typeof p.d !== 'string' || p.d.length > 16_384 || (p.fill !== undefined && typeof p.fill !== 'boolean') || (p.fillRule !== undefined && !['nonzero','evenodd'].includes(p.fillRule))) throw new AgentError('INVALID_ICON', 'Each icon path needs valid SVG path data and optional fill/fillRule.');
    const path = svgpath(p.d) as ReturnType<typeof svgpath> & { err: string };
    let drawn = false, invalid = false;
    path.iterate(segment => { drawn ||= !['M','m','Z','z'].includes(segment[0]); invalid ||= segment.slice(1).some(n => typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 1000); });
    if (path.err || !drawn || invalid) throw new AgentError('INVALID_ICON_PATH', `Invalid geometry in path ${p.name}.`, 'Use valid SVG path data on a 24 × 24 grid.');
    return { name: p.name, d: path.round(4).toString(), ...(p.fill ? {fill:true} : {}), ...(p.fillRule ? {fillRule:p.fillRule} : {}) };
  });
  return { name: icon.name, paths };
}
export async function readIcon(nameOrPath: string) { return validateIcon(ICONS[nameOrPath] ?? JSON.parse(await readFile(resolve(nameOrPath), 'utf8'))); }
export function buildIcon(input: IconDefinition, options: IconOptions = {}) {
  const icon = validateIcon(input);
  const kind = options.kind ?? 'ui', size = options.size ?? (kind === 'app' ? 1024 : 24);
  const plate = options.plate ?? (kind === 'app' ? 'rounded' : 'none');
  if (!['ui','app'].includes(kind) || !['rounded','circle','square','none'].includes(plate)) throw new AgentError('INVALID_ICON_OPTION', 'Use kind ui/app and plate rounded/circle/square/none.');
  if (!Number.isInteger(size) || size < 16 || size > 4096) throw new AgentError('INVALID_SIZE', 'Icon size must be an integer from 16 to 4096.');
  const padding = options.padding ?? (plate === 'none' ? 0 : Math.round(size * (kind === 'app' ? .16 : .08333)));
  const radius = options.radius ?? round(size * (kind === 'app' ? .225 : .25));
  const stroke = options.stroke ?? (kind === 'app' ? 2.2 : 1.75);
  if (!Number.isFinite(padding) || padding < 0 || padding > size * .35 || !Number.isFinite(radius) || radius < 0 || radius > size / 2 || !Number.isFinite(stroke) || stroke < .5 || stroke > 4) throw new AgentError('INVALID_ICON_OPTION', 'Padding must be 0–35% of size; radius 0–50% of size; stroke 0.5–4 in the source 24 px grid.');
  const background = options.background ?? (kind === 'app' ? '#28634B' : '#E5EEE8');
  const foreground = options.foreground ?? (kind === 'app' ? '#FFFFFF' : '#234E3B');
  if (![background, foreground].every(c => /^#[\da-f]{6}$/i.test(c))) throw new AgentError('INVALID_COLOR', 'Icon colors must use #RRGGBB.');
  const markSize = round(size - padding * 2), scale = markSize / 24;
  // Small strokes retain a 1.25 px floor. App strokes scale with the master canvas.
  const physicalStroke = round(kind === 'ui' ? Math.max(1.25, stroke * scale) : stroke * scale);
  const paths = icon.paths.map(p => `<path id="${p.name}" d="${escape(svgpath(p.d).scale(scale).round(4).toString())}" fill="${p.fill ? foreground : 'none'}" stroke="${p.fill ? 'none' : foreground}"${p.fillRule ? ` fill-rule="${p.fillRule}"` : ''}/>`).join('\n');
  const mark = `<g id="mark" stroke-width="${physicalStroke}" stroke-linecap="round" stroke-linejoin="round">\n${paths}\n</g>`;
  const markSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${markSize}" height="${markSize}" viewBox="0 0 ${markSize} ${markSize}">${mark}</svg>`;
  const base = plate === 'none' ? '' : plate === 'circle' ? `<circle id="base" cx="${size/2}" cy="${size/2}" r="${size/2}" fill="${background}"/>` : `<rect id="base" width="${size}" height="${size}" rx="${plate === 'rounded' ? radius : 0}" fill="${background}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${escape(icon.name)}">\n${base}\n<g transform="translate(${padding} ${padding})">${mark}</g>\n</svg>\n`;
  const children: NodeSpec[] = [];
  if (plate !== 'none') children.push({ key:'base', type:plate === 'circle' ? 'ELLIPSE' : 'RECTANGLE', props:{name:'Base',width:size,height:size,x:0,y:0,fills:[solid(background)],...(plate === 'rounded' ? {cornerRadius:radius} : {})} });
  children.push({ key:'mark', type:'SVG', svg:markSvg, props:{name:'Mark / '+icon.name,x:padding,y:padding} });
  const spec: DesignSpec = constructionSpec(size,children,`${kind === 'app' ? 'App Icon' : 'Icon'} / ${icon.name} / ${size}`);
  return {svg, spec, metadata:{name:icon.name,kind,size,plate,padding,radius,stroke,physicalStroke,background,foreground,pathCount:icon.paths.length}};
}
export function iconPreview(icon: IconDefinition, options: IconOptions = {}) {
  const master = buildIcon(icon, options), kind = master.metadata.kind;
  const sizes = kind === 'app' ? [32,64,128,256] : [16,20,24,32,48,64];
  const previews = sizes.map(size => {
    const ratio = size / master.metadata.size;
    const item = buildIcon(icon,{...options,size,padding:round(master.metadata.padding*ratio),radius:round(master.metadata.radius*ratio)});
    return `<figure><div class="sample">${item.svg}</div><figcaption>${size} × ${size}</figcaption></figure>`;
  }).join('');
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(icon.name)} · 图标预览</title><style>*{box-sizing:border-box}body{margin:0;font:14px system-ui;background:#f4f5f1;color:#26372e}main{max-width:1100px;padding:24px;margin:auto}h1{font-size:22px;overflow-wrap:anywhere}p{line-height:1.7}.samples{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start}figure{margin:0;max-width:100%}.sample{display:grid;place-items:center;min-width:80px;min-height:80px;padding:12px;background:#fff;border:1px solid #d4dcd5;border-radius:8px;max-width:100%}.sample svg{max-width:100%;height:auto}.dark .sample{background:#15221c;border-color:#394c40}figcaption{text-align:center;margin:8px 0 16px;color:#617066}button,a{font:inherit;display:inline-block;padding:10px 14px;border-radius:6px}button{background:white;border:1px solid #b4c4b9;cursor:pointer}a{color:#205c3e}button:focus-visible,a:focus-visible{outline:3px solid #28634b;outline-offset:3px}.controls{display:flex;flex-wrap:wrap;gap:8px;margin:20px 0}${constructionStyle}@media(max-width:400px){main{padding:16px}}</style><main><h1>${escape(icon.name)}</h1><p>${kind === 'app' ? 'App Icon' : 'UI 图标'} · 主文件 ${master.metadata.size} × ${master.metadata.size} · 成品与构造辅助线分层编辑。</p><div class="controls"><button id="background" aria-pressed="false">深色背景</button><a href="icon.svg" download>下载 SVG</a><a href="figma.json" download>下载 Figma 图层定义</a></div><div class="samples">${previews}</div><p>按实际尺寸检查轮廓、笔画与留白。下面的尺寸是预览；导出文件保持主文件尺寸。</p>${constructionPanel(master.metadata.size,master.svg)}</main><script>document.getElementById('background').onclick=function(){const dark=document.body.classList.toggle('dark');this.setAttribute('aria-pressed',String(dark));this.textContent=dark?'浅色背景':'深色背景'};${constructionScript}</script></html>`;
}
export async function writeIcon(directory: string, icon: IconDefinition, options: IconOptions = {}) {
  const result = buildIcon(icon,options), dir = resolve(directory);
  await mkdir(dirname(dir),{recursive:true});
  try { await mkdir(dir); } catch (e:any) { if (e.code === 'EEXIST') throw new AgentError('OUTPUT_EXISTS','The icon directory already exists.','Use a new directory to preserve previous icon work.'); throw e; }
  await writeFile(resolve(dir,'icon.svg'),result.svg);
  await writeFile(resolve(dir,'construction.svg'),constructionSvg(result.metadata.size,result.svg));
  await writeFile(resolve(dir,'figma.json'),JSON.stringify(result.spec,null,2)+'\n');
  await writeFile(resolve(dir,'icon.json'),JSON.stringify({definition:icon,options:result.metadata},null,2)+'\n');
  await writeFile(resolve(dir,'preview.html'),iconPreview(icon,options));
  return {directory:dir,...result.metadata,svg:resolve(dir,'icon.svg'),construction:resolve(dir,'construction.svg'),spec:resolve(dir,'figma.json'),preview:resolve(dir,'preview.html'),next:'Inspect preview.html at actual sizes. Use apply figma.json to create Artwork and locked Guides. The returned keys.icon is the clean artwork frame; keys.workbench includes the construction grid. CLI export excludes guides unless --with-guides is explicit.'};
}
