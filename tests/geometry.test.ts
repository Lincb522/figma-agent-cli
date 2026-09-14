import { test } from 'node:test';
import assert from 'node:assert/strict';
import { geometry, booleanSet, inverse, multiply } from '../src/plugin/geometry.js';
import { applyDesign } from '../src/plugin/design.js';
import { audit } from '../src/plugin/audit.js';
import { fixture } from './figma-fixture.js';

for(const operation of ['union','subtract','intersect','exclude'] as const)test(`${operation} creates an editable boolean and replaces source nodes only after success`,async()=>{
  const f=fixture();const a=f.api.createRectangle(),b=f.api.createEllipse();a.name='base';b.name='cutter';b.x=40;
  const result=await geometry(f.api,{operation,ids:[a.id,b.id]});
  assert.equal(result.type,'BOOLEAN_OPERATION');assert.equal(result.operandIds.length,2);assert.equal(a.removed,true);assert.equal(b.removed,true);
  assert.equal(f.page.children.length,1);assert.equal(f.nodes.get(result.id).children.length,2);assert.deepEqual(f.geometryCalls[0].names,['base','cutter']);
});
test('subtract order follows explicit operands even when source layer order is reversed',async()=>{
  const f=fixture();const cutter=f.api.createEllipse(),base=f.api.createRectangle();base.name='base';cutter.name='cutter';
  await geometry(f.api,{operation:'subtract',ids:[base.id,cutter.id],keepInputs:true});
  assert.deepEqual(f.geometryCalls[0].names,['base','cutter']);assert.equal(base.removed,false);assert.equal(cutter.removed,false);assert.equal(f.page.children.length,3);
});
test('a native boolean failure leaves original IDs, order and transforms intact and removes staging nodes',async()=>{
  const f=fixture();const a=f.api.createRectangle(),b=f.api.createEllipse();a.x=120;b.x=160;
  f.api.subtract=()=>{throw new Error('Native geometry failed');};
  await assert.rejects(geometry(f.api,{operation:'subtract',ids:[a.id,b.id]}),/Native geometry/);
  assert.deepEqual(f.page.children,[a,b]);assert.equal(a.x,120);assert.equal(b.x,160);assert.equal(f.nodes.size,3);
});
test('rotated target preserves the source world transform when reparenting the result',async()=>{
  const f=fixture();const parent=f.api.createFrame();parent.relativeTransform=[[0,-1,300],[1,0,100]];
  const a=f.api.createRectangle(),b=f.api.createEllipse();a.x=20;a.y=30;b.x=40;b.y=30;
  const result=await geometry(f.api,{operation:'union',ids:[a.id,b.id],parentId:parent.id,keepInputs:true});
  const node=f.nodes.get(result.id);assert.deepEqual(node.absoluteTransform,[[1,0,20],[0,1,30]]);
});
test('duplicate, nested, and cross-parent operands are rejected before cloning',async()=>{
  const f=fixture();const parent=f.api.createFrame(),child=f.api.createRectangle(),other=f.api.createEllipse();parent.appendChild(child);
  await assert.rejects(geometry(f.api,{operation:'union',ids:[child.id,child.id]}),/distinct/);
  await assert.rejects(geometry(f.api,{operation:'union',ids:[parent.id,child.id]}),/ancestor/);
  await assert.rejects(geometry(f.api,{operation:'union',ids:[child.id,other.id]}),/different parents/);
  assert.equal(f.nodes.size,4);
});
test('flatten and stroke outline return vectors, and missing strokes do not consume input',async()=>{
  const f=fixture();const a=f.api.createRectangle();const result=await geometry(f.api,{operation:'flatten',ids:[a.id]});assert.equal(result.type,'VECTOR');
  const b=f.api.createRectangle();await assert.rejects(geometry(f.api,{operation:'outline',ids:[b.id]}),/no stroke/);assert.equal(b.removed,false);
  b.strokes=[{type:'SOLID',color:{r:1,g:0,b:0}}];const outlined=await geometry(f.api,{operation:'outline',ids:[b.id]});assert.equal(outlined.type,'VECTOR');assert.equal(b.removed,true);
});
test('boolean-set retains the node and operand IDs',async()=>{
  const f=fixture();const a=f.api.createRectangle(),b=f.api.createEllipse();const result=await geometry(f.api,{operation:'union',ids:[a.id,b.id]});
  const edited=await booleanSet(f.api,result.id,'exclude');assert.equal(edited.id,result.id);assert.deepEqual(edited.operandIds,result.operandIds);assert.equal(edited.operation,'EXCLUDE');
});
test('nested boolean design specs support constructive icons and clean up on later failure',async()=>{
  const f=fixture();const result=await applyDesign(f.api,{nodes:[{key:'icon',type:'BOOLEAN',operation:'SUBTRACT',props:{name:'Ring',x:10,y:10},children:[{type:'ELLIPSE',props:{width:48,height:48}},{type:'ELLIPSE',props:{x:8,y:8,width:32,height:32}}]}]});
  assert.equal(f.nodes.get(result.keys.icon).booleanOperation,'SUBTRACT');assert.equal(f.page.children.length,1);
  const before=f.nodes.size;
  await assert.rejects(applyDesign(f.api,{nodes:[{type:'BOOLEAN',operation:'UNION',children:[{type:'RECTANGLE'},{type:'ELLIPSE'}]},{type:'RECTANGLE',props:{rotation:'invalid'}}]}),/Invalid rotation/);
  assert.equal(f.nodes.size,before);
});
test('editable audit distinguishes a screenshot from text and structured UI',async()=>{
  const f=fixture();const screenshot=await applyDesign(f.api,{nodes:[{type:'FRAME',props:{width:100,height:100},children:[{type:'IMAGE',imageBase64:'test'}]}]});
  const checked=await audit(f.api,screenshot.roots[0].id);assert.equal(checked.hasEditableUI,false);assert.equal(checked.fullFrameImageNodeIds.length,1);
  const ui=await applyDesign(f.api,{nodes:[{type:'FRAME',tag:'job-tag',props:{layoutMode:'VERTICAL'},children:[{type:'TEXT',props:{characters:'Settings'}},{type:'RECTANGLE'}]}]});
  const checkedUI=await audit(f.api,ui.roots[0].id);assert.equal(checkedUI.hasEditableUI,true);assert.equal(checkedUI.tag,'job-tag');
});
test('transform inversion handles scaling and translation and rejects singular parents',()=>{
  const t:Transform=[[2,0,30],[0,3,90]];assert.deepEqual(multiply(inverse(t),t),[[1,0,0],[0,1,0]]);assert.throws(()=>inverse([[0,0,0],[0,0,0]]),/non-invertible/);
});
