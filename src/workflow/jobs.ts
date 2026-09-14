import { readFile, writeFile, mkdir, open, unlink, rename } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AgentError, MAX_BODY, type Method, type Reply } from '../protocol.js';
import { GUIDE_TAG } from '../plugin/node-roles.js';
import { hash, loadDesign, readPNG, writeComparison } from './images.js';

type Phase = 'prepared' | 'awaiting_image' | 'reference_ready' | 'applying' | 'apply_uncertain' | 'applied' | 'captured';
export interface DesignJob {
  version: 1; id: string; kind?: 'ui' | 'icon' | 'appicon'; phase: Phase; createdAt: string; requestedSize: { width: number; height: number };
  reference?: { width: number; height: number; sha256: string; source: 'image_gen' | 'imported' };
  generation?: { id: string; tool: 'image_gen'; requestedAt: string; promptHash: string; receipt?: { resultRef: string; acceptedAt: string; sha256: string; provenance: 'agent-reported' } };
  application?: { requestId: string; sessionId: string; rootId?: string; referenceNodeId?: string; keys?: Record<string,string>; layoutHash: string };
  capture?: { exportedAt: string; sha256: string; audit: any; comparison: any };
}
export interface Transport {
  send(method: Method, params: Record<string,any>, id: string, sessionId: string): Promise<Reply>;
  lookup(id: string): Promise<{ state: string; sessionId: string; reply?: Reply }>;
}
const now = () => new Date().toISOString();
async function save(dir: string, job: DesignJob) {
  const temporary = resolve(dir,`job-${randomUUID()}.tmp`);
  await writeFile(temporary,JSON.stringify(job,null,2)+'\n');
  await rename(temporary,resolve(dir,'job.json'));
}
export async function readJob(directory: string): Promise<DesignJob> {
  let job: DesignJob;
  try { job = JSON.parse(await readFile(resolve(directory,'job.json'),'utf8')); }
  catch { throw new AgentError('JOB_NOT_FOUND', 'No readable design job exists in this directory.', 'Use design prepare <brief.txt> --dir <new-directory>.'); }
  if (job.version !== 1 || typeof job.id !== 'string' || !/^[a-f0-9-]{36}$/.test(job.id)) throw new AgentError('INVALID_JOB', 'This is not a supported design job.');
  return job;
}
async function withJob<T>(directory: string, action: (dir: string, job: DesignJob) => Promise<T>): Promise<T> {
  const dir = resolve(directory); const lockPath = resolve(dir,'.lock');
  let lock;
  try { lock = await open(lockPath,'wx',0o600); }
  catch (error: any) { if (error.code === 'EEXIST') throw new AgentError('JOB_BUSY', 'Another process owns this design job.', 'Wait for it to finish. After a crash, inspect the PID in .lock before removing that lock file.'); throw error; }
  try { await lock.writeFile(JSON.stringify({ pid:process.pid,startedAt:now() })); return await action(dir,await readJob(dir)); }
  finally { await lock.close(); await unlink(lockPath); }
}
export async function prepareJob(directory: string, brief: string, width: number | undefined = undefined, height: number | undefined = undefined, kind: 'ui' | 'icon' | 'appicon' = 'ui') {
  if (!['ui','icon','appicon'].includes(kind)) throw new AgentError('INVALID_KIND','Use ui, icon or appicon for a design job.');
  width ??= kind === 'ui' ? 1440 : kind === 'appicon' ? 1024 : 64;
  height ??= kind === 'ui' ? 1024 : width;
  if (!brief.trim()) throw new AgentError('BRIEF_REQUIRED', 'A design brief is required.');
  if (![width,height].every(n => Number.isInteger(n) && n >= (kind === 'ui' ? 64 : 16) && n <= 4096)) throw new AgentError('INVALID_SIZE', 'Requested dimensions must be integers up to 4096, minimum 64 for UI or 16 for icons.');
  const dir=resolve(directory); await mkdir(dirname(dir),{recursive:true});
  try { await mkdir(dir); } catch (error: any) { if (error.code === 'EEXIST') throw new AgentError('JOB_ALREADY_EXISTS','Use a new job directory; existing design work is preserved.'); throw error; }
  const job: DesignJob={version:1,id:randomUUID(),kind,phase:'prepared',createdAt:now(),requestedSize:{width,height}};
  const prompt = kind !== 'ui' ? `Create one ${kind === 'appicon' ? 'app icon with a distinct base plate and a clear central mark' : 'small UI icon with a readable silhouette'} as a visual reference generated with image_gen. Canvas ${width} x ${height} pixels, PNG. Straight-on artwork, no device shell, captions or presentation mockup. Keep simple forms, deliberate negative space and clear small-size readability. The base and mark will be reconstructed as separate editable Figma vector/boolean layers.\n\nBrief:\n${brief.trim()}\n` : `Create a finished UI design reference image for later reconstruction as editable Figma layers.\nCanvas: ${width} x ${height} pixels. Output format: PNG.\n\nProduct brief:\n${brief.trim()}\n\nShow one straight-on, full-canvas application screen. No device shell, perspective, watermarks or presentation background. Use coherent spacing, legible real text, consistent controls and a clear hierarchy. Keep the interface practical and detailed enough to rebuild. This image is a visual reference; all text, controls, layout and simple icons will subsequently be rebuilt as native editable nodes.\n`;
  await writeFile(resolve(dir,'brief.txt'),brief); await writeFile(resolve(dir,'prompt.txt'),prompt); await save(dir,job);
  return {job, directory:dir,prompt:resolve(dir,'prompt.txt'),next:'Run design generate to prepare an image_gen tool request for the invoking agent, or design import with an existing PNG. Then inspect reference.png and write layout.json.'};
}
export async function importReference(directory: string, image: string) {
  return withJob(directory,async(dir,job)=>{
    if (job.application) throw new AgentError('REFERENCE_IN_USE','This reference is already associated with a Figma reconstruction.','Create a new job to use a different reference.');
    const png=await readPNG(resolve(image));
    await writeFile(resolve(dir,'reference.png'),png.bytes);
    job.reference={width:png.width,height:png.height,sha256:png.sha256,source:'imported'};job.phase='reference_ready';await save(dir,job);
    return {job,reference:resolve(dir,'reference.png'),next:'Open reference.png in the agent image viewer. Rebuild native text, layout, controls and boolean icons in layout.json. Use image assets only for raster content.'};
  });
}
export async function requestGeneration(directory: string) {
  return withJob(directory,async(dir,job)=>{
    if(job.phase!=='prepared')throw new AgentError('GENERATION_ALREADY_STARTED','This job already has a reference or a generation request.','Inspect design status and the original image_gen call. Do not invoke the tool again automatically. Use a new job for an intentional new generation.');
    const prompt=await readFile(resolve(dir,'prompt.txt'),'utf8');
    if(!prompt.trim())throw new AgentError('BRIEF_REQUIRED','The generation prompt is empty.');
    const id=randomUUID();
    const handoff={
      protocol:'figma-agent-imagegen-v1',jobId:job.id,generationId:id,
      tool:'image_gen',arguments:{prompt},promptHash:hash(prompt),
      execution:'host-agent-tool',
      instructions:'The invoking agent must call its available image_gen tool with these arguments exactly once. This CLI has not generated an image. Inspect the returned image, then accept the actual output file. If the tool is unavailable, report that fact; do not substitute an API or another generator.',
      accept:{command:'design accept',job:dir,image:'<actual local image_gen output file>',generationId:id,resultRef:'<non-secret tool result ID or returned image path>'},
    };
    await writeFile(resolve(dir,'generation-request.json'),JSON.stringify(handoff,null,2)+'\n');
    job.generation={id,tool:'image_gen',requestedAt:now(),promptHash:handoff.promptHash};job.phase='awaiting_image';await save(dir,job);
    return {...handoff,phase:job.phase,generated:false,request:resolve(dir,'generation-request.json')};
  });
}
export async function acceptGeneratedReference(directory:string,image:string,generationId:string,resultRef:string) {
  return withJob(directory,async(dir,job)=>{
    if(!job.generation||job.generation.tool!=='image_gen'||job.generation.id!==generationId)throw new AgentError('GENERATION_ID_MISMATCH','The generation ID does not match this job.','Use the ID from this job’s generation-request.json.');
    if(typeof resultRef!=='string'||!resultRef.trim()||resultRef.length>1000||/[\r\n]/.test(resultRef))throw new AgentError('RESULT_REF_REQUIRED','Provide a non-secret image_gen tool result ID or the returned image path.');
    const png=await readPNG(resolve(image));
    if(job.reference?.source==='image_gen'&&job.generation.receipt){
      if(job.reference.sha256!==png.sha256||job.generation.receipt.resultRef!==resultRef)throw new AgentError('REFERENCE_ALREADY_ACCEPTED','This generation already has a different accepted result.','Keep the existing reference, or prepare a new job for a new result.');
      await reference(dir,job);
      return {job,reference:resolve(dir,'reference.png'),reused:true};
    }
    if(job.application||job.phase!=='awaiting_image')throw new AgentError('GENERATION_NOT_AWAITING','This job is not waiting for a generated image.','Inspect design status; do not overwrite an existing reconstruction.');
    const request=JSON.parse(await readFile(resolve(dir,'generation-request.json'),'utf8'));
    if(request.generationId!==generationId||request.tool!=='image_gen'||hash(request.arguments?.prompt??'')!==job.generation.promptHash||hash(await readFile(resolve(dir,'prompt.txt'),'utf8'))!==job.generation.promptHash)throw new AgentError('GENERATION_REQUEST_CHANGED','The generation prompt or request changed after the handoff.','Keep the original request intact; use a new job for changed instructions.');
    const temporary=resolve(dir,`reference-${randomUUID()}.tmp`);
    try{await writeFile(temporary,png.bytes);await rename(temporary,resolve(dir,'reference.png'));}
    finally{await unlink(temporary).catch(()=>{});}
    job.generation.receipt={resultRef,acceptedAt:now(),sha256:png.sha256,provenance:'agent-reported'};
    job.reference={width:png.width,height:png.height,sha256:png.sha256,source:'image_gen'};job.phase='reference_ready';await save(dir,job);
    return {job,reference:resolve(dir,'reference.png'),reused:false,next:'Open reference.png and reconstruct native text, controls, vectors or boolean shapes. The recorded tool origin is reported by the agent; PNG validation and hashing do not independently authenticate a remote model.'};
  });
}
async function reference(dir:string,job:DesignJob){if(!job.reference)throw new AgentError('REFERENCE_REQUIRED','Generate or import a reference PNG first.');const png=await readPNG(resolve(dir,'reference.png'));if(png.sha256!==job.reference.sha256)throw new AgentError('REFERENCE_CHANGED','The reference file changed after it was recorded.','Create a new job or re-import before applying a layout.');return png;}
function acceptApplication(job:DesignJob,reply:Reply){
  if(!reply.ok)throw new AgentError(reply.error.code,reply.error.message,reply.error.recovery,reply.error.details);
  if(!reply.result?.roots?.[0]?.id||!reply.result.roots[1]?.id)throw new AgentError('INVALID_APPLY_RESULT','Figma did not return the reconstruction and reference node IDs.');
  job.application!.rootId=reply.result.roots[0].id;job.application!.referenceNodeId=reply.result.roots[1].id;job.application!.keys=reply.result.keys;job.phase='applied';
}
export async function applyReconstruction(directory:string,layoutPath:string,sessionId:string,transport:Transport){
  return withJob(directory,async(dir,job)=>{
    if(job.application)throw new AgentError('RECONSTRUCTION_EXISTS','This job already has an application request.','Use design recover for an uncertain request, or patch the existing nodes using the returned IDs.');
    const png=await reference(dir,job);const spec=await loadDesign(resolve(layoutPath));
    const frame=spec.nodes[0];
    if(spec.nodes.length!==1||frame.type!=='FRAME'||frame.props?.width!==png.width||frame.props?.height!==png.height)throw new AgentError('INVALID_RECONSTRUCTION','layout.json must contain exactly one FRAME with width and height matching reference.png.');
    let texts=0,structure=0,marks=0;
    const count=(n:any)=>{if(n.tag===GUIDE_TAG)return;if(['BOOLEAN','SVG','VECTOR','ELLIPSE','POLYGON','STAR'].includes(n.type))marks++;if(n.type==='TEXT'&&n.props?.characters?.trim())texts++;if(['FRAME','COMPONENT','RECTANGLE','BOOLEAN','SVG','VECTOR'].includes(n.type))structure++;n.children?.forEach(count);};count(frame);
    if(job.kind && job.kind !== 'ui' ? !marks : (!texts||structure<2))throw new AgentError('EDITABLE_UI_REQUIRED','Rebuild UI text and structure, or the icon mark, as native editable layers. A screenshot placed in a frame is not a reconstruction.');
    frame.tag=job.id;
    const supplied=JSON.stringify(spec);spec.nodes.push({type:'IMAGE',tag:job.id+'/reference',imageBase64:png.bytes.toString('base64'),props:{name:'Reference / '+(frame.props?.name??'Design'),width:png.width,height:png.height,x:(frame.props?.x??0)+png.width+80,y:frame.props?.y??0,locked:true}});
    if(Buffer.byteLength(JSON.stringify(spec))>MAX_BODY-4096)throw new AgentError('ASSETS_TOO_LARGE','The reference and layout exceed the bridge request limit.','Reduce the PNG size or split raster assets before applying.');
    job.application={requestId:randomUUID(),sessionId,layoutHash:hash(supplied)};job.phase='applying';await writeFile(resolve(dir,'layout.request.json'),JSON.stringify(spec,null,2)+'\n');await save(dir,job);
    try{const reply=await transport.send('apply',{spec},job.application.requestId,sessionId);acceptApplication(job,reply);await save(dir,job);return {job,next:'Inspect and patch native nodes as needed, then run design capture to export the live Figma frame and create comparison.html.'};}
    catch(error){job.phase='apply_uncertain';await save(dir,job);throw error;}
  });
}
export async function recoverApplication(directory:string,transport:Transport){
  return withJob(directory,async(dir,job)=>{
    if(!job.application)throw new AgentError('NO_APPLICATION','No Figma application request exists for this job.');
    const request=await transport.lookup(job.application.requestId);
    if(request.state!=='completed'||!request.reply)return {job,request,next:'The original request is still pending. Do not apply it with a new ID.'};
    acceptApplication(job,request.reply);await save(dir,job);return {job};
  });
}
export async function captureReconstruction(directory:string,transport:Transport,sessionId?:string){
  return withJob(directory,async(dir,job)=>{
    if(!job.application?.rootId)throw new AgentError('NO_RECONSTRUCTION','No confirmed Figma reconstruction exists.','Apply a layout or recover the previous request first.');
    const png=await reference(dir,job);const target=sessionId??job.application.sessionId;
    const checked=await transport.send('audit',{id:job.application.rootId},randomUUID(),target);
    if(!checked.ok)throw new AgentError(checked.error.code,checked.error.message,checked.error.recovery);
    if(checked.result.tag!==job.id)throw new AgentError('WRONG_RECONSTRUCTION','The node in this session does not belong to this design job.','Choose the original file; node IDs alone are not unique across files.');
    if(job.kind && job.kind !== 'ui' ? !checked.result.hasEditableIcon : !checked.result.hasEditableUI)throw new AgentError('EDITABLE_UI_REQUIRED','The live Figma frame does not contain editable UI text and structure.');
    const exported=await transport.send('export',{id:job.application.rootId,format:'PNG',scale:1,layoutBounds:true},randomUUID(),target);
    if(!exported.ok)throw new AgentError(exported.error.code,exported.error.message,exported.error.recovery);
    const bytes=Buffer.from(exported.result.base64,'base64');if(bytes.length!==exported.result.byteLength)throw new AgentError('INVALID_EXPORT','The export byte count is inconsistent.');
    const comparison=await writeComparison(dir,png.bytes,bytes);await writeFile(resolve(dir,'render.png'),bytes);
    job.capture={exportedAt:now(),sha256:hash(bytes),audit:checked.result,comparison};job.phase='captured';await save(dir,job);
    return {job,render:resolve(dir,'render.png'),report:comparison.report,next:'Open reference.png, render.png and comparison.html. Review text, spacing, shape geometry and raster crops. Pixel metrics are not a visual acceptance decision.'};
  });
}
export async function compareReference(directory:string,renderPath:string){return withJob(directory,async(dir,job)=>{const png=await reference(dir,job);const render=await readPNG(renderPath);const externalDir=resolve(dir,'external-comparison');await mkdir(externalDir,{recursive:true});const result=await writeComparison(externalDir,png.bytes,render.bytes,'external');return {...result,note:'This comparison does not establish that the supplied PNG came from Figma.'};});}
