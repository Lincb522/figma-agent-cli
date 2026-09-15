// Reconstructed from the recorded example. Pass IDs returned by your own run through --args.
const board=await h.node(args.boardId),art=await h.node(args.inPlaceArtworkId);await figma.setCurrentPageAsync(board.parent);
const aux=figma.createFrame();board.appendChild(aux);aux.name='构造辅助 / 由真实 vectorNetwork 生成 / 非原生编辑模式';aux.resize(1254,1254);aux.fills=[];aux.clipsContent=false;
const bt=board.absoluteTransform;const det=bt[0][0]*bt[1][1]-bt[0][1]*bt[1][0];
const project=(node,p)=>{const t=node.absoluteTransform;const xx=t[0][0]*p.x+t[0][1]*p.y+t[0][2]-bt[0][2],yy=t[1][0]*p.x+t[1][1]*p.y+t[1][2]-bt[1][2];return {x:(bt[1][1]*xx-bt[0][1]*yy)/det,y:(-bt[1][0]*xx+bt[0][0]*yy)/det};};
const primitives=art.findAll(n=>['VECTOR','ELLIPSE','RECTANGLE'].includes(n.type));const records=[];
for(const n of primitives){let paths='',handles='',markers='';let data={sourceId:n.id,type:n.type,name:n.name,absoluteTransform:n.absoluteTransform};
const path=(d,color='#DDA960',opacity=.7)=>`<path d="${d}" fill="none" stroke="${color}" stroke-opacity="${opacity}" stroke-width="1.15"/>`;
if(n.type==='VECTOR'){
 const net=n.vectorNetwork;data.vectorNetwork=net;data.vertices=[];data.handles=[];
 for(const [j,s]of net.segments.entries()){const va=net.vertices[s.start],vb=net.vertices[s.end],ta=s.tangentStart||{x:0,y:0},tb=s.tangentEnd||{x:0,y:0};const a=project(n,va),b=project(n,vb),ca=project(n,{x:va.x+ta.x,y:va.y+ta.y}),cb=project(n,{x:vb.x+tb.x,y:vb.y+tb.y});paths+=path(`M ${a.x} ${a.y} C ${ca.x} ${ca.y} ${cb.x} ${cb.y} ${b.x} ${b.y}`);
 for(const [end,v,c,t]of [['start',a,ca,ta],['end',b,cb,tb]])if(Math.abs(t.x)+Math.abs(t.y)>0.0001){handles+=path(`M ${v.x} ${v.y} L ${c.x} ${c.y}`,'#7B9BAB',.9);markers+=`<circle cx="${c.x}" cy="${c.y}" r="3" fill="#F6B15A" stroke="#6E4729" stroke-width="0.6"/>`;data.handles.push({segment:j,end,point:c});}
 }
 for(const [i,v]of net.vertices.entries()){const q=project(n,v);markers+=`<rect x="${q.x-3}" y="${q.y-3}" width="6" height="6" fill="#43B8FF" stroke="#FFFFFF" stroke-width="0.8"/>`;data.vertices.push({index:i,point:q});}
}else if(n.type==='RECTANGLE'){
 const p=[[0,0],[n.width,0],[n.width,n.height],[0,n.height]].map(([x,y])=>project(n,{x,y}));paths+=path(`M ${p[0].x} ${p[0].y} L ${p[1].x} ${p[1].y} L ${p[2].x} ${p[2].y} L ${p[3].x} ${p[3].y} Z`);data.bounds={width:n.width,height:n.height};
}else{
 const o=project(n,{x:0,y:0}),xx=project(n,{x:1,y:0}),yy=project(n,{x:0,y:1});paths+=`<ellipse cx="${n.width/2}" cy="${n.height/2}" rx="${n.width/2}" ry="${n.height/2}" transform="matrix(${xx.x-o.x} ${xx.y-o.y} ${yy.x-o.x} ${yy.y-o.y} ${o.x} ${o.y})" fill="none" stroke="#DDA960" stroke-opacity="0.7" stroke-width="1.15"/>`;data.bounds={width:n.width,height:n.height};}
 const svg=figma.createNodeFromSvg('<svg xmlns="http://www.w3.org/2000/svg" width="1254" height="1254">'+paths+handles+markers+'</svg>');aux.appendChild(svg);svg.name='Actual operand geometry / '+n.id+' / '+n.name;svg.x=0;svg.y=0;data.auxiliaryNodeId=svg.id;records.push(data);
}
await figma.loadFontAsync({family:'Noto Sans SC',style:'Regular'});const label=figma.createText();board.appendChild(label);label.name='构造辅助说明';label.fontName={family:'Noto Sans SC',style:'Regular'};label.fontSize=14;label.characters='原位构造辅助 · 真实 vectorNetwork 顶点 / 切线数据 · 非原生编辑模式';label.fills=[h.solid('#737E89')];label.x=72;label.y=1210;
figma.currentPage.selection=[board];figma.viewport.scrollAndZoomIntoView([board]);return {board:board.id,artwork:art.id,auxiliary:aux.id,primitiveCount:records.length,vectorCount:records.filter(r=>r.type==='VECTOR').length,vertexCount:records.reduce((s,r)=>s+(r.vertices?.length||0),0),handleCount:records.reduce((s,r)=>s+(r.handles?.length||0),0),records};
