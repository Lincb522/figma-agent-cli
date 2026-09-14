// Run: figma-agent exec examples/design-system.js
// This example creates a new collection and a local component set.
const collection = figma.variables.createVariableCollection(`Agent palette ${Date.now()}`);
const accent = figma.variables.createVariable('color/accent', collection, 'COLOR');
accent.setValueForMode(collection.defaultModeId, { r: 0.157, g: 0.424, b: 0.290 });
const accentPaint = figma.variables.setBoundVariableForPaint(h.solid('#286C4A'), 'color', accent);
const result = await h.apply(['Default', 'Disabled'].map((state, index) => ({
  key: state,
  type: 'COMPONENT',
  props: {
    name: `State=${state}`, x: index * 200, y: 1000,
    width: 168, height: 48, layoutMode: 'HORIZONTAL',
    primaryAxisAlignItems: 'CENTER', counterAxisAlignItems: 'CENTER',
    fills: [accentPaint], cornerRadius: 10, opacity: index ? 0.4 : 1,
  },
  children: [{ type: 'TEXT', props: { name: 'Label', characters: 'New project', fontSize: 14, fontName: { family: 'Inter', style: 'Bold' }, fills: [h.solid('#FFFFFF')] } }],
})));
const components = await Promise.all(result.roots.map(root => h.node(root.id)));
const set = figma.combineAsVariants(components, figma.currentPage);
set.name = 'Button / Primary';
set.x = 0; set.y = 1000;
const instance = components[0].createInstance();
instance.x = 430; instance.y = 1020;
return { collectionId: collection.id, accentVariableId: accent.id, componentSetId: set.id, instanceId: instance.id };
