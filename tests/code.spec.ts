import { test, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderCode } from '../src/workflow/code.js';

const snapshot = () => ({document:'Test',page:'Page',warnings:[],root:{id:'1:1',name:'<script>title</script>',type:'FRAME',width:390,height:844,layoutMode:'VERTICAL',children:[
  {id:'1:2',name:'Text',type:'TEXT',width:320,height:40,relativeTransform:[[1,0,24],[0,1,48]],fontSize:20,characters:'<script>window.bad = true</script>',segments:[{characters:'<Hello> ',fontSize:20},{characters:'世界',fontSize:24,fontWeight:700}]},
  {id:'1:4',type:'TEXT',width:26,height:20,relativeTransform:[[1,0,24],[0,1,100]],characters:'画质',fontSize:13,fontName:{family:'Missing Test Font',style:'Regular'},lineHeight:{unit:'PIXELS',value:20}},
  {id:'1:3',type:'VECTOR',width:24,height:24,relativeTransform:[[1,0,330],[0,1,48]],assetFormat:'SVG'},
]}});
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="10" fill="red"/></svg>';
test('generated HTML renders at source dimensions and keeps text and assets in narrow and wide viewports',async ({ page })=>{
  const dir=await mkdtemp(join(tmpdir(),'figma-code-browser-'));
  const output=renderCode(snapshot(),'html');
  await mkdir(join(dir,'assets'));
  await writeFile(join(dir,'index.html'),output.html);await writeFile(join(dir,'styles.css'),output.css);
  await writeFile(join(dir,output.assets[0].path),svg);
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  try {
  for(const width of [390,1440]){
    await page.setViewportSize({width,height:1000});await page.goto(pathToFileURL(join(dir,'index.html')).href);
    const root=await page.locator('.design').boundingBox();const text=await page.locator('[data-figma-id="1:2"]').boundingBox();
    if(width===390)assert.equal(root!.x,0);
    assert.equal(root!.width,390);assert.equal(root!.height,844);assert.equal(text!.x-root!.x,24);assert.equal(text!.y-root!.y,48);
    assert.equal(await page.locator('[data-figma-id="1:2"]').textContent(),'<Hello> 世界');
    assert.equal(await page.locator('[data-figma-id="1:4"]').evaluate((n:any)=>n.ownerDocument.defaultView.getComputedStyle(n).whiteSpace),'pre');assert.equal(await page.locator('img').evaluate((n:any)=>n.naturalWidth),24);
    assert.equal(await page.locator('script').count(),0);
  }
  expect(errors).toEqual([]);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
