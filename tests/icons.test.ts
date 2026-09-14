import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIcon, ICONS, validateIcon, iconPreview } from '../src/workflow/icons.js';
import { validateSpec } from '../src/plugin/design.js';

test('all icon marks produce validated editable layer specs and path-only SVG at actual UI and app sizes',()=>{
  for(const icon of Object.values(ICONS)) for(const size of [16,20,24,32,1024]) {
    const built=buildIcon(icon,{size,kind:size===1024?'app':'ui',plate:'rounded'});validateSpec(built.spec);
    assert.equal(built.spec.nodes[0].children?.[0].children?.[0].key,'base');assert.equal(built.spec.nodes[0].children?.[0].children?.[1].type,'SVG');
    assert.match(built.svg,new RegExp(`viewBox="0 0 ${size} ${size}"`));assert.doesNotMatch(built.svg,/<image|<filter|<text|base64/);
    assert.ok(built.metadata.physicalStroke>=1.25);
  }
});
test('base plates have distinct native shapes and can be removed independently',()=>{
  const circle=buildIcon(ICONS.search,{plate:'circle'});assert.equal(circle.spec.nodes[0].children?.[0].children?.[0].type,'ELLIPSE');
  const square=buildIcon(ICONS.search,{plate:'square'});assert.equal(square.spec.nodes[0].children?.[0].children?.[0].props?.cornerRadius,undefined);
  const bare=buildIcon(ICONS.search,{plate:'none'});assert.equal(bare.spec.nodes[0].children?.[0].children?.length,1);assert.equal(bare.metadata.padding,0);
  const app=buildIcon(ICONS.play,{kind:'app'});assert.equal(app.metadata.size,1024);assert.ok(app.metadata.padding>100);
});
test('custom path validation rejects malformed geometry and markup while preserving curves and evenodd fills',()=>{
  for(const d of ['M0 0 L','<script>alert(1)</script>','M0 0','M0 0L1e999 1']) assert.throws(()=>validateIcon({name:'Bad',paths:[{name:'mark',d}]}),{code:'INVALID_ICON_PATH'});
  assert.throws(()=>validateIcon({name:'Bad',paths:[{name:'mark',d:'M0 0L10 10'},{name:'mark',d:'M0 0L10 10'}]}),{code:'INVALID_ICON'});
  const built=buildIcon({name:'Custom <mark>',paths:[{name:'ring',d:'M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0ZM8 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0Z',fill:true,fillRule:'evenodd'}]});
  assert.match(built.svg,/fill-rule="evenodd"/);assert.match(built.svg,/Custom &lt;mark&gt;/);
  assert.doesNotMatch(iconPreview({name:'</title><script>bad</script>',paths:ICONS.play.paths}),/<script>bad/);
});
test('invalid sizing and style options fail before output or Figma mutations',()=>{
  for(const options of [{size:0},{size:24.1},{padding:20},{stroke:0},{radius:100},{foreground:'red'},{background:'url(https://example.com)'}]) assert.throws(()=>buildIcon(ICONS.home,options));
});
