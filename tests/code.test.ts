import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { transform } from 'esbuild';
import { renderCode, exportCode } from '../src/workflow/code.js';
import { collectCodeDesign } from '../src/workflow/code-snapshot.js';
import { fixture } from './figma-fixture.js';
import type { Transport } from '../src/workflow/jobs.js';

const snapshot = () => ({document:'Test',page:'Page',warnings:[],root:{id:'1:1',name:'<script>title</script>',type:'FRAME',width:390,height:844,layoutMode:'VERTICAL',children:[
  {id:'1:2',name:'Text',type:'TEXT',width:320,height:40,relativeTransform:[[1,0,24],[0,1,48]],fontSize:20,characters:'<script>window.bad = true</script>',segments:[{characters:'<Hello> ',fontSize:20},{characters:'世界',fontSize:24,fontWeight:700}]},
  {id:'1:4',type:'TEXT',width:26,height:20,relativeTransform:[[1,0,24],[0,1,100]],characters:'画质',fontSize:13,fontName:{family:'Missing Test Font',style:'Regular'},lineHeight:{unit:'PIXELS',value:20}},
  {id:'1:3',type:'VECTOR',width:24,height:24,relativeTransform:[[1,0,330],[0,1,48]],assetFormat:'SVG'},
]}});
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="10" fill="red"/></svg>';
function transport(changed=false): Transport {
  let scans=0;
  return {lookup:async()=>({state:"completed",sessionId:"session"}),send:async(method,params,id)=>{
    if(method==='eval'){const data=snapshot();if(scans++ && changed)data.root.name='Changed';return {ok:true,id,result:data};}
    assert.equal(method,'export');const bytes=Buffer.from(params.format==='SVG'?svg:'synthetic png bytes');
    return {ok:true,id,result:{nodeId:params.id,format:params.format,base64:bytes.toString('base64'),byteLength:bytes.length}};
  }};
}
test('renderer preserves native text, geometry, assets and JSX escaping',async()=>{
  const result=renderCode(snapshot(),'react');
  assert.ok(result.html.includes('&lt;Hello&gt;'));assert.ok(!result.html.includes('<script>'));
  assert.match(result.css,/left: 24px; top: 48px/);assert.match(result.css,/font-size: 24px; font-weight: 700/);
  assert.equal(result.assets[0].id,'1:3');assert.match(result.react!,/assetBase/);
  await transform(result.react!,{loader:'tsx'});
});
test('handoff writes assets and source together; existing code and changed designs are preserved',async t=>{
  const base=await mkdtemp(join(tmpdir(),'figma-code-'));t.after(()=>rm(base,{recursive:true,force:true}));
  const dir=join(base,'handoff');const result=await exportCode(dir,'1:1','react','session',transport());
  assert.equal(result.entry,join(dir,'FigmaDesign.tsx'));
  const manifest=JSON.parse(await readFile(result.manifest,'utf8'));assert.equal(manifest.assets.length,1);
  assert.equal(await readFile(join(dir,manifest.assets[0].path),'utf8'),svg);
  await writeFile(join(dir,'FigmaDesign.tsx'),'user edit');
  await assert.rejects(exportCode(dir,'1:1','react','session',transport()),{code:'CODE_DIRECTORY_EXISTS'});
  assert.equal(await readFile(join(dir,'FigmaDesign.tsx'),'utf8'),'user edit');
  const changed=join(base,'changed');await assert.rejects(exportCode(changed,'1:1','html','session',transport(true)),{code:'DESIGN_CHANGED'});
  await assert.rejects(access(changed));
  const broken=transport();broken.send=async(method,params,id,session)=>method==='export'?{ok:false,id,error:{code:'EXPORT_FAILED',message:'Fixture failure'}}:transport().send(method,params,id,session);
  const failed=join(base,'failed');await assert.rejects(exportCode(failed,'1:1','html','session',broken),{code:'EXPORT_FAILED'});await assert.rejects(access(failed));
});
test('collector reads mixed text and preserves masks and reactions without modifying nodes',async()=>{
  const f=fixture();const root=f.api.createFrame() as any;root.exportAsync=async()=>new Uint8Array();root.getCSSAsync=async()=>({display:'flex'});
  const mask=f.api.createRectangle() as any;mask.isMask=true;root.appendChild(mask);
  await f.api.loadFontAsync({family:'Inter',style:'Regular'});const text=f.api.createText() as any;text.characters='Hello';text.fontSize=f.api.mixed;
  text.getStyledTextSegments=()=>[{characters:'Hello',fontSize:20,fontName:{family:'Inter',style:'Regular'}}];root.appendChild(text);
  root.reactions=[{trigger:{type:'ON_CLICK'},actions:[{type:'BACK'}]}];
  const before=[...f.nodes.keys()];const data=await collectCodeDesign(f.api,root.id);
  assert.equal(data.root.assetFormat,'PNG');assert.equal(data.root.children[1].segments[0].fontSize,20);assert.ok(!('fontSize' in data.root.children[1]));
  assert.deepEqual(data.root.reactions,root.reactions);assert.deepEqual([...f.nodes.keys()],before);
  f.page.selection=[];await assert.rejects(collectCodeDesign(f.api),/Choose one/);
});
