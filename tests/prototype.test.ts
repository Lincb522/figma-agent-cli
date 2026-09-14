import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPrototype, setPrototype } from '../src/plugin/prototype.js';
import { fixture } from './figma-fixture.js';

const transition = { type: 'SMART_ANIMATE', duration: 0.3, easing: { type: 'BOUNCY' } };
const link = (id: string, navigation = 'NAVIGATE', type = 'ON_CLICK') => [{ trigger: { type }, actions: [{ type: 'NODE', destinationId: id, navigation, transition: structuredClone(transition) }] }];
function setup() {
  const f = fixture(); const source = f.api.createFrame(), target = f.api.createFrame();
  let writes = 0; let reactions: any[] = [{ trigger: { type: 'ON_CLICK' }, actions: [{ type: 'BACK' }] }];
  Object.defineProperty(source, 'reactions', { get: () => reactions });
  source.setReactionsAsync = async value => { writes++; reactions = structuredClone(value); };
  return { ...f, source, target, writes: () => writes };
}
test('prototype get returns detached data; set uses the async API once and clear is explicit', async () => {
  const f = setup(); const before = await getPrototype(f.api, f.source.id); before.reactions.length = 0;
  assert.equal(f.source.reactions.length, 1);
  const written = await setPrototype(f.api, f.source.id, link(f.target.id));
  assert.deepEqual(written.reactions, link(f.target.id)); assert.equal(f.writes(), 1);
  assert.equal((await setPrototype(f.api, f.source.id, [])).reactions.length, 0);
});
test('invalid later destinations and malformed time values preserve all existing reactions', async () => {
  const f = setup();
  await assert.rejects(setPrototype(f.api, f.source.id, [...link(f.target.id), ...link('missing')]), /No node exists/);
  for (const duration of [-1, 300, '0.3', NaN]) {
    const reactions: any = link(f.target.id); reactions[0].actions[0].transition.duration = duration;
    await assert.rejects(setPrototype(f.api, f.source.id, reactions), /duration/);
  }
  await assert.rejects(setPrototype(f.api, f.source.id, [{trigger:null,actions:[{type:'BACK'}]}]), /trigger/);
  await assert.rejects(setPrototype(f.api, f.source.id, [{trigger:{type:'ON_CLICK'}, action:{type:'BACK'}}]), /deprecated/);
  assert.equal(f.writes(), 0); assert.equal(f.source.reactions.length, 1);
});
test('hover, press, drag and delayed triggers preserve seconds and custom spring settings', async () => {
  const f = setup();
  const reactions: any[] = ['ON_HOVER','ON_PRESS','ON_DRAG'].flatMap(type => link(f.target.id, 'OVERLAY', type));
  reactions.push({ trigger:{type:'AFTER_TIMEOUT',timeout:1.2}, actions:[{type:'CLOSE'}] });
  reactions[0].actions[0].transition.easing = {type:'CUSTOM_SPRING',easingFunctionSpring:{mass:1,stiffness:120,damping:15,initialVelocity:0}};
  assert.deepEqual((await setPrototype(f.api, f.source.id, reactions)).reactions, reactions);
  reactions[0].actions[0].transition.easing.easingFunctionSpring.mass=0;
  await assert.rejects(setPrototype(f.api, f.source.id, reactions), /positive/);
  assert.equal(f.writes(),1);
});
test('directional transitions and cubic bezier easing validate required fields before writing', async () => {
  const f=setup(); const reactions:any=link(f.target.id);
  reactions[0].actions[0].transition={type:'MOVE_IN',direction:'BOTTOM',matchLayers:false,duration:0.25,easing:{type:'CUSTOM_CUBIC_BEZIER',easingFunctionCubicBezier:{x1:0.2,y1:0,x2:0.8,y2:1}}};
  await setPrototype(f.api,f.source.id,reactions);
  reactions[0].actions[0].transition.direction='UP';
  await assert.rejects(setPrototype(f.api,f.source.id,reactions),/direction/);
  assert.equal(f.writes(),1);
});
test('change-to accepts only variants in the source component set, including nested hotspots', async () => {
  const f=setup(); const group:any=f.api.createFrame(); group.type='COMPONENT_SET';
  const off=f.api.createComponent(), on=f.api.createComponent(); group.appendChild(off); group.appendChild(on); off.appendChild(f.source);
  await setPrototype(f.api,f.source.id,link(on.id,'CHANGE_TO'));
  await assert.rejects(setPrototype(f.api,f.source.id,link(f.target.id,'CHANGE_TO')),/same component set/);
  assert.equal(f.writes(),1);
});
test('wrong page, unsupported node and native failures surface without fabricated success', async () => {
  const f=setup(); const other:any={id:'2:1',type:'PAGE',parent:f.api.root}; (f.target as any).parent=other;
  await assert.rejects(setPrototype(f.api,f.source.id,link(f.target.id)),/same page/);
  await assert.rejects(getPrototype(f.api,f.page.id),/does not support/);
  f.source.setReactionsAsync=async()=>{throw new Error('Native prototype rejected');};
  await assert.rejects(setPrototype(f.api,f.source.id,[]),/Native prototype rejected/);
});

test('legacy native reactions read back as actions arrays suitable for the setter', async () => {
  const f=setup();
  await f.source.setReactionsAsync([{trigger:{type:'ON_CLICK'},action:{type:'BACK'}}]);
  const read=await getPrototype(f.api,f.source.id);
  assert.equal(read.reactions[0].action,undefined);
  assert.deepEqual(read.reactions[0].actions,[{type:'BACK'}]);
  await setPrototype(f.api,f.source.id,read.reactions);
});
