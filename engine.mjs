// Pixel-based dividers work for scanned and vector papers. Number anchors
// improve header rejection when a PDF includes extractable text.
export function findDividers(image) {
 const {data,width:w,height:h}=image, left=Math.floor(w*.035),right=Math.ceil(w*.965), rows=[];
 for(let y=2;y<h-2;y++) {
  let count=0;
  for(let x=left;x<right;x++) {
   let dark=false;
   for(let dy=-2;dy<=2;dy++){let i=((y+dy)*w+x)*4;if((data[i]+data[i+1]+data[i+2])<420){dark=true;break;}}
   if(dark)count++;
  }
  if(count/(right-left)>.83) rows.push(y);
 }
 let groups=[];
 for(const y of rows){let prev=groups.at(-1);if(prev&&y-prev[1]<7)prev[1]=y;else groups.push([y,y]);}
 return groups.map(([a,b])=>({top:(a+2)/h,bottom:(b-2)/h,mid:(a+b)/2/h}));
}
export function findAnchors(items,viewport) {
 let anchors=[];
 for(const item of items){const m=item.str.trim().match(/^(\d{1,3})[.)](?:\s|$)/);if(!m)continue;
  const p=viewport.convertToViewportPoint(item.transform[4],item.transform[5]);
  const x=p[0]/viewport.width, y=p[1]/viewport.height;
  if(x>.02&&x<.15&&y>.015&&y<.97) anchors.push({number:Number(m[1]),x,y});
 }
 return anchors.sort((a,b)=>a.y-b.y).filter((a,i,all)=>!i||Math.abs(a.y-all[i-1].y)>.01);
}
export function makeRegions(lines,anchors,footer=.08) {
 const end=1-footer, gap=.002, regions=[];
 const usable=lines.filter(l=>l.mid<end);
 if(anchors.length){
  for(let i=0;i<anchors.length;i++){
   const a=anchors[i];if(a.y>=end)continue;
   const before=usable.filter(l=>l.bottom<a.y-.003).at(-1);
   const after=usable.find(l=>l.top>a.y+.002);
   let top=before?before.bottom+gap:Math.max(.018,a.y-.025);
   let bottom=after?Math.min(end,after.top-gap):end;
   if(i&&top<anchors[i-1].y)top=(anchors[i-1].y+a.y)/2;
   if(anchors[i+1]&&bottom>anchors[i+1].y)bottom=anchors[i+1].y-.025;
   if(bottom>top+.015)regions.push({number:a.number,x:.046,y:top,right:.95,bottom});
  }
 }else{
  const cuts=[.025,...usable.map(l=>l.mid),end].sort((a,b)=>a-b);
  for(let i=0;i<cuts.length-1;i++)if(cuts[i+1]-cuts[i]>.028)regions.push({number:null,x:.046,y:cuts[i]+gap,right:.95,bottom:cuts[i+1]-gap});
 }
 return regions;
}
export function convertInk(image,ink='white',clean=20,trim=true) {
 const {data,width:w,height:h}=image;
 const threshold=255*(1-clean/100), colour=ink==='white'?255:0;
 let left=w,top=h,right=-1,bottom=-1;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const i=(y*w+x)*4;
  const lum=data[i]*.2126+data[i+1]*.7152+data[i+2]*.0722;
  const alpha=Math.max(0,Math.min(255,Math.round((threshold-lum)/threshold*255)));
  data[i]=data[i+1]=data[i+2]=colour;data[i+3]=alpha;
  if(alpha>20){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
 }
 if(!trim||right<0)return {x:0,y:0,width:w,height:h};
 const pad=Math.max(12,Math.round(w*.012));
 left=Math.max(0,left-pad);top=Math.max(0,top-pad);right=Math.min(w-1,right+pad);bottom=Math.min(h-1,bottom+pad);
 return {x:left,y:top,width:right-left+1,height:bottom-top+1};
}

// Render each region directly from the PDF at the selected resolution.
// Never enlarge a low-resolution page thumbnail or allocate a full 1200-DPI page.
export async function renderQuestion(page,q,scale,createCanvas) {
 const viewport=page.getViewport({scale});
 const x=Math.floor(q.x*viewport.width),y=Math.floor(q.y*viewport.height);
 const w=Math.max(1,Math.ceil(q.right*viewport.width)-x),h=Math.max(1,Math.ceil(q.bottom*viewport.height)-y);
 if(w>30000||h>30000||w*h>40000000)throw Error('This crop is too large at the selected quality. Choose 300 DPI or make the crop smaller.');
 const canvas=createCanvas(w,h);
 await page.render({canvasContext:canvas.getContext('2d'),viewport,transform:[1,0,0,1,-x,-y],background:'rgb(255,255,255)'}).promise;
 return canvas;
}
// Canvas encoders use 96 DPI by default. Set the real print resolution while
// preserving every losslessly encoded pixel and all other PNG chunks.
export function withPngDpi(png,dpi) {
 const chunk=new Uint8Array(21),view=new DataView(chunk.buffer);
 view.setUint32(0,9);chunk.set([112,72,89,115],4);
 const ppm=Math.round(dpi/.0254);view.setUint32(8,ppm);view.setUint32(12,ppm);chunk[16]=1;
 let crc=0xffffffff;
 for(let i=4;i<17;i++){crc^=chunk[i];for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
 view.setUint32(17,(crc^0xffffffff)>>>0);
 const parts=[png.subarray(0,8)];let inserted=false;
 for(let offset=8;offset<png.length;){
  const length=new DataView(png.buffer,png.byteOffset+offset,4).getUint32(0),end=offset+12+length;
  const type=String.fromCharCode(...png.subarray(offset+4,offset+8));
  if(type!=='pHYs')parts.push(png.subarray(offset,end));
  if(type==='IHDR'&&!inserted){parts.push(chunk);inserted=true;}
  offset=end;
 }
 const out=new Uint8Array(parts.reduce((sum,p)=>sum+p.length,0));let offset=0;
 for(const p of parts){out.set(p,offset);offset+=p.length;}return out;
}
