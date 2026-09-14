import { test } from 'node:test';
import assert from 'node:assert/strict';
import { constructionSpec, keylineGeometry, shapeFromKeyline, keylineSvg } from '../src/plugin/keylines.js';
import { applyDesign, validateSpec } from '../src/plugin/design.js';
import { geometry } from '../src/plugin/geometry.js';
import { audit } from '../src/plugin/audit.js';
import { execute } from '../src/plugin/commands.js';
import { fixture } from './figma-fixture.js';

test('construction keylines preserve the reference proportions on 24 and 1024 px canvases',()=>{
  for(const size of [24,1024]) {
    const shapes=keylineGeometry(size);assert.equal(shapes.length,5);
    const circle=shapes[0],inner=shapes[1];assert.ok(Math.abs(circle.width/size-20/24)<1e-9);assert.equal(inner.width,circle.width/2);
    for(const s of shapes){assert.ok(Math.abs(s.x+s.width/2-size/2)<1e-9);assert.ok(Math.abs(s.y+s.height/2-size/2)<1e-9);}
    validateSpec(constructionSpec(size));assert.match(keylineSvg(size),/id="keyline-portrait"/);assert.match(keylineSvg(size),/id="keylines"/);
  }
});
test('empty grids do not masquerade as editable icon artwork, and boolean operands are copied out of guides',async()=>{
  const f=fixture(),created=await applyDesign(f.api,constructionSpec(1024));
  const before=await audit(f.api,created.keys.workbench);assert.equal(before.hasEditableIcon,false);assert.equal(before.vectorShapeCount,0);
  const guide=f.nodes.get(created.keys.guides);const count=guide.children.length;
  const outer=await shapeFromKeyline(f.api,created.keys.workbench,'circle');
  const inner=await shapeFromKeyline(f.api,created.keys.workbench,'inner-circle');
  assert.equal(guide.children.length,count);assert.equal(guide.locked,true);
  assert.equal(f.nodes.get(outer.id).parent.id,created.keys.icon);assert.equal(f.nodes.get(outer.id).opacity,1);assert.equal(f.nodes.get(outer.id).locked,false);
  assert.deepEqual(f.nodes.get(outer.id).strokes,[]);assert.equal(f.nodes.get(outer.id).fills[0].type,'SOLID');
  const result=await geometry(f.api,{operation:'subtract',ids:[outer.id,inner.id]});assert.equal(result.type,'BOOLEAN_OPERATION');assert.equal(f.nodes.get(result.id).parent.id,created.keys.icon);
  assert.equal((await audit(f.api,created.keys.workbench)).hasEditableIcon,true);
  await assert.rejects(geometry(f.api,{operation:'flatten',ids:[created.keys['guide-circle']]}),{code:'GUIDE_OPERAND'});
  await assert.rejects(geometry(f.api,{operation:'flatten',ids:[created.keys.workbench]}),{code:'GUIDE_OPERAND'});
  assert.equal(guide.children.length,count);
});
test('workbench export uses Artwork without mutating guides; explicit guide exports use the construction frame',async()=>{
  const f=fixture(),created=await applyDesign(f.api,constructionSpec(1024));const calls:string[]=[];
  for(const key of ['icon','workbench'])f.nodes.get(created.keys[key]).exportAsync=async()=>{calls.push(key);return new Uint8Array([1,2,3]);};
  (f.api as any).base64Encode=(bytes:Uint8Array)=>Buffer.from(bytes).toString('base64');
  const run=(includeGuides=false)=>execute(f.api,{id:'export',method:'export',params:{id:created.keys.workbench,format:'PNG',includeGuides},timeoutMs:10000});
  const clean=await run();assert.equal(clean.nodeId,created.keys.icon);assert.equal(clean.guidesExcluded,true);assert.equal(f.nodes.get(created.keys.guides).visible,true);
  const construction=await run(true);assert.equal(construction.nodeId,created.keys.workbench);assert.equal(construction.guidesExcluded,false);assert.deepEqual(calls,['icon','workbench']);
});
