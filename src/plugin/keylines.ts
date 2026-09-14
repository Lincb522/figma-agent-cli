import { AgentError } from '../protocol.js';
import { getNode, solid, type DesignSpec, type NodeSpec } from './design.js';
import { inverse, multiply } from './geometry.js';

import { GUIDE_TAG, ARTWORK_TAG, artworkOf } from './node-roles.js';
const SHAPE_TAG = 'icon-keyline-shape:';
export const KEYLINE_SHAPES = ['circle','inner-circle','square','portrait','landscape'] as const;
export type KeylineShape = typeof KEYLINE_SHAPES[number];
export function keylineGeometry(size: number) {
  if (!Number.isInteger(size) || size < 16 || size > 4096) throw new AgentError('INVALID_SIZE','Keyline size must be an integer from 16 to 4096.');
  const u=size/24;
  return [
    {name:'circle' as const,type:'ELLIPSE',x:2*u,y:2*u,width:20*u,height:20*u},
    {name:'inner-circle' as const,type:'ELLIPSE',x:7*u,y:7*u,width:10*u,height:10*u},
    {name:'square' as const,type:'RECTANGLE',x:3*u,y:3*u,width:18*u,height:18*u,radius:2*u},
    {name:'portrait' as const,type:'RECTANGLE',x:4*u,y:2*u,width:16*u,height:20*u,radius:2*u},
    {name:'landscape' as const,type:'RECTANGLE',x:2*u,y:4*u,width:20*u,height:16*u,radius:2*u},
  ];
}
export function keylineGuides(size: number): NodeSpec {
  const shapes=keylineGeometry(size), weight=size/240;
  const props={fills:[],strokes:[solid('#A3A0AA')],strokeWeight:weight};
  const children:NodeSpec[]=[{key:'guide-boundary',type:'RECTANGLE',props:{...props,name:'Boundary',width:size,height:size,x:0,y:0}}];
  for(const fraction of [1/3,1/2,2/3]) {
    children.push({type:'LINE',props:{...props,name:`Horizontal / ${fraction}`,width:size,height:0,x:0,y:size*fraction,opacity:.55}});
    children.push({type:'LINE',props:{...props,name:`Vertical / ${fraction}`,width:size,height:0,x:size*fraction,y:0,rotation:-90,opacity:.55}});
  }
  children.push({type:'LINE',props:{...props,name:'Diagonal / descending',width:size*Math.SQRT2,height:0,x:0,y:0,rotation:-45,opacity:.65}});
  children.push({type:'LINE',props:{...props,name:'Diagonal / ascending',width:size*Math.SQRT2,height:0,x:0,y:size,rotation:45,opacity:.65}});
  for(const s of shapes)children.push({key:'guide-'+s.name,tag:SHAPE_TAG+s.name,type:s.type,props:{...props,name:s.name,x:s.x,y:s.y,width:s.width,height:s.height,...('radius' in s?{cornerRadius:s.radius}:{}),opacity:s.name==='inner-circle'?.5:.85}});
  return {key:'guides',tag:GUIDE_TAG,type:'FRAME',props:{name:'Guides / Keylines',width:size,height:size,x:0,y:0,fills:[],clipsContent:false,locked:true},children};
}
export function constructionSpec(size:number,children:NodeSpec[]=[],name='Icon construction'):DesignSpec {
  const guides=keylineGuides(size);
  return {nodes:[{key:'workbench',type:'FRAME',props:{name,width:size,height:size,fills:[],clipsContent:false},children:[
    {key:'icon',tag:ARTWORK_TAG,type:'FRAME',props:{name:'Artwork / Export this frame',width:size,height:size,x:0,y:0,fills:[],clipsContent:false},children},guides,
  ]}]};
}
export function keylineSvg(size:number) {
  const shapes=keylineGeometry(size), n=(v:number)=>Math.round(v*10000)/10000;
  const guides=shapes.map(s=>s.type==='ELLIPSE'
    ? `<ellipse id="keyline-${s.name}" cx="${n(s.x+s.width/2)}" cy="${n(s.y+s.height/2)}" rx="${n(s.width/2)}" ry="${n(s.height/2)}"/>`
    : `<rect id="keyline-${s.name}" x="${n(s.x)}" y="${n(s.y)}" width="${n(s.width)}" height="${n(s.height)}" rx="${n(s.radius!)}"/>`).join('');
  const lines=[1/3,1/2,2/3].map(f=>`M0 ${n(size*f)}H${size}M${n(size*f)} 0V${size}`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="图标构造网格"><g id="keylines" fill="none" stroke="#A3A0AA" stroke-width="${n(size/240)}"><path opacity=".55" d="${lines}"/><path opacity=".65" d="M0 0 ${size} ${size}M0 ${size} ${size} 0"/><rect width="${size}" height="${size}"/>${guides}</g></svg>`;
}
export async function shapeFromKeyline(api:PluginAPI,id:string,shape:KeylineShape,color='#28634B',name?:string) {
  if(!KEYLINE_SHAPES.includes(shape))throw new AgentError('INVALID_KEYLINE_SHAPE','Choose circle, inner-circle, square, portrait or landscape.');
  const fill=solid(color),workbench=await getNode(api,id),artwork=artworkOf(workbench);
  if(!artwork||artwork.type!=='FRAME'||!('children' in workbench))throw new AgentError('KEYLINE_WORKBENCH_REQUIRED','Choose the workbench ID returned when applying an icon construction grid.');
  const guides=workbench.children.find(n=>n.getPluginData('figma-agent:tag')===GUIDE_TAG);
  const prototype=guides&&'children' in guides?guides.children.find(n=>n.getPluginData('figma-agent:tag')===SHAPE_TAG+shape):null;
  if(!prototype||(prototype.type!=='ELLIPSE'&&prototype.type!=='RECTANGLE'))throw new AgentError('KEYLINE_MISSING','This construction grid no longer contains the requested shape.');
  const position=prototype.absoluteTransform;
  const copy=prototype.clone();
  try {
    artwork.appendChild(copy);copy.relativeTransform=multiply(inverse(artwork.absoluteTransform),position);
    copy.locked=false;copy.visible=true;copy.opacity=1;copy.name=name??'Shape / '+shape;
    copy.setPluginData('figma-agent:tag','');
    if('fills' in copy)copy.fills=[fill];if('strokes' in copy)copy.strokes=[];
    return {id:copy.id,type:copy.type,name:copy.name,artworkId:artwork.id,workbenchId:workbench.id,source:shape,bounds:copy.absoluteBoundingBox};
  }catch(error){copy.remove();throw error;}
}
