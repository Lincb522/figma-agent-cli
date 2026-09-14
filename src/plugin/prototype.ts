import { AgentError } from '../protocol.js';
import { getNode } from './design.js';

export const PROTOTYPE = {
  triggers: ['ON_CLICK', 'ON_HOVER', 'ON_PRESS', 'ON_DRAG', 'AFTER_TIMEOUT', 'MOUSE_ENTER', 'MOUSE_LEAVE', 'MOUSE_UP', 'MOUSE_DOWN'],
  actions: ['NODE', 'BACK', 'CLOSE', 'URL'],
  navigation: ['NAVIGATE', 'OVERLAY', 'SWAP', 'SCROLL_TO', 'CHANGE_TO'],
  transitions: ['DISSOLVE', 'SMART_ANIMATE', 'SCROLL_ANIMATE', 'MOVE_IN', 'MOVE_OUT', 'PUSH', 'SLIDE_IN', 'SLIDE_OUT'],
  easing: ['LINEAR', 'EASE_IN', 'EASE_OUT', 'EASE_IN_AND_OUT', 'EASE_IN_BACK', 'EASE_OUT_BACK', 'EASE_IN_AND_OUT_BACK', 'GENTLE', 'QUICK', 'BOUNCY', 'SLOW', 'CUSTOM_CUBIC_BEZIER', 'CUSTOM_SPRING'],
  timeUnit: 'seconds', instant: 'transition: null', set: 'Replaces all reactions on this node. Read first and preserve unrelated reactions.',
};
function invalid(message: string): never { throw new AgentError('INVALID_PROTOTYPE', message, 'Run figma-agent schema and inspect the node before changing its interactions.'); }
function object(value: any, label: string) { if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${label} must be an object.`); }
function choice(value: any, choices: readonly string[], label: string) { if (!choices.includes(value)) invalid(`${label} must be one of ${choices.join(', ')}.`); }
function number(value: any, label: string, min = 0, max = Infinity) { if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) invalid(`${label} must be a finite number from ${min} to ${max}.`); }
function pageOf(node: BaseNode): BaseNode | null { let parent: BaseNode | null = node; while (parent && parent.type !== 'PAGE') parent = parent.parent; return parent; }
function ancestor(node: BaseNode, type: string): BaseNode | null { let parent: BaseNode | null = node; while (parent && parent.type !== type) parent = parent.parent; return parent; }
async function interactiveNode(api: PluginAPI, id: string) {
  const node = await getNode(api, id);
  if (!('setReactionsAsync' in node)) throw new AgentError('NOT_INTERACTIVE', 'This node does not support prototype reactions. Choose a scene node.');
  return node;
}
function transition(value: any) {
  if (value === null) return;
  object(value, 'transition'); choice(value.type, PROTOTYPE.transitions, 'transition.type');
  number(value.duration, 'transition.duration (seconds)', 0, 10);
  if (['MOVE_IN', 'MOVE_OUT', 'PUSH', 'SLIDE_IN', 'SLIDE_OUT'].includes(value.type)) {
    choice(value.direction, ['LEFT', 'RIGHT', 'TOP', 'BOTTOM'], 'transition.direction');
    if (typeof value.matchLayers !== 'boolean') invalid('Directional transitions require boolean matchLayers.');
  }
  object(value.easing, 'easing'); choice(value.easing.type, PROTOTYPE.easing, 'easing.type');
  if (value.easing.type === 'CUSTOM_CUBIC_BEZIER') {
    const curve = value.easing.easingFunctionCubicBezier; object(curve, 'easingFunctionCubicBezier');
    for (const key of ['x1', 'x2']) number(curve[key], key, 0, 1);
    for (const key of ['y1', 'y2']) number(curve[key], key, -Infinity);
  }
  if (value.easing.type === 'CUSTOM_SPRING') {
    const spring = value.easing.easingFunctionSpring; object(spring, 'easingFunctionSpring');
    for (const key of ['mass', 'stiffness', 'damping']) { number(spring[key], key); if (spring[key] === 0) invalid(`${key} must be positive.`); }
    number(spring.initialVelocity, 'initialVelocity', -Infinity);
  }
}
export async function getPrototype(api: PluginAPI, id: string) {
  const node = await interactiveNode(api, id);
  const reactions = JSON.parse(JSON.stringify(node.reactions)).map((reaction: any) => {
    if (!reaction.actions && reaction.action) reaction.actions = [reaction.action];
    delete reaction.action;
    return reaction;
  });
  return { id: node.id, name: node.name, reactions };
}
export async function setPrototype(api: PluginAPI, id: string, input: unknown) {
  const node = await interactiveNode(api, id);
  if (!Array.isArray(input) || input.length > 100) invalid('reactions must be an array with at most 100 entries; [] clears interactions.');
  // Validate every destination before the single native write; never partially apply a list.
  for (const reaction of input) {
    object(reaction, 'reaction'); object(reaction.trigger, 'trigger');
    choice(reaction.trigger.type, PROTOTYPE.triggers, 'trigger.type');
    if ('action' in reaction) invalid('Use actions[], not the deprecated action field.');
    const trigger = reaction.trigger;
    if (trigger.type === 'AFTER_TIMEOUT') number(trigger.timeout, 'trigger.timeout (seconds)', 0.001);
    if (trigger.type.startsWith('MOUSE_')) number(trigger.delay, 'trigger.delay (seconds)');
    if (['MOUSE_ENTER', 'MOUSE_LEAVE'].includes(trigger.type) && typeof trigger.deprecatedVersion !== 'boolean') invalid('Mouse enter/leave triggers require deprecatedVersion: false.');
    if (!Array.isArray(reaction.actions) || !reaction.actions.length) invalid('Each reaction needs a non-empty actions array.');
    for (const action of reaction.actions) {
      object(action, 'action'); choice(action.type, PROTOTYPE.actions, 'action.type');
      if (action.type === 'URL') {
        if (typeof action.url !== 'string' || !/^https?:\/\/[^\s]+$/.test(action.url)) invalid('URL actions require an http(s) URL.');
      }
      if (action.type !== 'NODE') continue;
      choice(action.navigation, PROTOTYPE.navigation, 'navigation'); transition(action.transition);
      if (typeof action.destinationId !== 'string' || !action.destinationId) invalid('NODE actions require a destinationId.');
      const destination = await getNode(api, action.destinationId);
      if (pageOf(destination) !== pageOf(node) || destination.type === 'PAGE') invalid('Interaction destinations must be scene nodes on the same page.');
      if (action.navigation === 'CHANGE_TO') {
        const component = ancestor(node, 'COMPONENT');
        if (!component || component.parent?.type !== 'COMPONENT_SET' || destination.type !== 'COMPONENT' || destination.parent !== component.parent) invalid('CHANGE_TO must connect variants within the same component set. Configure the main component or its children.');
      } else if (action.navigation === 'SCROLL_TO') {
        let frame: BaseNode | null = node;
        while (frame && !(frame.type === 'FRAME' && isInside(destination, frame))) frame = frame.parent;
        if (!frame) invalid('SCROLL_TO requires a destination in the source frame.');
      } else if (!['FRAME', 'COMPONENT', 'INSTANCE'].includes(destination.type)) invalid('Navigation and overlays require a frame, component or instance destination.');
    }
  }
  await node.setReactionsAsync(JSON.parse(JSON.stringify(input)) as Reaction[]);
  return getPrototype(api, id);
}
function isInside(node: BaseNode, parent: BaseNode): boolean { for (let n: BaseNode | null = node; n; n = n.parent) if (n === parent) return true; return false; }
