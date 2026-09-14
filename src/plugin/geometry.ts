import { AgentError } from '../protocol.js';
import { isGuide, containsGuides } from './node-roles.js';
import { getNode, loadFonts } from './design.js';

export const BOOLEAN_OPERATIONS = ['union', 'subtract', 'intersect', 'exclude'] as const;
export type BooleanOperation = typeof BOOLEAN_OPERATIONS[number];
export type GeometryOperation = BooleanOperation | 'flatten' | 'outline';
export interface GeometryRequest { operation: GeometryOperation; ids: string[]; parentId?: string; keepInputs?: boolean; name?: string }
const IDENTITY: Transform = [[1, 0, 0], [0, 1, 0]];
export function multiply(a: Transform, b: Transform): Transform {
  return [[a[0][0]*b[0][0]+a[0][1]*b[1][0], a[0][0]*b[0][1]+a[0][1]*b[1][1], a[0][0]*b[0][2]+a[0][1]*b[1][2]+a[0][2]], [a[1][0]*b[0][0]+a[1][1]*b[1][0], a[1][0]*b[0][1]+a[1][1]*b[1][1], a[1][0]*b[0][2]+a[1][1]*b[1][2]+a[1][2]]];
}
export function inverse(t: Transform): Transform {
  const d = t[0][0]*t[1][1]-t[0][1]*t[1][0];
  if (!Number.isFinite(d) || Math.abs(d) < 1e-10) throw new AgentError('SINGULAR_TRANSFORM', 'The target parent has a non-invertible transform.');
  const a=t[1][1]/d,b=-t[0][1]/d,c=-t[1][0]/d,e=t[0][0]/d;
  return [[a,b,-a*t[0][2]-b*t[1][2]],[c,e,-c*t[0][2]-e*t[1][2]]];
}
function pageOf(node: BaseNode): PageNode | null { let p: BaseNode | null = node; while (p && p.type !== 'PAGE') p = p.parent; return p as PageNode | null; }
function ancestors(node: BaseNode) { const result: BaseNode[] = []; let p = node.parent; while (p) { result.push(p); p = p.parent; } return result; }
async function fontsIn(api: PluginAPI, node: SceneNode): Promise<void> {
  if (node.type === 'TEXT') await loadFonts(api, node);
  if ('children' in node) for (const child of node.children) await fontsIn(api, child);
}
export async function booleanSet(api: PluginAPI, id: string, operation: BooleanOperation) {
  if (!BOOLEAN_OPERATIONS.includes(operation)) throw new AgentError('INVALID_OPERATION', 'Choose union, subtract, intersect or exclude.');
  const node = await getNode(api, id);
  if (node.type !== 'BOOLEAN_OPERATION') throw new AgentError('NOT_A_BOOLEAN', 'The node is not an editable boolean operation.');
  node.booleanOperation = operation.toUpperCase() as BooleanOperationNode['booleanOperation'];
  return { id: node.id, operation: node.booleanOperation, operandIds: node.children.map(n => n.id) };
}
export async function geometry(api: PluginAPI, request: GeometryRequest) {
  const { operation, ids } = request;
  if (![...BOOLEAN_OPERATIONS, 'flatten', 'outline'].includes(operation)) throw new AgentError('INVALID_OPERATION', 'Choose union, subtract, intersect, exclude, flatten or outline.');
  const minimum = BOOLEAN_OPERATIONS.includes(operation as BooleanOperation) ? 2 : 1;
  if (!Array.isArray(ids) || ids.length < minimum || ids.length > 100 || new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string')) throw new AgentError('INVALID_OPERANDS', `Pass ${minimum}–100 distinct scene node IDs.`);
  if (operation === 'outline' && ids.length !== 1) throw new AgentError('INVALID_OPERANDS', 'outline accepts exactly one node.');
  if (request.keepInputs !== undefined && typeof request.keepInputs !== 'boolean') throw new AgentError('INVALID_OPTIONS', 'keepInputs must be boolean.');
  if (request.name !== undefined && typeof request.name !== 'string') throw new AgentError('INVALID_OPTIONS', 'name must be a string.');
  const sources = await Promise.all(ids.map(id => getNode(api, id)));
  const allowed = ['RECTANGLE','ELLIPSE','LINE','POLYGON','STAR','VECTOR','TEXT','BOOLEAN_OPERATION','GROUP','FRAME','COMPONENT','INSTANCE'];
  for (const node of sources) {
    if(isGuide(node)||containsGuides(node))throw new AgentError('GUIDE_OPERAND','Construction guides cannot be consumed by boolean operations.','Use the Artwork frame, or icon shape <workbench-id> <shape> to create an unlocked operand.');
    if (!allowed.includes(node.type)) throw new AgentError('INVALID_OPERAND_TYPE', `${node.type} is not a geometry operand.`);
    const parents = ancestors(node);
    if (parents.some(p => ids.includes(p.id))) throw new AgentError('OVERLAPPING_OPERANDS', 'Operands cannot include both an ancestor and its descendant.');
    if (!request.keepInputs && parents.some(p => p.type === 'INSTANCE')) throw new AgentError('INSTANCE_CHILD', 'An instance child cannot be replaced.', 'Use --keep-inputs to operate on a copy.');
  }
  const nodes = sources as SceneNode[];
  const page = pageOf(nodes[0]);
  if (!page || nodes.some(n => pageOf(n) !== page)) throw new AgentError('DIFFERENT_PAGES', 'All operands must be on the same page.');
  if (!request.parentId && nodes.some(n => n.parent !== nodes[0].parent)) throw new AgentError('PARENT_REQUIRED', 'Operands have different parents.', 'Pass --parent to specify the result container.');
  const parent = request.parentId ? await getNode(api, request.parentId) : nodes[0].parent!;
  if (!['PAGE','FRAME','GROUP','COMPONENT','SECTION'].includes(parent.type) || pageOf(parent) !== page) throw new AgentError('INVALID_PARENT', 'Choose a container on the operands’ page.');
  if (ids.includes(parent.id) || ancestors(parent).some(p => ids.includes(p.id) || p.type === 'INSTANCE') || parent.type === 'INSTANCE') throw new AgentError('INVALID_PARENT', 'The result parent cannot be inside an operand or an instance.');
  const target = parent as BaseNode & ChildrenMixin;
  if (operation === 'outline' && !('outlineStroke' in nodes[0])) throw new AgentError('NO_STROKE_API', 'This node cannot be outlined.');
  await Promise.all(nodes.map(n => fontsIn(api, n)));
  const positions = nodes.map(n => n.absoluteTransform.map(row => [...row]) as Transform);
  const targetTransform = 'absoluteTransform' in parent ? parent.absoluteTransform : IDENTITY;
  const inverseTarget = inverse(targetTransform);
  const stage = api.createFrame();
  const clones: SceneNode[] = [];
  let result: SceneNode | undefined;
  let committed = false;
  const removed: string[] = [];
  try {
    page.appendChild(stage); stage.name = 'Boolean staging'; stage.relativeTransform = IDENTITY; stage.visible = false; stage.clipsContent = false; stage.fills = [];
    for (let i = 0; i < nodes.length; i++) {
      const clone = nodes[i].clone(); clones.push(clone); stage.appendChild(clone); clone.relativeTransform = positions[i];
    }
    // Array order is also the staging layer order: the first subtract operand is the base.
    if (operation === 'outline') {
      result = (clones[0] as GeometryMixin & SceneNode).outlineStroke() ?? undefined;
      if (!result) throw new AgentError('NO_VISIBLE_STROKE', 'The node has no stroke to outline.');
    } else if (operation === 'flatten') result = api.flatten(clones, stage);
    else result = api[operation](clones, stage);
    if (request.name) result.name = request.name;
    const absolute = result.absoluteTransform;
    target.appendChild(result);
    if ('layoutMode' in parent && parent.layoutMode !== 'NONE') result.layoutPositioning = 'ABSOLUTE';
    result.relativeTransform = multiply('absoluteTransform' in parent ? inverse(parent.absoluteTransform) : inverseTarget, absolute);
    // Originals remain untouched until Figma has produced and placed a complete result.
    committed = true;
    if (!request.keepInputs) for (const node of nodes) { node.remove(); removed.push(node.id); }
    return { id: result.id, type: result.type, name: result.name, operation, sourceIds: ids, removedIds: removed, keptInputs: !!request.keepInputs, operandIds: result.type === 'BOOLEAN_OPERATION' ? result.children.map(n => n.id) : [], bounds: result.absoluteBoundingBox };
  } catch (error) {
    if (committed) throw new AgentError('GEOMETRY_COMMIT_INCOMPLETE', error instanceof Error ? error.message : String(error), 'The result exists, but not all originals were removed. Inspect the listed IDs before continuing.', { resultId: result?.id, removedIds: removed, remainingIds: ids.filter(id => !removed.includes(id)) });
    if (result && !result.removed && result.parent !== stage) result.remove();
    throw error;
  } finally {
    for (const clone of clones) if (!clone.removed && clone !== result && clone.parent !== result) clone.remove();
    if (!stage.removed) stage.remove();
  }
}
