// A contract fixture, not a renderer or a substitute for live Figma verification.
export function fixture() {
  let sequence = 0;
  const nodes = new Map<string, any>(); const loaded = new Set<string>();
  const geometryCalls: { operation:string; names:string[]; positions:Transform[] }[] = [];
  const product=(a:Transform,b:Transform):Transform=>[[a[0][0]*b[0][0]+a[0][1]*b[1][0],a[0][0]*b[0][1]+a[0][1]*b[1][1],a[0][0]*b[0][2]+a[0][1]*b[1][2]+a[0][2]],[a[1][0]*b[0][0]+a[1][1]*b[1][0],a[1][0]*b[0][1]+a[1][1]*b[1][1],a[1][0]*b[0][2]+a[1][1]*b[1][2]+a[1][2]]];
  const create = (type: string): any => {
    const data=new Map<string,string>();let transform:Transform=[[1,0,0],[0,1,0]];
    const node: any = { id: `1:${++sequence}`, type, name: type, parent: null, removed: false, x: 0, y: 0, width: 100, height: 100, fills: [], strokes:[], strokeWeight:1, visible:true, locked:false,clipsContent:false,layoutPositioning:'AUTO', opacity: 1, cornerRadius: 0, fontSize: 12, layoutMode: 'NONE', textAutoResize: 'NONE',
      primaryAxisSizingMode: 'AUTO', counterAxisSizingMode: 'AUTO',
      resize(w: number, h: number) { if (w < 0.01 || (this.type === 'LINE' ? h !== 0 : h < 0.01)) throw new Error('Invalid size'); this.width = w; this.height = h; },
      remove() { if (this.parent) this.parent.children = this.parent.children.filter((n: any) => n !== this); for (const child of this.children ?? []) child.remove(); this.removed = true; nodes.delete(this.id); },
      setPluginData(key:string,value:string) {data.set(key,value);},getPluginData(key:string){return data.get(key)??'';}, getRangeAllFontNames() { return [this.fontName]; },
      clone(){const copy=create(this.type);for(const field of ['name','width','height','fills','strokes','strokeWeight','visible','locked','opacity','layoutMode','primaryAxisSizingMode','counterAxisSizingMode','fontSize','cornerRadius'])copy[field]=this[field];copy.relativeTransform=this.relativeTransform;if(this.type==='TEXT'){copy.fontName=this.fontName;copy.characters=this.characters;}this.parent?.appendChild(copy);for(const child of [...(this.children??[])])copy.appendChild(child.clone());return copy;},
      outlineStroke(){if(!this.strokes.length)return null;const vector=create('VECTOR');vector.resize(this.width,this.height);this.parent.appendChild(vector);vector.relativeTransform=this.relativeTransform;return vector;},
    };
    Object.defineProperty(node,'relativeTransform',{get:()=>[[transform[0][0],transform[0][1],node.x],[transform[1][0],transform[1][1],node.y]],set:(value:Transform)=>{transform=value;node.x=value[0][2];node.y=value[1][2];}});
    Object.defineProperty(node,'absoluteTransform',{get:()=>product(node.parent?.absoluteTransform??[[1,0,0],[0,1,0]],node.relativeTransform)});
    Object.defineProperty(node,'absoluteBoundingBox',{get:()=>{const a=node.absoluteTransform;const points=[[0,0],[node.width,0],[0,node.height],[node.width,node.height]].map(([x,y])=>[a[0][0]*x+a[0][1]*y+a[0][2],a[1][0]*x+a[1][1]*y+a[1][2]]);const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);return{x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)};}});
    if (['PAGE', 'FRAME', 'COMPONENT', 'SECTION','GROUP','BOOLEAN_OPERATION'].includes(type)) {
      node.children = [];
      node.appendChild = function(child: any) { if (child.parent) child.parent.children = child.parent.children.filter((n: any) => n !== child); this.children.push(child); child.parent = this; };
    }
    if (type === 'TEXT') {
      let fontName = { family: 'Inter', style: 'Regular' }; let characters = '';
      Object.defineProperty(node, 'fontName', { get: () => fontName, set: value => { if (!loaded.has(JSON.stringify(value))) throw new Error('Font not loaded'); fontName = value; }, enumerable: true });
      Object.defineProperty(node, 'characters', { get: () => characters, set: value => { if (!loaded.has(JSON.stringify(fontName))) throw new Error('Font not loaded'); characters = value; }, enumerable: true });
    }
    let sizing = 'FIXED';
    Object.defineProperty(node, 'layoutSizingHorizontal', { get: () => sizing, set: value => { if (value === 'FILL' && node.parent?.layoutMode === 'NONE') throw new Error('FILL needs auto-layout parent'); sizing = value; }, enumerable: true });
    let rotation = 0;
    Object.defineProperty(node, 'rotation', { get: () => rotation, set: value => { if (value === 'invalid') throw new Error('Invalid rotation'); rotation = value; }, enumerable: true });
    nodes.set(node.id, node); return node;
  };
  const page = create('PAGE'); page.selection = []; const root = { getPluginData:()=>'', id: '0:0', name: 'Fixture', type: 'DOCUMENT', children: [page] }; page.parent = root;
  const api: any = { currentPage: page, root, mixed: Symbol('mixed'), viewport: { center: { x: 0, y: 0 }, zoom: 1, scrollAndZoomIntoView() {} }, getNodeByIdAsync: async (id: string) => nodes.get(id) ?? null, loadFontAsync: async (font: FontName) => { if (font.family === 'Missing') throw new Error('Font missing'); loaded.add(JSON.stringify(font)); } };
  for (const [method, type] of Object.entries({ createFrame: 'FRAME', createComponent: 'COMPONENT', createText: 'TEXT', createRectangle: 'RECTANGLE', createEllipse: 'ELLIPSE', createLine: 'LINE', createPolygon: 'POLYGON', createStar: 'STAR', createVector: 'VECTOR' })) api[method] = () => { const n = create(type); page.appendChild(n); return n; };
  for(const operation of ['union','subtract','intersect','exclude','flatten'])api[operation]=(operands:any[],parent:any)=>{
    geometryCalls.push({operation,names:operands.map(n=>n.name),positions:operands.map(n=>n.absoluteTransform)});
    const minX=Math.min(...operands.map(n=>n.x)),minY=Math.min(...operands.map(n=>n.y));
    const width=Math.max(...operands.map(n=>n.x+n.width))-minX,height=Math.max(...operands.map(n=>n.y+n.height))-minY;
    const result=create(operation==='flatten'?'VECTOR':'BOOLEAN_OPERATION');result.booleanOperation=operation.toUpperCase();result.x=minX;result.y=minY;result.width=width;result.height=height;parent.appendChild(result);
    for(const operand of [...operands]){if(operation==='flatten')operand.remove();else{const t=operand.relativeTransform;result.appendChild(operand);operand.relativeTransform=[[t[0][0],t[0][1],t[0][2]-minX],[t[1][0],t[1][1],t[1][2]-minY]];}}
    return result;
  };
  api.base64Decode=(s:string)=>new Uint8Array(Buffer.from(s,'base64'));
  api.createImage=()=>({hash:'synthetic-image',getSizeAsync:async()=>({width:100,height:100})});
  return { api: api as PluginAPI, nodes, page, loaded,geometryCalls };
}
