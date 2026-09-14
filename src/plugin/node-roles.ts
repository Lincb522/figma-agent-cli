export const GUIDE_TAG = 'icon-guides-v1';
export const ARTWORK_TAG = 'icon-artwork-v1';
export function isGuide(node: BaseNode) {
  let current: BaseNode | null = node;
  while (current) { if (current.getPluginData('figma-agent:tag') === GUIDE_TAG) return true; current = current.parent; }
  return false;
}
export function artworkOf(node: BaseNode): SceneNode | undefined {
  if (!('children' in node)) return undefined;
  const child = node.children.find(child => child.getPluginData('figma-agent:tag') === ARTWORK_TAG);
  return child && child.type !== 'PAGE' ? child : undefined;
}
export function containsGuides(node: BaseNode): boolean {
  return node.getPluginData('figma-agent:tag') === GUIDE_TAG || ('children' in node && node.children.some(containsGuides));
}
