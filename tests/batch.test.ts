import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBatch, runBatch } from '../src/cli/batch.js';
import { Broker } from '../src/bridge/broker.js';
const command = (id: string) => ({ id, method: 'document', params: {}, timeoutMs: 1000 });
const route = (name: string) => ({ name, sessionId: name, commands: [command(name+'1'), command(name+'2')] });

test('batch validates every route before dispatch and rejects ambiguous routing', () => {
  for (const input of [{routes:[]}, {routes:[route('a')], concurrency:0}, {routes:[route('a'),route('a')]},
    {routes:[{...route('a'),commands:[command('same'),command('same')]}]},
    {routes:[{...route('a'),commands:[{...command('x'),method:'bogus'}]}]}])
    assert.throws(() => parseBatch(input));
});
test('routes overlap with bounded concurrency and ordered steps', async () => {
  let active=0, peak=0; const order:string[]=[];
  const batch=parseBatch({routes:['a','b','c'].map(route),concurrency:2});
  const result=await runBatch(batch,async cmd=>{
    active++;peak=Math.max(peak,active);order.push(cmd.id);
    await new Promise(resolve=>setTimeout(resolve,5));active--;
    return {ok:true,id:cmd.id,result:cmd.id};
  });
  assert.equal(peak,2);assert.equal(result.ok,true);
  assert.ok(order.indexOf('a1')<order.indexOf('a2'));assert.ok(order.indexOf('b1')<order.indexOf('a2'));
  assert.deepEqual(result.routes.map(r=>r.name),['a','b','c']);
});
test('failure and transport errors stop only affected route without retrying',async()=>{
  const seen:string[]=[];
  const result=await runBatch(parseBatch({routes:['a','b','c'].map(route)}),async cmd=>{
    seen.push(cmd.id);
    if(cmd.id==='a1')return {ok:false,id:cmd.id,error:{code:'EXECUTION_UNCERTAIN',message:'inspect first'}};
    if(cmd.id==='b1')throw new Error('transport lost');
    return {ok:true,id:cmd.id,result:1};
  });
  assert.equal(result.ok,false);assert.deepEqual(result.routes.map(r=>r.skipped),[['a2'],['b2'],[]]);
  assert.deepEqual(seen.sort(),['a1','b1','c1','c2']);
});
test('independent broker sessions run concurrently and replies remain isolated',async t=>{
  const b=new Broker();t.after(()=>b.close());
  const context={document:'test',page:'p',pageId:'0:1',selection:[]};
  const a=b.register(context),c=b.register(context);
  const batch=parseBatch({routes:[{...route('a'),sessionId:a},{...route('b'),sessionId:c}]});
  const result=runBatch(batch,(cmd,session)=>b.submit(cmd,session));
  const [first,second]=await Promise.all([b.poll(a).promise,b.poll(c).promise]);
  assert.equal(first?.id,'a1');assert.equal(second?.id,'b1');
  assert.equal(b.list().filter(s=>s.busy).length,2);
  assert.throws(()=>b.result(c,{ok:true,id:'a1',result:1}));
  b.result(a,{ok:true,id:'a1',result:1});b.result(c,{ok:true,id:'b1',result:2});
  const [nextA,nextB]=await Promise.all([b.poll(a).promise,b.poll(c).promise]);
  b.result(a,{ok:true,id:nextA!.id,result:3});b.result(c,{ok:true,id:nextB!.id,result:4});
  assert.equal((await result).ok,true);
});

test('concurrency one completes each route before starting the next',async()=>{
  const order:string[]=[];
  await runBatch(parseBatch({routes:['a','b'].map(route)},1),async cmd=>{
    order.push(cmd.id);return {ok:true,id:cmd.id,result:1};
  });
  assert.deepEqual(order,['a1','a2','b1','b2']);
});
