// TYFILE1804 image-page writer, derived from the user's 2026927142137.ty.
// This is a binary document, not a renamed ZIP. Opaque metadata is retained
// from a clean image record; PNG bytes are embedded without recompression.
const ascii=s=>new TextEncoder().encode(s);
const hex=s=>Uint8Array.from(s.match(/../g),x=>parseInt(x,16));
const PAGE=hex('504147455f5354415254ffffffff00000000000000000000000000000000000000000000000000000000000000000100000001002213ff000000000000f03f0000000000000000000000000000000000000000');
const IMAGE=hex('50454e5f5f53544152540e00000000000000000000000000ff000000ff0cfeffffe7fefffff401000019010000c00300001c0200000000000000009043045622430000cc44045622430000cc447f6a6544000090437f6a6544000070440456134300009043000007440000cc4400000744000070447f6a654400000000000000001b2fdd240681f53f1b2fdd240681f53f0164000000000000494d4147455f545950450001000000000000000000000000000000494d4147455f5f5f4f4b6b910000');
const uint=n=>{const b=new Uint8Array(4);new DataView(b.buffer).setUint32(0,n,true);return b;};
export const BOARD={width:1920,height:1080};
export const boardBackground=ink=>ink==='black'?'#ffffff':'#132200';
export function pngSize(bytes){
 const sig=[137,80,78,71,13,10,26,10];
 if(!(bytes instanceof Uint8Array)||bytes.length<33||!sig.every((v,i)=>bytes[i]===v)||String.fromCharCode(...bytes.subarray(12,16))!=='IHDR')throw Error('A crop is not a valid PNG. Generate the crops again.');
 const d=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),width=d.getUint32(16),height=d.getUint32(20);
 if(!width||!height||width>30000||height>30000)throw Error('PNG dimensions are outside the supported range.');
 return {width,height};
}
export function imagePlacement(width,height,align='upper',sizePercent=60){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1)throw Error('Invalid image dimensions.');
 const requested=Number(sizePercent),percent=Number.isFinite(requested)?Math.max(10,Math.min(100,requested)):60;
 const scale=Math.min(1728/width,864/height)*percent/100;
 const rect={left:-Math.floor(width/2),top:-Math.floor(height/2),right:Math.ceil(width/2),bottom:Math.ceil(height/2)};
 const cx=Math.round(960-(rect.left+rect.right)*scale/2);
 const topCentre=64-rect.top*scale, pageCentre=540-(rect.top+rect.bottom)*scale/2;
 const cy=Math.round(align==='center'?pageCentre:align==='top'?topCentre:(topCentre+pageCentre)/2);
 return {...rect,cx,cy,scale,x:cx+rect.left*scale,y:cy+rect.top*scale,width:width*scale,height:height*scale};
}
export function pageHeader(ink='white'){
 const b=PAGE.slice();
 // Enabled background + Windows COLORREF/ARGB bytes, as in the sample.
 new DataView(b.buffer).setUint32(51,ink==='black'?0xffffffff:0xff132200,true);
 return b;
}
export function imageRecord(bytes,index,placement){
 const {width,height}=pngSize(bytes),p=placement??imagePlacement(width,height);
 const b=IMAGE.slice(),v=new DataView(b.buffer);
 for(const [offset,n] of [[29,p.left],[33,p.top],[37,p.right],[41,p.bottom],[45,p.cx],[49,p.cy]])v.setInt32(offset,n,true);
 const x1=p.cx+p.left*p.scale,x2=p.cx+p.right*p.scale,y1=p.cy+p.top*p.scale,y2=p.cy+p.bottom*p.scale;
 const points=[x1,y1,x2,y1,x2,y2,x1,y2,p.cx,y1-15,x1,p.cy,x2,p.cy,p.cx,y2];
 points.forEach((n,i)=>v.setFloat32(57+i*4,n,true));
 v.setFloat64(121,0,true);v.setFloat64(129,p.scale,true);v.setFloat64(137,p.scale,true);
 v.setUint32(164,index,true);v.setUint32(190,bytes.length,true);
 return b;
}
function group(count){
 const prefix=ascii('GROUPSTART'),title=ascii('GROUPTITLE'),name='Group1';
 const b=new Uint8Array(14+10+4+(name.length+1)*2+4+count*8),v=new DataView(b.buffer);
 b.set(prefix);v.setUint32(10,1,true);b.set(title,14);v.setUint32(24,name.length,true);
 for(let i=0;i<name.length;i++)v.setUint16(28+2*i,name.charCodeAt(i),true);
 const start=28+(name.length+1)*2;v.setUint32(start,count,true);
 for(let i=0;i<count;i++){v.setUint32(start+4+i*8,i+1,true);v.setUint32(start+8+i*8,i,true);}
 return b;
}
export async function createTyDocument(crops,{ink='white',align='upper',sizePercent=60,onProgress=()=>{}}={}){
 if(!crops.length)throw Error('No crops to export.');
 if(crops.length>2000)throw Error('Export up to 2,000 crops at a time. Use a unit filter for a smaller file.');
 if(crops.some(q=>!q.blob))throw Error('Some PNGs are still missing. Generate them before exporting.');
 if(crops.reduce((sum,q)=>sum+q.blob.size,0)>512*1024*1024)throw Error('This board file would exceed 512 MB. Export one unit at a time or select a lower DPI.');
 const parts=[ascii('TYFILE1804TY___PAGES'),uint(crops.length)],ending=ascii('BK_DISABLE');
 for(let i=0;i<crops.length;i++){
  const bytes=new Uint8Array(await crops[i].blob.arrayBuffer()),{width,height}=pngSize(bytes);
  parts.push(pageHeader(ink),imageRecord(bytes,i+1,imagePlacement(width,height,align,sizePercent)),crops[i].blob,ending);
  await onProgress(i+1,crops.length);
 }
 parts.push(group(crops.length));
 return new Blob(parts,{type:'application/octet-stream'});
}
