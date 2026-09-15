// Reconstructed from the recorded example. Pass IDs returned by your own run through --args.
await figma.setCurrentPageAsync(await h.node(args.pageId));
const artwork = await h.node(args.artworkId);
const bowl = await h.node(args.bowlId);
const stem = await h.node(args.stemId);
const flag = await h.node(args.flagId);
const cavity = await h.node(args.cavityId);
cavity.opacity=1;
const body = figma.union([bowl, stem, flag], artwork);
body.name = 'Body / UNION';
const note = figma.subtract([body, cavity], artwork);
note.name = 'Black note / SUBTRACT';
note.fills = [h.solid('#000000')];
figma.currentPage.selection = [note];
figma.viewport.scrollAndZoomIntoView([note]);
return {note:note.id,type:note.type,operation:note.booleanOperation,operands:note.children.map(n=>({id:n.id,type:n.type,operation:n.booleanOperation,operands:n.children?.map(c=>({id:c.id,type:c.type}))}))};
