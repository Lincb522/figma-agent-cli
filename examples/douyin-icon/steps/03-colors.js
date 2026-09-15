// Reconstructed from the recorded example. Pass IDs returned by your own run through --args.
await figma.setCurrentPageAsync(await h.node(args.pageId));const note=await h.node(args.noteId),artwork=await h.node(args.artworkId);
const cyan=note.clone();cyan.name='Cyan note / SUBTRACT';cyan.x=note.x-41;cyan.y=note.y-33;cyan.fills=[h.solid('#00DCE5')];
const red=note.clone();red.name='Red note / SUBTRACT';red.x=note.x+40;red.y=note.y+32;red.fills=[h.solid('#FF1253')];
artwork.insertChild(0,cyan);artwork.insertChild(1,red);artwork.appendChild(note);
const guides=await h.node(args.guidesId);for(const [x1,y1,x2,y2] of [[627,160,627,1100],[200,627,1060,627]]){const v=figma.createVector();guides.appendChild(v);v.vectorPaths=[{windingRule:'NONZERO',data:`M ${x1} ${y1} L ${x2} ${y2}`}];v.fills=[];v.strokes=[h.solid('#B3B8BF')];v.strokeWeight=1;}
const root=await h.node(args.frameId);figma.currentPage.selection=[root];figma.viewport.scrollAndZoomIntoView([root]);return {root:root.id,cyan:cyan.id,red:red.id,black:note.id};
