import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDesign, inspectNode, patchNode, solid } from '../src/plugin/design.js';
import { execute } from '../src/plugin/commands.js';
import { fixture } from './figma-fixture.js';

test('creates editable nested auto layout with loaded fonts and stable returned keys', async () => {
  const f = fixture();
  const result = await applyDesign(f.api, { nodes: [{ key: 'screen', type: 'FRAME', props: { name: 'Dashboard', layoutMode: 'VERTICAL', width: 390, height: 844 }, children: [{ key: 'title', type: 'TEXT', props: { characters: '项目概览', width: 320, layoutSizingHorizontal: 'FILL' } }] }] });
  const screen = f.nodes.get(result.keys.screen); const title = f.nodes.get(result.keys.title);
  assert.equal(result.created, 2); assert.equal(title.parent, screen); assert.equal(title.characters, '项目概览'); assert.equal(title.textAutoResize, 'HEIGHT'); assert.equal(f.loaded.size, 1);
  assert.equal(screen.primaryAxisSizingMode, 'FIXED'); assert.equal(screen.counterAxisSizingMode, 'FIXED');
});
test('missing fonts fail before any node is created', async () => {
  const f = fixture(); await assert.rejects(applyDesign(f.api, { nodes: [{ type: 'RECTANGLE' }, { type: 'TEXT', props: { characters: 'X', fontName: { family: 'Missing', style: 'Regular' } } }] }), /Font missing/);
  assert.equal(f.page.children.length, 0);
});
test('creation rollback removes every new root and descendant while preserving existing work', async () => {
  const f = fixture(); const existing = f.api.createRectangle(); existing.name = 'Keep me';
  await assert.rejects(applyDesign(f.api, { nodes: [{ type: 'FRAME', children: [{ type: 'TEXT', props: { characters: 'Valid' } }, { type: 'RECTANGLE', props: { rotation: 'invalid' } }] }] }), /Invalid rotation/);
  assert.deepEqual(f.page.children, [existing]); assert.equal(f.nodes.size, 2);
});
test('duplicate keys and unsupported properties are rejected before mutation', async () => {
  const f = fixture();
  await assert.rejects(applyDesign(f.api, { nodes: [{ key: 'same', type: 'FRAME' }, { key: 'same', type: 'FRAME' }] }), /unique/);
  await assert.rejects(applyDesign(f.api, { nodes: [{ type: 'FRAME', props: JSON.parse('{"__proto__":{}}') }] }), /Unsupported property/);
  assert.equal(f.page.children.length, 0);
});
test('a failing patch restores earlier changed values and both size dimensions', async () => {
  const f = fixture(); const node = f.api.createRectangle(); node.name = 'Original'; node.resize(200, 100);
  await assert.rejects(patchNode(f.api, node.id, { name: 'Changed', width: 400, rotation: 'invalid' }), /Invalid rotation/);
  assert.equal(node.name, 'Original'); assert.equal(node.width, 200); assert.equal(node.height, 100);
});
test('inspection has explicit truncation and follows the requested depth', async () => {
  const f = fixture(); const result = await applyDesign(f.api, { nodes: [{ type: 'FRAME', children: [{ type: 'RECTANGLE' }, { type: 'RECTANGLE' }] }] });
  const frame = f.nodes.get(result.roots[0].id); const tree = inspectNode(frame, 2, 2);
  assert.equal(tree.childCount, 2); assert.equal(tree.children.length, 1); assert.equal(tree.truncated, true);
  assert.equal(inspectNode(frame, 0).children, undefined);
});
test('exec supports async Plugin API code, args and helpers and returns agent-readable IDs', async () => {
  const f = fixture(); const result = await execute(f.api, { id: 'exec-1', method: 'eval', timeoutMs: 1000, params: { code: 'const n = figma.createRectangle(); n.name = args.name; n.fills = [h.solid("#286c4a")]; return { id: n.id, name: (await h.node(n.id)).name };', args: { name: 'Agent-created' } } });
  assert.equal(result.name, 'Agent-created'); assert.ok(f.nodes.has(result.id));
});
test('colors preserve alpha and reject ambiguous shorthand', () => {
  assert.equal(solid('#FFFFFF80').opacity, 128/255); assert.throws(() => solid('#fff'), /six- or eight-digit/);
});
test('line nodes accept the required zero height while rectangles reject it', async () => {
  const f = fixture();
  const result = await applyDesign(f.api, { nodes: [{ type: 'LINE', props: { width: 120, height: 0 } }] });
  assert.equal(f.nodes.get(result.roots[0].id).height, 0);
  await assert.rejects(applyDesign(f.api, { nodes: [{ type: 'RECTANGLE', props: { width: 120, height: 0 } }] }), /at least/);
});
