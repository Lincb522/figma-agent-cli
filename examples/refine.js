// Supply --args with { "nodeId": "<text-node-id>", "title": "Projects" }.
const node = await h.node(args.nodeId);
if (node.type !== 'TEXT') throw new Error('nodeId must identify a text node.');
await h.loadFonts(node);
node.characters = args.title;
node.fontSize = 28;
return { id: node.id, characters: node.characters, width: node.width, height: node.height };
