// Run with figma-agent exec. Creates new editable nodes; never rerun an uncertain request.
const created = [];
try {
  const makeState = (name, active) => {
    const state = figma.createComponent(); created.push(state);
    state.name = 'State=' + name; state.resize(64, 36); state.cornerRadius = 18;
    state.fills = [h.solid(active ? '#2D7455' : '#ABB2BA')];
    const knob = figma.createEllipse(); state.appendChild(knob);
    knob.name = 'Knob'; knob.resize(28, 28); knob.x = active ? 32 : 4; knob.y = 4;
    knob.fills = [h.solid('#FFFFFF')];
    return state;
  };
  const off = makeState('Off', false), on = makeState('On', true);
  on.x = 100;
  const variants = figma.combineAsVariants([off, on], figma.currentPage); created.push(variants);
  variants.name = 'Animated Toggle'; variants.x = 480; variants.y = 0;
  const reaction = destinationId => [{trigger:{type:'ON_CLICK'},actions:[{
    type:'NODE',navigation:'CHANGE_TO',destinationId,
    transition:{type:'SMART_ANIMATE',duration:0.3,easing:{type:'BOUNCY'}}
  }]}];
  await h.prototype(off.id, reaction(on.id));
  await h.prototype(on.id, reaction(off.id));
  const screen = figma.createFrame(); created.push(screen);
  screen.name = 'Toggle · Present to interact'; screen.resize(390, 260);
  screen.fills = [h.solid('#F5F6F8')]; screen.cornerRadius = 24;
  const label = figma.createText(); screen.appendChild(label);
  await figma.loadFontAsync({family:'Inter',style:'Regular'});
  label.fontName = {family:'Inter',style:'Regular'}; label.characters = 'Notifications'; label.fontSize = 20; label.x = 28; label.y = 42;
  const instance = off.createInstance(); screen.appendChild(instance); instance.x = 298; instance.y = 36;
  figma.currentPage.selection = [screen]; figma.viewport.scrollAndZoomIntoView([screen]);
  return {previewFrameId:screen.id,componentSetId:variants.id,offId:off.id,onId:on.id,instanceId:instance.id,verification:'Open this frame in Figma Present and click the toggle in both directions. Playback is not yet verified.'};
} catch (error) {
  for (const node of created.reverse()) if (!node.removed) node.remove();
  throw error;
}
