// Reconstructed from the recorded example. Pass IDs returned by your own run through --args.
await figma.setCurrentPageAsync(await h.node(args.pageId));
const board=figma.createFrame();board.name='抖音 / 原位 Keyline 构造板';board.resize(1254,1254);board.x=4700;board.y=0;board.fills=[h.solid('#FFFFFF')];
const guides=figma.createFrame();board.appendChild(guides);guides.name='Guides / App Icon Keyline / Locked';guides.resize(1254,1254);guides.fills=[];
const stroke=n=>{n.fills=[];n.strokes=[h.solid('#BCC3CC')];n.strokeWeight=1;n.opacity=0.65;return n;};
for(const [name,x,y,w,hh,r] of [['Outer square',72,72,1110,1110,0],['Rounded square',160,160,934,934,206],['Inner rounded square',245,245,764,764,170],['Portrait',324,142,606,970,150],['Landscape',142,324,970,606,150]]){const n=figma.createRectangle();guides.appendChild(n);n.name=name;n.x=x;n.y=y;n.resize(w,hh);n.cornerRadius=r;stroke(n);}
for(const diameter of [1110,934,764,470]){const n=figma.createEllipse();guides.appendChild(n);n.name='Concentric circle / '+diameter;n.resize(diameter,diameter);n.x=(1254-diameter)/2;n.y=n.x;stroke(n);}
const segs=[[72,72,1182,1182],[1182,72,72,1182],[627,48,627,1206],[48,627,1206,627],[324,72,324,1182],[930,72,930,1182],[72,324,1182,324],[72,930,1182,930]];
for(let i=0;i<segs.length;i++){const [a,b,c,d]=segs[i];const n=figma.createVector();guides.appendChild(n);n.name='Reference line '+i;n.vectorPaths=[{windingRule:'NONZERO',data:`M ${a} ${b} L ${c} ${d}`}];stroke(n);}
guides.locked=true;figma.currentPage.selection=[board];figma.viewport.scrollAndZoomIntoView([board]);return {board:board.id,guides:guides.id};
