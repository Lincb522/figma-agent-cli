import { AgentError, type Command, type Context } from '../protocol.js';
import { applyDesign, getNode, inspectNode, loadFonts, patchNode, solid, type NodeSpec } from './design.js';
import { booleanSet, geometry, type GeometryRequest } from './geometry.js';
import { shapeFromKeyline } from './keylines.js';
import { artworkOf } from './node-roles.js';
import { getPrototype, setPrototype } from './prototype.js';
import { audit } from './audit.js';

export function getContext(api: PluginAPI): Context { return { document: api.root.name, page: api.currentPage.name, pageId: api.currentPage.id, selection: api.currentPage.selection.map(n => ({ id: n.id, name: n.name, type: n.type })) }; }
function integer(value: any, fallback: number, min: number, max: number) { if (value === undefined) return fallback; if (!Number.isInteger(value) || value < min || value > max) throw new AgentError('INVALID_NUMBER', `Expected an integer from ${min} to ${max}.`); return value; }
export function helpers(api: PluginAPI) {
  return {
    prototype: (id: string, reactions: unknown) => setPrototype(api, id, reactions),
    solid,
    node: (id: string) => getNode(api, id),
    inspect: (node: BaseNode, depth = 2) => inspectNode(node, depth),
    loadFonts: (node: TextNode, font?: FontName) => loadFonts(api, node, font),
    apply: (nodes: NodeSpec[], parentId?: string) => applyDesign(api, { nodes, parentId }),
    patch: (id: string, props: Record<string, any>) => patchNode(api, id, props),
    boolean: (request: GeometryRequest) => geometry(api, request),
  };
}
export async function execute(api: PluginAPI, command: Command): Promise<any> {
  const p = command.params;
  switch (command.method) {
    case 'prototype-get': return getPrototype(api, p.id);
    case 'prototype-set': return setPrototype(api, p.id, p.reactions);
    case 'icon-shape': return shapeFromKeyline(api,p.id,p.shape,p.color,p.name);
    case 'boolean': return geometry(api, p as GeometryRequest);
    case 'boolean-set': return booleanSet(api, p.id, p.operation);
    case 'audit': return audit(api, p.id);
    case 'document': return { ...getContext(api), pages: api.root.children.map(n => ({ id: n.id, name: n.name })), viewport: { center: api.viewport.center, zoom: api.viewport.zoom } };
    case 'selection': return api.currentPage.selection.map(n => inspectNode(n, integer(p.depth, 1, 0, 10)));
    case 'inspect': return inspectNode(p.id ? await getNode(api, p.id) : api.currentPage, integer(p.depth, 2, 0, 10), integer(p.limit, 1000, 1, 5000));
    case 'find': {
      const scope = p.parentId ? await getNode(api, p.parentId) : api.currentPage;
      if (!('children' in scope)) throw new AgentError('INVALID_SCOPE', 'The search scope must contain children.');
      const limit = integer(p.limit, 50, 1, 1000); const found: any[] = []; let more = false;
      const query = String(p.query ?? '').toLocaleLowerCase();
      const walk = (node: BaseNode) => {
        if (found.length >= limit) { more = true; return; }
        if (node.name.toLocaleLowerCase().includes(query) && (!p.type || node.type === p.type)) found.push({ id: node.id, name: node.name, type: node.type });
        if ('children' in node) for (const child of node.children) { walk(child); if (more) break; }
      };
      for (const child of scope.children) { walk(child); if (more) break; }
      return { nodes: found, truncated: more, scopeId: scope.id };
    }
    case 'fonts': return (await api.listAvailableFontsAsync()).filter(f => !p.family || f.fontName.family.toLowerCase().includes(String(p.family).toLowerCase())).map(f => f.fontName);
    case 'apply': return applyDesign(api, p.spec);
    case 'patch': return patchNode(api, p.id, p.props);
    case 'delete': {
      if (!Array.isArray(p.ids) || !p.ids.length) throw new AgentError('NODE_REQUIRED', 'Pass at least one node ID.');
      const nodes = await Promise.all(p.ids.map((id: string) => getNode(api, id)));
      if (nodes.some(n => n.type === 'DOCUMENT' || n.type === 'PAGE')) throw new AgentError('INVALID_DELETE', 'delete accepts scene nodes only.');
      const removed: string[] = [];
      try { for (const node of nodes) { if (!node.removed) { node.remove(); removed.push(node.id); } } }
      catch (error) { throw new AgentError('PARTIAL_DELETE', error instanceof Error ? error.message : String(error), 'Inspect the remaining IDs before continuing.', { removed }); }
      return { removed };
    }
    case 'select': {
      if (!Array.isArray(p.ids)) throw new AgentError('NODE_REQUIRED', 'ids must be an array.');
      const nodes = await Promise.all(p.ids.map((id: string) => getNode(api, id)));
      for (const n of nodes) { let ancestor: BaseNode | null = n; while (ancestor && ancestor.type !== 'PAGE') ancestor = ancestor.parent; if (ancestor !== api.currentPage || n.type === 'PAGE') throw new AgentError('WRONG_PAGE', 'All selected nodes must be on the current page.'); }
      api.currentPage.selection = nodes as SceneNode[];
      if (nodes.length) api.viewport.scrollAndZoomIntoView(nodes as SceneNode[]);
      return getContext(api);
    }
    case 'export': {
      const source = p.id ? await getNode(api, p.id) : api.currentPage.selection.length === 1 ? api.currentPage.selection[0] : null;
      const node = source && !p.includeGuides ? artworkOf(source) ?? source : source;
      if (!node || !('exportAsync' in node)) throw new AgentError('EXPORT_NODE_REQUIRED', 'Pass an exportable node ID or select exactly one node in Figma.');
      const format = String(p.format ?? 'PNG').toUpperCase();
      if (!['PNG', 'JPG', 'SVG', 'PDF'].includes(format)) throw new AgentError('INVALID_FORMAT', 'Choose PNG, JPG, SVG, or PDF.');
      const scale = p.scale ?? 1;
      if (typeof scale !== 'number' || scale <= 0 || scale > 4) throw new AgentError('INVALID_SCALE', 'Export scale must be greater than 0 and at most 4.');
      const settings: ExportSettings = format === 'PNG' || format === 'JPG' ? { format, constraint: { type: 'SCALE', value: scale }, useAbsoluteBounds: !!p.layoutBounds } : { format: format as 'SVG' | 'PDF' };
      const bytes = await node.exportAsync(settings);
      if (bytes.length > 16 * 1024 * 1024) throw new AgentError('EXPORT_TOO_LARGE', 'Export exceeds 16 MiB.', 'Export a smaller frame or reduce --scale.');
      return { nodeId: node.id, requestedNodeId:source?.id, guidesExcluded:source!==node, format, base64: api.base64Encode(bytes), byteLength: bytes.length };
    }
    case 'image': {
      if (typeof p.base64 !== 'string') throw new AgentError('IMAGE_REQUIRED', 'A base64 image is required.');
      const parent = p.parentId ? await getNode(api, p.parentId) : api.currentPage;
      if (!['PAGE', 'FRAME', 'COMPONENT', 'SECTION'].includes(parent.type)) throw new AgentError('INVALID_PARENT', 'Choose a page, frame, component, or section.');
      const image = api.createImage(api.base64Decode(p.base64)); const size = await image.getSizeAsync();
      const node = api.createRectangle();
      try { (parent as PageNode).appendChild(node); node.name = p.name ?? 'Image'; node.resize(p.width ?? size.width, p.height ?? size.height); node.fills = [{ type: 'IMAGE', imageHash: image.hash, scaleMode: 'FILL' }]; return { id: node.id, name: node.name, width: node.width, height: node.height }; }
      catch (error) { node.remove(); throw error; }
    }
    case 'variables': return { collections: (await api.variables.getLocalVariableCollectionsAsync()).map(c => ({ id: c.id, name: c.name, modes: c.modes, defaultModeId: c.defaultModeId, variableIds: c.variableIds })), variables: (await api.variables.getLocalVariablesAsync()).map(v => ({ id: v.id, name: v.name, resolvedType: v.resolvedType, variableCollectionId: v.variableCollectionId, valuesByMode: v.valuesByMode, scopes: v.scopes })) };
    case 'styles': return { paints: (await api.getLocalPaintStylesAsync()).map(s => ({ id: s.id, name: s.name, paints: s.paints })), texts: (await api.getLocalTextStylesAsync()).map(s => ({ id: s.id, name: s.name, fontName: s.fontName, fontSize: s.fontSize, lineHeight: s.lineHeight })), effects: (await api.getLocalEffectStylesAsync()).map(s => ({ id: s.id, name: s.name, effects: s.effects })) };
    case 'eval': {
      if (typeof p.code !== 'string' || !p.code.trim()) throw new AgentError('CODE_REQUIRED', 'Provide JavaScript with a JSON-serializable return value.');
      // This is the explicit full Plugin API entry point; code stays in Figma's sandbox.
      const run = new Function('figma', 'h', 'args', `"use strict"; return (async () => {\n${p.code}\n})();`);
      return await run(api, helpers(api), p.args ?? {});
    }
  }
}
