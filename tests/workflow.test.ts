import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';
import { prepareJob, importReference, requestGeneration, acceptGeneratedReference, readJob, applyReconstruction, recoverApplication, captureReconstruction, compareReference, type Transport } from '../src/workflow/jobs.js';
import { comparePNGs, loadDesign } from '../src/workflow/images.js';
import { execute } from '../src/plugin/commands.js';
import { fixture } from './figma-fixture.js';
import { constructionSpec } from '../src/plugin/keylines.js';
import { fault } from '../src/protocol.js';

export function png(width=64,height=64,color=[255,255,255,255]) {
  const image=new PNG({width,height}); for(let i=0;i<image.data.length;i+=4) image.data.set(color,i); return PNG.sync.write(image);
}
async function setup(t:any,kind:'ui'|'icon'|'appicon'='ui') {
  const base=resolve(process.env.FIGMA_AGENT_TEST_OUTPUT??'work/verification');await mkdir(base,{recursive:true});
  const dir=await mkdtemp(resolve(base,'workflow-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const job=resolve(dir,'job');await prepareJob(job,'Editable test reference',64,64,kind);
  const reference=resolve(dir,'source.png');await writeFile(reference,png());
  const layout=resolve(dir,'layout.json');await writeFile(layout,JSON.stringify({nodes:[{key:'screen',type:'FRAME',props:{width:64,height:64},children:[{type:'RECTANGLE',props:{width:24,height:24}},{type:'TEXT',props:{characters:'Hello'}}]}]}));
  return {dir,job,reference,layout};
}
function transportFixture() {
  const f=fixture();const calls:string[]=[];const replies=new Map<string,any>();
  (f.api as any).base64Encode=(data:Uint8Array)=>Buffer.from(data).toString('base64');
  const transport:Transport={send:async(method,params,id,sessionId)=>{
    calls.push(method);let reply;
    try{reply={ok:true as const,id,result:await execute(f.api,{id,method,params,timeoutMs:10000})};}
    catch(error){reply={ok:false as const,id,error:fault(error)};}
    replies.set(id,{state:'completed',sessionId,reply});return reply;
  },lookup:async(id)=>replies.get(id)};
  return {f,transport,calls,replies};
}
test('job creation preserves existing work; icon defaults are square with distinct prompts',async t=>{
  const {dir,job}=await setup(t);
  await assert.rejects(prepareJob(job,'replacement'),{code:'JOB_ALREADY_EXISTS'});
  const created=await prepareJob(resolve(dir,'app'),'Camera app',undefined,undefined,'appicon');
  assert.deepEqual(created.job.requestedSize,{width:1024,height:1024});assert.match(await readFile(created.prompt,'utf8'),/base plate/);
});
test('reference import is hashed, locked and reports imported provenance',async t=>{
  const {job,reference}=await setup(t);await writeFile(resolve(job,'.lock'),'synthetic competing process');
  await assert.rejects(importReference(job,reference),{code:'JOB_BUSY'});await rm(resolve(job,'.lock'));
  const result=await importReference(job,reference);assert.equal(result.job.reference?.source,'imported');assert.equal(result.job.reference?.sha256.length,64);
});
test('PNG comparison has exact dimensions, visible alpha composition and honest external provenance',async t=>{
  const {job,reference}=await setup(t);await importReference(job,reference);
  const same=comparePNGs(png(),png());assert.equal(same.changedPixelFraction,0);
  const black=comparePNGs(png(),png(64,64,[0,0,0,255]));assert.equal(black.meanAbsoluteChannelError,255);assert.equal(black.changedPixelFraction,1);
  assert.equal(comparePNGs(png(),png(64,64,[0,0,0,0])).changedPixelFraction,0);
  assert.throws(()=>comparePNGs(png(),png(32,32)),{code:'DIMENSION_MISMATCH'});
  const report=await compareReference(job,reference);assert.equal(report.source,'external');
  const html=await readFile(report.report,'utf8');assert.match(html,/外部 PNG/);assert.doesNotMatch(html,/Figma 导出的/);
  assert.equal(await readFile(resolve(job,'comparison.html')).then(()=>true,()=>false),false);
});
test('relative raster assets hydrate; traversal and symlinks cannot escape the layout directory',async t=>{
  const {dir,reference}=await setup(t);const assets=resolve(dir,'assets');await mkdir(assets);
  const layout=resolve(assets,'layout.json');const write=async(path:string)=>writeFile(layout,JSON.stringify({nodes:[{type:'IMAGE',imagePath:path}]}));
  await writeFile(resolve(assets,'photo.png'),png());await write('photo.png');assert.equal((await loadDesign(layout)).nodes[0].imageBase64, (await readFile(reference)).toString('base64'));
  await write('../source.png');await assert.rejects(loadDesign(layout),{code:'ASSET_OUTSIDE_DESIGN'});
  await symlink(reference,resolve(assets,'linked.png'));await write('linked.png');await assert.rejects(loadDesign(layout),{code:'ASSET_OUTSIDE_DESIGN'});
});
test('apply persists request identity before submission; recover never resubmits uncertain work',async t=>{
  const {job,reference,layout}=await setup(t);await importReference(job,reference);
  const original=transportFixture();let sentId='';
  const uncertain:Transport={...original.transport,send:async(method,params,id,session)=>{
    sentId=id;assert.equal((await readJob(job)).application?.requestId,id);await original.transport.send(method,params,id,session);throw new Error('response lost');
  }};
  await assert.rejects(applyReconstruction(job,layout,'session-a',uncertain),/response lost/);
  assert.equal((await readJob(job)).phase,'apply_uncertain');assert.ok(sentId);
  await assert.rejects(applyReconstruction(job,layout,'session-a',uncertain),{code:'RECONSTRUCTION_EXISTS'});
  const recovered=await recoverApplication(job,original.transport);assert.equal(recovered.job.phase,'applied');assert.deepEqual(original.calls,['apply']);
  assert.equal(original.f.nodes.get(recovered.job.application!.referenceNodeId!).locked,true);
});
test('capture checks live job tag, editable structure and exact export dimensions before recording success',async t=>{
  const {job,reference,layout}=await setup(t);await importReference(job,reference);const {f,transport,calls}=transportFixture();
  const applied=await applyReconstruction(job,layout,'session-a',transport);const node=f.nodes.get(applied.job.application!.rootId!);
  node.exportAsync=async()=>new Uint8Array(png());
  node.setPluginData('figma-agent:tag','different-job');await assert.rejects(captureReconstruction(job,transport,'other-session'),{code:'WRONG_RECONSTRUCTION'});assert.ok(!calls.includes('export'));
  node.setPluginData('figma-agent:tag',applied.job.id);const capture=await captureReconstruction(job,transport);
  assert.equal(capture.job.phase,'captured');assert.equal(capture.job.capture!.comparison.source,'figma');assert.deepEqual(await readFile(capture.render),png());
  node.exportAsync=async()=>new Uint8Array(png(32,32));await assert.rejects(captureReconstruction(job,transport),{code:'DIMENSION_MISMATCH'});
  assert.deepEqual(await readFile(capture.render),png());
});
test('changed references and screenshot-only layouts are rejected before sending',async t=>{
  const {job,reference,layout}=await setup(t);await importReference(job,reference);const {transport,calls}=transportFixture();
  await writeFile(resolve(job,'reference.png'),png(64,64,[0,0,0,255]));await assert.rejects(applyReconstruction(job,layout,'session',transport),{code:'REFERENCE_CHANGED'});
  await importReference(job,reference);await writeFile(layout,JSON.stringify({nodes:[{type:'FRAME',props:{width:64,height:64},children:[{type:'IMAGE',imageBase64:png().toString('base64')}]}]}));
  await assert.rejects(applyReconstruction(job,layout,'session',transport),{code:'EDITABLE_UI_REQUIRED'});assert.deepEqual(calls,[]);
});
test('appicon reconstruction accepts editable boolean marks without requiring fake text',async t=>{
  const {job,reference,layout}=await setup(t,'appicon');await importReference(job,reference);const {f,transport}=transportFixture();
  await writeFile(layout,JSON.stringify({nodes:[{type:'FRAME',props:{width:64,height:64},children:[{type:'RECTANGLE',props:{width:64,height:64}},{type:'BOOLEAN',operation:'SUBTRACT',children:[{type:'ELLIPSE',props:{width:40,height:40}},{type:'ELLIPSE',props:{width:20,height:20,x:10,y:10}}]}]}]}));
  const applied=await applyReconstruction(job,layout,'session',transport);f.nodes.get(applied.job.application!.rootId!).exportAsync=async()=>new Uint8Array(png());
  const captured=await captureReconstruction(job,transport);assert.equal(captured.job.capture!.audit.hasEditableIcon,true);assert.equal(captured.job.capture!.audit.textCount,0);
});
test('image_gen handoff records one prompt and does not claim generation or require a provider',async t=>{
  const {job}=await setup(t);const request=await requestGeneration(job);
  assert.equal(request.tool,'image_gen');assert.equal(request.generated,false);assert.equal(request.phase,'awaiting_image');
  assert.equal(request.arguments.prompt,await readFile(resolve(job,'prompt.txt'),'utf8'));
  const state=await readJob(job);assert.equal(state.generation?.id,request.generationId);assert.equal(state.reference,undefined);
  await assert.rejects(requestGeneration(job),{code:'GENERATION_ALREADY_STARTED'});
});
test('accept validates the handoff ID, preserves agent-reported provenance and makes identical retries idempotent',async t=>{
  const {job,reference,dir}=await setup(t);const request=await requestGeneration(job);
  await assert.rejects(acceptGeneratedReference(job,reference,'wrong','synthetic-result'),{code:'GENERATION_ID_MISMATCH'});
  const accepted=await acceptGeneratedReference(job,reference,request.generationId,'synthetic-result');
  assert.equal(accepted.job.phase,'reference_ready');assert.equal(accepted.job.reference?.source,'image_gen');assert.equal(accepted.job.generation?.receipt?.provenance,'agent-reported');
  assert.equal(accepted.reused,false);assert.equal((await acceptGeneratedReference(job,reference,request.generationId,'synthetic-result')).reused,true);
  const different=resolve(dir,'different.png');await writeFile(different,png(64,64,[0,0,0,255]));
  await assert.rejects(acceptGeneratedReference(job,different,request.generationId,'synthetic-result'),{code:'REFERENCE_ALREADY_ACCEPTED'});
  await writeFile(resolve(job,'reference.png'),await readFile(different));
  await assert.rejects(acceptGeneratedReference(job,reference,request.generationId,'synthetic-result'),{code:'REFERENCE_CHANGED'});
});
test('invalid image and changed prompts cannot be accepted as image_gen output',async t=>{
  const {job,reference,dir}=await setup(t);const request=await requestGeneration(job);
  const invalid=resolve(dir,'invalid.png');await writeFile(invalid,'not a PNG');
  await assert.rejects(acceptGeneratedReference(job,invalid,request.generationId,'synthetic-result'),{code:'PNG_REQUIRED'});assert.equal((await readJob(job)).phase,'awaiting_image');
  await writeFile(resolve(job,'prompt.txt'),'Changed after handoff');
  await assert.rejects(acceptGeneratedReference(job,reference,request.generationId,'synthetic-result'),{code:'GENERATION_REQUEST_CHANGED'});assert.equal((await readJob(job)).reference,undefined);
});
test('imported references cannot be relabeled by an older generation request',async t=>{
  const {job,reference}=await setup(t);const request=await requestGeneration(job);await importReference(job,reference);
  await assert.rejects(acceptGeneratedReference(job,reference,request.generationId,'synthetic-result'),{code:'GENERATION_NOT_AWAITING'});
  assert.equal((await readJob(job)).reference?.source,'imported');
});
test('accepted image_gen reference continues through native reconstruction and capture',async t=>{
  const {job,reference,layout}=await setup(t);const request=await requestGeneration(job);await acceptGeneratedReference(job,reference,request.generationId,'synthetic-result');
  const {f,transport}=transportFixture();const applied=await applyReconstruction(job,layout,'synthetic-session',transport);
  f.nodes.get(applied.job.application!.rootId!).exportAsync=async()=>new Uint8Array(png());
  const captured=await captureReconstruction(job,transport);assert.equal(captured.job.phase,'captured');assert.equal(captured.job.reference?.source,'image_gen');
});

test('construction guides alone cannot satisfy the generated icon reconstruction requirement',async t=>{
  const {job,reference,layout}=await setup(t,'appicon');const request=await requestGeneration(job);await acceptGeneratedReference(job,reference,request.generationId,'synthetic-result');
  await writeFile(layout,JSON.stringify(constructionSpec(64)));const {transport,calls}=transportFixture();
  await assert.rejects(applyReconstruction(job,layout,'session',transport),{code:'EDITABLE_UI_REQUIRED'});assert.deepEqual(calls,[]);
});
