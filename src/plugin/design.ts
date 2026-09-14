import { AgentError } from '../protocol.js';

export interface NodeSpec { key?: string; tag?: string; type: string; props?: Record<string, any>; children?: NodeSpec[]; svg?: string; componentId?: string; componentKey?: string; operation?: 'UNION' | 'SUBTRACT' | 'INTERSECT' | 'EXCLUDE'; imagePath?: string; imageBase64?: string }
export interface DesignSpec { parentId?: string; nodes: NodeSpec[] }
export const NODE_TYPES = ['FRAME', 'COMPONENT', 'TEXT', 'RECTANGLE', 'ELLIPSE', 'LINE', 'POLYGON', 'STAR', 'VECTOR', 'SVG', 'INSTANCE', 'BOOLEAN', 'IMAGE'];
export const PROPERTIES = ['name', 'x', 'y', 'width', 'height', 'rotation', 'visible', 'locked', 'opacity', 'blendMode', 'fills', 'strokes', 'strokeWeight', 'strokeAlign', 'dashPattern', 'effects', 'cornerRadius', 'topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius', 'cornerSmoothing', 'clipsContent', 'layoutMode', 'layoutWrap', 'itemSpacing', 'counterAxisSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'primaryAxisAlignItems', 'counterAxisAlignItems', 'primaryAxisSizingMode', 'counterAxisSizingMode', 'layoutSizingHorizontal', 'layoutSizingVertical', 'layoutGrow', 'layoutAlign', 'layoutPositioning', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight', 'constraints', 'characters', 'fontName', 'fontSize', 'textAutoResize', 'textAlignHorizontal', 'textAlignVertical', 'lineHeight', 'letterSpacing', 'paragraphSpacing', 'textCase', 'textDecoration', 'textTruncation', 'maxLines', 'vectorPaths', 'pointCount', 'innerRadius', 'arcData', 'layoutGrids'] as const;
const lastProps = ['layoutSizingHorizontal', 'layoutSizingVertical', 'layoutGrow', 'layoutAlign', 'layoutPositioning'];
export function solid(hex: string): SolidPaint {
  const value = hex.replace(/^#/, '');
  if (!/^(?:[a-fA-F0-9]{6}|[a-fA-F0-9]{8})$/.test(value)) throw new AgentError('INVALID_COLOR', 'Use a six- or eight-digit hex color.');
  return { type: 'SOLID', color: { r: parseInt(value.slice(0,2),16)/255, g: parseInt(value.slice(2,4),16)/255, b: parseInt(value.slice(4,6),16)/255 }, opacity: value.length === 8 ? parseInt(value.slice(6,8),16)/255 : 1 };
}
function checkProps(props: Record<string, any>, type?: string) {
  if (!props || typeof props !== 'object' || Array.isArray(props)) throw new AgentError('INVALID_PROPS', 'Node props must be an object.');
  for (const [key, value] of Object.entries(props)) {
    if (!(PROPERTIES as readonly string[]).includes(key)) throw new AgentError('INVALID_PROPERTY', `Unsupported property: ${key}.`, 'Use the Figma API through exec for methods or advanced fields.');
    if ((key === 'width' || key === 'height') && (typeof value !== 'number' || !Number.isFinite(value) || (key === 'height' && type === 'LINE' ? value !== 0 : value < 0.01))) throw new AgentError('INVALID_SIZE', `${key} must be at least 0.01; a LINE height must be exactly 0.`);
    if (key === 'fontName' && (!value || typeof value.family !== 'string' || typeof value.style !== 'string')) throw new AgentError('INVALID_FONT', 'fontName needs family and style.');
  }
}
export function validateSpec(spec: DesignSpec) {
  if (!spec || !Array.isArray(spec.nodes) || !spec.nodes.length) throw new AgentError('INVALID_SPEC', 'The design must contain a nonempty nodes array.');
  let count = 0; const keys = new Set<string>();
  const visit = (n: NodeSpec, depth: number) => {
    if (++count > 2000 || depth > 30) throw new AgentError('SPEC_TOO_LARGE', 'A design may have at most 2000 nodes and 30 nesting levels.');
    if (!n || !NODE_TYPES.includes(n.type)) throw new AgentError('INVALID_NODE_TYPE', `Unsupported node type: ${n?.type}.`);
    checkProps(n.props ?? {}, n.type);
    if (n.key !== undefined) { if (typeof n.key !== 'string' || !n.key || keys.has(n.key)) throw new AgentError('DUPLICATE_KEY', 'Node keys must be nonempty unique strings.'); keys.add(n.key); }
    if (n.tag !== undefined && (typeof n.tag !== 'string' || n.tag.length > 200)) throw new AgentError('INVALID_TAG', 'Node tags must be strings of at most 200 characters.');
    if (n.type === 'SVG' && typeof n.svg !== 'string') throw new AgentError('INVALID_SVG', 'SVG nodes require an svg string.');
    if (n.type === 'INSTANCE' && !n.componentId && !n.componentKey) throw new AgentError('INVALID_INSTANCE', 'An instance requires componentId or componentKey.');
    if (n.type === 'BOOLEAN' && (!['UNION','SUBTRACT','INTERSECT','EXCLUDE'].includes(n.operation ?? '') || !Array.isArray(n.children) || n.children.length < 2)) throw new AgentError('INVALID_BOOLEAN', 'BOOLEAN needs an operation and at least two children in bottom-to-top order.');
    if (n.type === 'IMAGE' && typeof n.imageBase64 !== 'string' && typeof n.imagePath !== 'string') throw new AgentError('INVALID_IMAGE', 'IMAGE needs imagePath (CLI) or imageBase64 (Plugin API).');
    if (n.children !== undefined && (!Array.isArray(n.children) || !['FRAME', 'COMPONENT', 'BOOLEAN'].includes(n.type))) throw new AgentError('INVALID_CHILDREN', 'Declarative children are supported on FRAME, COMPONENT and BOOLEAN.');
    for (const child of n.children ?? []) visit(child, depth + 1);
  };
  for (const n of spec.nodes) visit(n, 0);
}
export async function getNode(api: PluginAPI, id: string): Promise<BaseNode> {
  if (typeof id !== 'string' || !id) throw new AgentError('NODE_REQUIRED', 'A node ID is required.');
  const node = await api.getNodeByIdAsync(id);
  if (!node) throw new AgentError('NODE_NOT_FOUND', `No node exists with ID ${id}.`, 'Inspect the current document to obtain a fresh node ID.');
  return node;
}
export async function loadFonts(api: PluginAPI, node: TextNode, nextFont?: FontName) {
  const fonts = node.fontName === api.mixed ? node.getRangeAllFontNames(0, node.characters.length) : [node.fontName];
  if (nextFont) fonts.push(nextFont);
  const unique = new Map(fonts.map(f => [JSON.stringify(f), f]));
  await Promise.all([...unique.values()].map(font => api.loadFontAsync(font)));
}
function assignProps(node: any, props: Record<string, any>, phase: 'base' | 'layout') {
  for (const key of Object.keys(props)) if (!(key in node)) throw new AgentError('PROPERTY_NOT_SUPPORTED', `${node.type} does not support ${key}.`);
  if (phase === 'base') {
    if (props.fontName) node.fontName = props.fontName;
    if (props.layoutMode !== undefined) node.layoutMode = props.layoutMode;
    if (props.width !== undefined || props.height !== undefined) node.resize(props.width ?? node.width, props.height ?? node.height);
  }
  for (const [key, value] of Object.entries(props)) {
    if (['width','height','fontName','layoutMode'].includes(key)) continue;
    if (lastProps.includes(key) !== (phase === 'layout')) continue;
    node[key] = value;
  }
}
export async function applyDesign(api: PluginAPI, spec: DesignSpec) {
  validateSpec(spec);
  const parent = spec.parentId ? await getNode(api, spec.parentId) : api.currentPage;
  if (!['PAGE', 'FRAME', 'COMPONENT', 'SECTION'].includes(parent.type)) throw new AgentError('INVALID_PARENT', 'Choose a page, frame, component, or section as parent.');
  const fonts = new Map<string, FontName>();
  const collect = (n: NodeSpec) => { if (n.type === 'TEXT') { const f = n.props?.fontName ?? { family: 'Inter', style: 'Regular' }; fonts.set(JSON.stringify(f), f); } n.children?.forEach(collect); };
  spec.nodes.forEach(collect);
  await Promise.all([...fonts.values()].map(f => api.loadFontAsync(f)));
  const created: SceneNode[] = []; const keys: Record<string, string> = Object.create(null);
  const create = async (n: NodeSpec, p: ChildrenMixin): Promise<SceneNode> => {
    let node: SceneNode;
    switch (n.type) {
      case 'FRAME': node = api.createFrame(); break;
      case 'COMPONENT': node = api.createComponent(); break;
      case 'TEXT': node = api.createText(); break;
      case 'RECTANGLE': node = api.createRectangle(); break;
      case 'ELLIPSE': node = api.createEllipse(); break;
      case 'LINE': node = api.createLine(); break;
      case 'POLYGON': node = api.createPolygon(); break;
      case 'STAR': node = api.createStar(); break;
      case 'VECTOR': node = api.createVector(); break;
      case 'IMAGE': {
        if (!n.imageBase64) throw new AgentError('IMAGE_NOT_PREPARED', 'Local image paths must be loaded by the CLI before apply.');
        const image = api.createImage(api.base64Decode(n.imageBase64));
        const size = await image.getSizeAsync();
        node = api.createRectangle(); created.push(node);
        node.resize(n.props?.width ?? size.width, n.props?.height ?? size.height);
        node.fills = [{ type: 'IMAGE', imageHash: image.hash, scaleMode: 'FILL' }]; break;
      }
      case 'BOOLEAN': {
        const stage = api.createFrame(); created.push(stage); p.appendChild(stage); stage.fills = []; stage.clipsContent = false;
        const operands: SceneNode[] = [];
        for (const child of n.children!) operands.push(await create(child, stage));
        node = api[n.operation!.toLowerCase() as 'union' | 'subtract' | 'intersect' | 'exclude'](operands, p as BaseNode & ChildrenMixin);
        created.push(node);
        stage.remove(); break;
      }
      case 'SVG': node = api.createNodeFromSvg(n.svg!); break;
      case 'INSTANCE': {
        const component = n.componentId ? await getNode(api, n.componentId) : await api.importComponentByKeyAsync(n.componentKey!);
        if (component.type !== 'COMPONENT') throw new AgentError('INVALID_COMPONENT', 'The supplied node is not a component.');
        node = component.createInstance(); break;
      }
      default: throw new AgentError('INVALID_NODE_TYPE', n.type);
    }
    if (!created.includes(node)) created.push(node); p.appendChild(node);
    if (node.type === 'TEXT') { node.fontName = n.props?.fontName ?? { family: 'Inter', style: 'Regular' }; node.textAutoResize = n.props?.textAutoResize ?? (n.props?.width ? 'HEIGHT' : 'WIDTH_AND_HEIGHT'); }
    const props = { ...n.props };
    if ((node.type === 'FRAME' || node.type === 'COMPONENT') && ['HORIZONTAL','VERTICAL'].includes(props.layoutMode)) {
      const horizontalAxis = props.layoutMode === 'HORIZONTAL' ? 'primaryAxisSizingMode' : 'counterAxisSizingMode';
      const verticalAxis = props.layoutMode === 'VERTICAL' ? 'primaryAxisSizingMode' : 'counterAxisSizingMode';
      if (props.width !== undefined && props.layoutSizingHorizontal === undefined && props[horizontalAxis] === undefined) props[horizontalAxis] = 'FIXED';
      if (props.height !== undefined && props.layoutSizingVertical === undefined && props[verticalAxis] === undefined) props[verticalAxis] = 'FIXED';
    }
    assignProps(node, props, 'base');
    if (n.type !== 'BOOLEAN') for (const child of n.children ?? []) await create(child, node as FrameNode);
    assignProps(node, props, 'layout');
    if (n.key) keys[n.key] = node.id;
    if (n.tag) node.setPluginData('figma-agent:tag', n.tag);
    return node;
  };
  try {
    const roots: SceneNode[] = [];
    for (const n of spec.nodes) roots.push(await create(n, parent as PageNode));
    return { roots: roots.map(n => ({ id: n.id, name: n.name, type: n.type })), keys, created: created.filter(n => !n.removed).length };
  } catch (error) {
    const failures: string[] = [];
    for (const node of created.reverse()) { try { if (!node.removed) node.remove(); } catch { failures.push(node.id); } }
    if (failures.length) throw new AgentError('ROLLBACK_INCOMPLETE', error instanceof Error ? error.message : String(error), 'Inspect these nodes before retrying.', { nodes: failures });
    throw error;
  }
}
export async function patchNode(api: PluginAPI, id: string, props: Record<string, any>) {
  const node: any = await getNode(api, id);
  checkProps(props, node.type);
  for (const key of Object.keys(props)) if (!(key in node)) throw new AgentError('PROPERTY_NOT_SUPPORTED', `${node.type} does not support ${key}.`);
  if (node.type === 'TEXT') await loadFonts(api, node, props.fontName);
  const old: Record<string, any> = {};
  for (const key of Object.keys(props)) {
    if (node[key] === api.mixed) throw new AgentError('MIXED_PROPERTY', `${key} contains mixed values.`, 'Use exec and Figma range setters to preserve mixed formatting.');
    old[key] = node[key];
  }
  if (props.width !== undefined || props.height !== undefined) { old.width = node.width; old.height = node.height; }
  try { assignProps(node, props, 'base'); assignProps(node, props, 'layout'); }
  catch (error) {
    try { assignProps(node, old, 'base'); assignProps(node, old, 'layout'); }
    catch { throw new AgentError('ROLLBACK_INCOMPLETE', 'The patch failed and some original properties could not be restored.', 'Inspect the node before continuing.', { nodeId: id }); }
    throw error;
  }
  return { id: node.id, name: node.name, type: node.type };
}
export function inspectNode(node: BaseNode, depth = 2, limit = 1000) {
  let remaining = limit;
  const visit = (n: any, level: number): any => {
    remaining--;
    const result: Record<string, any> = { id: n.id, type: n.type, name: n.name };
    for (const key of [...PROPERTIES, 'absoluteBoundingBox', 'absoluteRenderBounds', 'componentProperties', 'boundVariables', 'booleanOperation']) {
      if (key === 'name' || !(key in n)) continue;
      const value = n[key];
      if (typeof value === 'symbol') result[key] = 'MIXED';
      else if (value !== undefined) result[key] = value;
    }
    if ('children' in n) {
      result.childCount = n.children.length;
      if (level > 0) {
        result.children = [];
        for (const child of n.children) { if (remaining <= 0) break; result.children.push(visit(child, level - 1)); }
        if (result.children.length !== n.children.length) result.truncated = true;
      } else if (n.children.length) result.truncated = true;
    }
    return result;
  };
  return visit(node, depth);
}
