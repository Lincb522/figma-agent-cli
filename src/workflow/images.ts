import { PNG } from 'pngjs';
import { createHash } from 'node:crypto';
import { readFile, writeFile, stat, realpath } from 'node:fs/promises';
import { resolve, relative, dirname, extname, isAbsolute } from 'node:path';
import { AgentError } from '../protocol.js';
import { validateSpec, type DesignSpec, type NodeSpec } from '../plugin/design.js';
export const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
export function decodePNG(bytes: Buffer) {
  if (bytes.length < 33 || !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new AgentError('PNG_REQUIRED', 'The design workflow requires a PNG reference.');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (!width || !height || width > 4096 || height > 4096 || bytes.length > 16*1024*1024) throw new AgentError('IMAGE_TOO_LARGE', 'Use a PNG no larger than 4096 × 4096 pixels and 16 MiB.');
  try { return PNG.sync.read(bytes); } catch { throw new AgentError('INVALID_PNG', 'The PNG could not be decoded.'); }
}
export async function readPNG(path: string) {
  if ((await stat(path)).size > 16*1024*1024) throw new AgentError('IMAGE_TOO_LARGE', 'The PNG exceeds 16 MiB.');
  const bytes = await readFile(path); const decoded = decodePNG(bytes);
  return { bytes, width: decoded.width, height: decoded.height, sha256: hash(bytes) };
}
export async function loadDesign(path: string): Promise<DesignSpec> {
  const base = await realpath(dirname(resolve(path)));
  const spec = JSON.parse(await readFile(path, 'utf8')) as DesignSpec;
  validateSpec(spec);
  let total = 0;
  const visit = async (node: NodeSpec) => {
    if (node.type === 'IMAGE' && node.imagePath) {
      if (isAbsolute(node.imagePath) || !['.png','.jpg','.jpeg','.gif'].includes(extname(node.imagePath).toLowerCase())) throw new AgentError('INVALID_ASSET_PATH', 'imagePath must be a relative PNG, JPG or GIF path within the layout directory.');
      const file = await realpath(resolve(base, node.imagePath)); const inside = relative(base, file);
      if (inside.startsWith('..') || isAbsolute(inside)) throw new AgentError('ASSET_OUTSIDE_DESIGN', 'Image assets must stay inside the layout directory, including symbolic links.');
      const size = (await stat(file)).size; total += size;
      if (size > 16*1024*1024 || total > 16*1024*1024) throw new AgentError('ASSETS_TOO_LARGE', 'Use at most 16 MiB of image assets per apply.');
      node.imageBase64 = (await readFile(file)).toString('base64'); delete node.imagePath;
    }
    for (const child of node.children ?? []) await visit(child);
  };
  for (const node of spec.nodes) await visit(node);
  return spec;
}
export function comparePNGs(reference: Buffer, rendered: Buffer) {
  const a = decodePNG(reference), b = decodePNG(rendered);
  if (a.width !== b.width || a.height !== b.height) throw new AgentError('DIMENSION_MISMATCH', `Reference is ${a.width}×${a.height}; render is ${b.width}×${b.height}.`, 'Correct the Figma frame dimensions and export at scale 1; images are not silently resized.');
  const overlay = new PNG({ width: a.width, height: a.height }); const diff = new PNG({ width: a.width, height: a.height });
  let absolute = 0, changed = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    let maximum = 0;
    for (let c=0;c<3;c++) {
      const av = Math.round(a.data[i+c]*a.data[i+3]/255+255-a.data[i+3]);
      const bv = Math.round(b.data[i+c]*b.data[i+3]/255+255-b.data[i+3]);
      const delta = Math.abs(av-bv); absolute += delta; maximum = Math.max(maximum,delta); overlay.data[i+c] = Math.round((av+bv)/2);
    }
    if (maximum > 16) changed++;
    overlay.data[i+3]=255; diff.data[i]=maximum>16?220:240; diff.data[i+1]=maximum>16?Math.max(0,180-maximum):240; diff.data[i+2]=maximum>16?Math.max(0,180-maximum):240; diff.data[i+3]=255;
  }
  return { width:a.width,height:a.height, meanAbsoluteChannelError:absolute/(a.width*a.height*3), changedPixelFraction:changed/(a.width*a.height), threshold:16, overlay:PNG.sync.write(overlay), difference:PNG.sync.write(diff) };
}
export async function writeComparison(directory: string, reference: Buffer, rendered: Buffer, source: 'figma' | 'external' = 'figma') {
  const result = comparePNGs(reference,rendered);
  const metrics = { source, width:result.width,height:result.height,meanAbsoluteChannelError:result.meanAbsoluteChannelError,changedPixelFraction:result.changedPixelFraction,threshold:result.threshold,interpretation:'Pixel difference diagnostics, not a perceptual similarity score. Visual review is still required.' };
  await writeFile(resolve(directory,'overlay.png'),result.overlay); await writeFile(resolve(directory,'difference.png'),result.difference);
  await writeFile(resolve(directory,'comparison.json'),JSON.stringify(metrics,null,2)+'\n');
  const data = (bytes: Buffer) => 'data:image/png;base64,'+bytes.toString('base64');
  const title = source === 'figma' ? '参考图与 Figma 复刻对比' : '参考图与外部 PNG 对比';
  const renderLabel = source === 'figma' ? 'Figma 导出的复刻图' : '用户提供的外部 PNG（来源未验证）';
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>*{box-sizing:border-box}body{margin:0;font:14px system-ui;color:#22312b;background:#f3f5f0}main{max-width:1500px;margin:auto;padding:24px}h1{font-size:22px;margin:0 0 8px}p{line-height:1.6;color:#5c6860}.controls{display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin:20px 0}input{max-width:100%;accent-color:#286c4a}button{padding:9px 14px;border:1px solid #cbd3cb;background:white;border-radius:6px;cursor:pointer}button:focus-visible,input:focus-visible{outline:3px solid #286c4a;outline-offset:3px}.comparison{position:relative;max-width:100%;width:${result.width}px;background:white;line-height:0;box-shadow:0 1px 10px #23362b18}.comparison img{display:block;width:100%;height:auto}#render{position:absolute;inset:0;opacity:.5}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:24px}.pair img{width:100%;height:auto}figure{margin:0;min-width:0}figcaption{font-weight:600;margin-bottom:8px}.note{font-size:12px}@media(max-width:600px){main{padding:16px}.pair{grid-template-columns:1fr}}</style><main><h1>${title}</h1><p>${renderLabel} · ${result.width} × ${result.height} px · 差异像素比例 ${(result.changedPixelFraction*100).toFixed(2)}%。此数值用于定位差异，不能替代视觉验收。</p><div class="controls"><label for="opacity">复刻图透明度</label><input id="opacity" type="range" min="0" max="100" value="50"><output id="value" for="opacity">50%</output><button id="reference-only">仅参考图</button><button id="render-only">仅复刻图</button></div><div class="comparison"><img src="${data(reference)}" alt="参考图"><img id="render" src="${data(rendered)}" alt="${renderLabel}"></div><div class="pair"><figure><figcaption>差异位置</figcaption><img src="${data(result.difference)}" alt="红色显示超过阈值的像素差异"></figure><figure><figcaption>50% 叠加</figcaption><img src="${data(result.overlay)}" alt="参考图和复刻图各占一半的叠加对照"></figure></div><p class="note">请逐项检查文字、行高、间距、图标形状、颜色、图片裁切和溢出。文本和控件应保持可编辑。</p></main><script>const slider=document.getElementById('opacity');function update(v){slider.value=v;document.getElementById('render').style.opacity=Number(v)/100;document.getElementById('value').textContent=v+'%'}slider.addEventListener('input',()=>update(slider.value));document.getElementById('reference-only').onclick=()=>update('0');document.getElementById('render-only').onclick=()=>update('100');</script></html>`;
  await writeFile(resolve(directory,'comparison.html'),html);
  return { ...metrics, report:resolve(directory,'comparison.html'), overlay:resolve(directory,'overlay.png'), difference:resolve(directory,'difference.png') };
}
