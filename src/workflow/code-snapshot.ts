// Self-contained so the existing eval command can run this read-only collector in Figma.
export async function collectCodeDesign(api: PluginAPI, id?: string): Promise<any> {
  const root = id ? await api.getNodeByIdAsync(id) : api.currentPage.selection.length === 1 ? api.currentPage.selection[0] : null;
  if (!root || !('exportAsync' in root) || root.type === 'PAGE') throw new Error('Choose one exportable design node or pass its ID.');
  const warnings: string[] = [];
  let count = 0;
  const walk = async (node: any, depth: number): Promise<any> => {
    if (++count > 2000 || depth > 30) throw new Error('Code export supports at most 2000 nodes and 30 levels. Export a smaller frame.');
    const result: any = { id: node.id, name: node.name, type: node.type };
    for (const key of ['visible','width','height','relativeTransform','opacity','blendMode','fills','strokes','strokeWeight','strokeAlign','cornerRadius','topLeftRadius','topRightRadius','bottomLeftRadius','bottomRightRadius','effects','clipsContent','layoutMode','layoutWrap','layoutSizingHorizontal','layoutSizingVertical','paddingTop','paddingRight','paddingBottom','paddingLeft','itemSpacing','primaryAxisAlignItems','counterAxisAlignItems','constraints','characters','textAutoResize','fontName','fontSize','fontWeight','lineHeight','letterSpacing','textAlignHorizontal','textAlignVertical','textDecoration','textCase','isMask','boundVariables','reactions','componentProperties']) {
      const value = node[key];
      if (value !== undefined && typeof value !== 'symbol') result[key] = JSON.parse(JSON.stringify(value));
    }
    try { result.figmaCSS = await node.getCSSAsync(); }
    catch { warnings.push(`${node.id}: Figma CSS unavailable; native properties retained.`); }
    if (node.type === 'TEXT') {
      result.segments = node.getStyledTextSegments(['fontName','fontSize','fontWeight','fills','lineHeight','letterSpacing','textDecoration','textCase']);
    }
    if ('children' in node) {
      result.children = [];
      for (const child of node.children) result.children.push(await walk(child, depth + 1));
    }
    const imageFill = Array.isArray(node.fills) && node.fills.some((p: any) => p.visible !== false && p.type === 'IMAGE');
    const masked = node.children?.some((n: any) => n.isMask);
    const complexFill = Array.isArray(node.fills) && node.fills.some((p: any) => p.visible !== false && p.type !== 'SOLID');
    if (['VECTOR','BOOLEAN_OPERATION','LINE','ELLIPSE','POLYGON','STAR'].includes(node.type)) result.assetFormat = 'SVG';
    else if (imageFill || masked || (complexFill && !node.children?.length)) result.assetFormat = 'PNG';
    if (masked) warnings.push(`${node.id}: Masked group exported as an image; child structure remains in design.json.`);
    if (complexFill && node.children?.length && !masked) warnings.push(`${node.id}: Complex container fill needs implementation review; inspect preview.png and figmaCSS.`);
    return result;
  };
  let page: BaseNode | null = root;
  while (page && page.type !== 'PAGE') page = page.parent;
  return { document: api.root.name, page: page?.name, pageId: page?.id, root: await walk(root, 0), warnings };
}
