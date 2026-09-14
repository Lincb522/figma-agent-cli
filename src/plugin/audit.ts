import { AgentError } from '../protocol.js';
import { GUIDE_TAG } from './node-roles.js';
import { getNode } from './design.js';
export async function audit(api: PluginAPI, id: string) {
  const root = await getNode(api, id);
  if (!('absoluteBoundingBox' in root)) throw new AgentError('INVALID_AUDIT_ROOT', 'Audit a scene node or frame.');
  const counts: Record<string, number> = {};
  const text: { id: string; characters: string }[] = [];
  const fullFrameImages: string[] = [];
  const overflow: { id: string; parentId: string }[] = [];
  let total = 0, autoLayout = 0, vectorShapes = 0, imageNodes = 0, iconMarks = 0;
  const bounds = root.absoluteBoundingBox;
  function visit(node: SceneNode, visible: boolean) {
    if(node.getPluginData('figma-agent:tag')===GUIDE_TAG)return;
    if (++total > 10_000) throw new AgentError('AUDIT_TOO_LARGE', 'Audit a smaller frame; more than 10000 nodes were encountered.');
    counts[node.type] = (counts[node.type] ?? 0) + 1;
    visible = visible && node.visible && (!('opacity' in node) || node.opacity > 0);
    if (!visible) return;
    if (node.type === 'TEXT' && node.characters.trim()) text.push({ id: node.id, characters: node.characters.slice(0,300) });
    if ('layoutMode' in node && node.layoutMode !== 'NONE') autoLayout++;
    const images = 'fills' in node && Array.isArray(node.fills) && node.fills.some(p => p.type === 'IMAGE' && p.visible !== false);
    if (images) {
      imageNodes++;
      const box = node.absoluteBoundingBox;
      if (box && bounds && box.width >= bounds.width * 0.9 && box.height >= bounds.height * 0.9) fullFrameImages.push(node.id);
    } else if (['RECTANGLE','ELLIPSE','LINE','VECTOR','POLYGON','STAR','BOOLEAN_OPERATION'].includes(node.type)) vectorShapes++;
    if (!images && ['VECTOR','ELLIPSE','POLYGON','STAR','BOOLEAN_OPERATION'].includes(node.type)) iconMarks++;
    const parent = node.parent;
    if (parent && 'clipsContent' in parent && parent.clipsContent && 'absoluteBoundingBox' in parent && node.absoluteBoundingBox && parent.absoluteBoundingBox) {
      const a = node.absoluteBoundingBox, b = parent.absoluteBoundingBox;
      if (a.x < b.x - 1 || a.y < b.y - 1 || a.x+a.width > b.x+b.width+1 || a.y+a.height > b.y+b.height+1) overflow.push({ id: node.id, parentId: parent.id });
    }
    if ('children' in node) node.children.forEach(n => visit(n, visible));
  }
  visit(root as SceneNode, true);
  return { rootId: id, tag: root.getPluginData('figma-agent:tag'), bounds, total, counts, textCount: text.length, text: text.slice(0,100), autoLayoutCount: autoLayout, vectorShapeCount: vectorShapes, imageNodeCount: imageNodes, fullFrameImageNodeIds: fullFrameImages, possibleClippedNodes: overflow, hasEditableIcon: iconMarks > 0 && fullFrameImages.length === 0, hasEditableUI: text.length > 0 && (autoLayout > 0 || vectorShapes > 0), note: 'Structural checks and axis-aligned clipping candidates do not establish visual fidelity. Inspect the exported image.' };
}
