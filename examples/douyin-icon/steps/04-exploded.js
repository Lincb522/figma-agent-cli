// Reconstructed from the recorded example. Pass IDs returned by your own run through --args.
await figma.setCurrentPageAsync(await h.node(args.pageId));
await figma.loadFontAsync({family:'Noto Sans SC',style:'Regular'});
const artwork=await h.node(args.artworkId);const vectors=artwork.findAll(n=>n.type==='VECTOR');
const board=figma.createFrame();board.name='辅助构造 / 实际 vectorNetwork 顶点与切线（非原生编辑模式）';board.x=2740;board.y=0;board.resize(1800,1400);board.fills=[h.solid('#FFFFFF')];
const label=(p,s,x,y,size)=>{const t=figma.createText();p.appendChild(t);t.fontName={family:'Noto Sans SC',style:'Regular'};t.characters=s;t.fontSize=size;t.x=x;t.y=y;t.fills=[h.solid('#292A27')];return t};
label(board,'实际 vectorNetwork / 6 个矢量操作数',32,24,28);label(board,'蓝色方点 = 顶点   橙色圆点 = 切线控制点   灰线 = 控制柄连线；此层是数据推导的辅助图，不是原生编辑点。',32,76,17);
const records=[];
for(let i=0;i<vectors.length;i++){
 const n=vectors[i],net=n.vectorNetwork;const tile=figma.createFrame();board.appendChild(tile);tile.name='Network / '+n.id;tile.x=24+(i%3)*588;tile.y=130+Math.floor(i/3)*626;tile.resize(564,598);tile.fills=[];
 let owner=n.parent;while(owner.parent&&owner.parent!==artwork)owner=owner.parent;
 label(tile,owner.name+' / '+n.name,12,8,16);label(tile,n.id+' · '+net.vertices.length+' vertices / '+net.segments.length+' segments',12,39,13);
 const all=[...net.vertices];for(const s of net.segments){const a=net.vertices[s.start],b=net.vertices[s.end];if(s.tangentStart)all.push({x:a.x+s.tangentStart.x,y:a.y+s.tangentStart.y});if(s.tangentEnd)all.push({x:b.x+s.tangentEnd.x,y:b.y+s.tangentEnd.y});}
 const minX=Math.min(...all.map(p=>p.x)),minY=Math.min(...all.map(p=>p.y)),maxX=Math.max(...all.map(p=>p.x)),maxY=Math.max(...all.map(p=>p.y));const scale=Math.min(440/(maxX-minX||1),440/(maxY-minY||1));const pt=p=>({x:60+(p.x-minX)*scale,y:102+(p.y-minY)*scale});
 let svg='<svg xmlns="http://www.w3.org/2000/svg" width="564" height="598">';const controls=[];
 net.segments.forEach((s,j)=>{const a=pt(net.vertices[s.start]),b=pt(net.vertices[s.end]);const ta=s.tangentStart||{x:0,y:0},tb=s.tangentEnd||{x:0,y:0};const ca={x:a.x+ta.x*scale,y:a.y+ta.y*scale},cb={x:b.x+tb.x*scale,y:b.y+tb.y*scale};svg+=`<path d="M ${a.x} ${a.y} C ${ca.x} ${ca.y} ${cb.x} ${cb.y} ${b.x} ${b.y}" fill="none" stroke="#292A27" stroke-width="2"/>`;for(const [which,v,c,t]of [['start',a,ca,ta],['end',b,cb,tb]]){if(Math.abs(t.x)+Math.abs(t.y)>0.0001){svg+=`<path d="M ${v.x} ${v.y} L ${c.x} ${c.y}" stroke="#999999" stroke-width="1"/><circle cx="${c.x}" cy="${c.y}" r="4" fill="#EF8B30"/>`;controls.push({segment:j,end:which,vector:t,display:c});}}});
 net.vertices.forEach(v=>{const q=pt(v);svg+=`<rect x="${q.x-4}" y="${q.y-4}" width="8" height="8" fill="#1476FF"/>`;});svg+='</svg>';const drawing=figma.createNodeFromSvg(svg);tile.appendChild(drawing);drawing.name='Derived points and handles / '+n.id;drawing.x=0;drawing.y=0;
 records.push({sourceId:n.id,name:n.name,colorLayer:owner.name,absoluteTransform:n.absoluteTransform,vectorNetwork:net,display:{tileId:tile.id,scale,minX,minY,controls}});
}
figma.currentPage.selection=[board];figma.viewport.scrollAndZoomIntoView([board]);return {board:board.id,sourceVectorCount:vectors.length,records};
