import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { AgentError } from '../protocol.js';
import { constructionSpec, keylineSvg, KEYLINE_SHAPES } from '../plugin/keylines.js';

export function constructionSvg(size:number,artwork?:string) {
  const grid=keylineSvg(size);
  if(!artwork)return grid;
  const content=artwork.replace(/^<svg\b[^>]*>/,'').replace(/<\/svg>\s*$/,'');
  return grid.replace('<g id="keylines"',`<g id="artwork">${content}</g><g id="keylines"`);
}
export function constructionPanel(size:number,artwork?:string) {
  return `<section class="construction-section"><h2>几何构造底板</h2><p>外框、中心线、对角线、内接圆与圆角矩形。辅助线单独编辑，成品导出仅包含 Artwork。</p><label class="guide-control"><input id="show-guides" type="checkbox" checked>显示构造辅助线</label><div class="construction-canvas">${artwork??''}<div id="guide-overlay">${keylineSvg(size)}</div></div></section>`;
}
export const constructionStyle = `.construction-section{margin-top:28px}.construction-section h2{font-size:18px}.guide-control{display:inline-flex;gap:8px;align-items:center;margin-bottom:16px;min-height:32px}.guide-control input{accent-color:#28634b}.guide-control input:focus-visible{outline:3px solid #28634b;outline-offset:3px}.construction-canvas{position:relative;width:min(100%,460px);aspect-ratio:1;background:#f8f5fb;margin:0 0 20px}.construction-canvas>svg,#guide-overlay,#guide-overlay svg{position:absolute;inset:0;width:100%;height:100%}#guide-overlay[hidden]{display:none}`;
export const constructionScript = `document.getElementById('show-guides').onchange=function(){document.getElementById('guide-overlay').hidden=!this.checked};`;
export async function writeGrid(directory:string,size=1024) {
  const spec=constructionSpec(size,[],`Icon keylines / ${size}`),svg=keylineSvg(size),dir=resolve(directory);
  await mkdir(dirname(dir),{recursive:true});
  try{await mkdir(dir);}catch(e:any){if(e.code==='EEXIST')throw new AgentError('OUTPUT_EXISTS','The construction directory already exists.','Use a new directory.');throw e;}
  await writeFile(resolve(dir,'figma.json'),JSON.stringify(spec,null,2)+'\n');
  await writeFile(resolve(dir,'construction.svg'),svg);
  const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>图标几何构造底板</title><style>*{box-sizing:border-box}body{font:14px system-ui;margin:0;color:#2f3433;background:#f5f4f7}main{max-width:940px;margin:auto;padding:24px}h1{font-size:22px}p{line-height:1.7}a{color:#28634b;display:inline-block;padding:10px 12px}a:focus-visible{outline:3px solid #28634b;outline-offset:3px}${constructionStyle}@media(max-width:400px){main{padding:16px}}</style><main><h1>图标构造网格 · ${size} × ${size}</h1><p>基于提供的参考图重建比例，可用于小图标与 App Icon 的几何造型。</p>${constructionPanel(size)}<a href="construction.svg" download>下载构造网格 SVG</a><a href="figma.json" download>下载 Figma 可编辑底板</a><p>导入后在 Artwork 中造型。Guides 是锁定的辅助图层；用 icon shape 命令从几何模板创建可参与布尔运算的实心操作数。</p></main><script>${constructionScript}</script></html>`;
  await writeFile(resolve(dir,'preview.html'),html);
  return {directory:dir,size,shapes:KEYLINE_SHAPES,spec:resolve(dir,'figma.json'),svg:resolve(dir,'construction.svg'),preview:resolve(dir,'preview.html'),next:'Apply figma.json, save keys.workbench and keys.icon. Use icon shape <workbench-id> circle and inner-circle, then boolean subtract the two returned IDs. Export the workbench normally for clean artwork; pass --with-guides only for a construction review.'};
}
