// Generate platform icons from the exact Equus navigation logo.
// Uses only Node built-ins so deploys do not depend on native image libraries.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const root = process.cwd();
const source = path.join(root, "public/equus-logo-black.png");
const bytes = fs.readFileSync(source);
if (bytes.subarray(0,8).toString("hex") !== "89504e470d0a1a0a") throw new Error("Invalid Equus PNG");
let offset=8, width=0, height=0, bpp=0;
const blocks=[];
while(offset<bytes.length){
  const length=bytes.readUInt32BE(offset);const type=bytes.toString("ascii",offset+4,offset+8);
  const data=bytes.subarray(offset+8,offset+8+length);
  if(type==="IHDR"){
    width=data.readUInt32BE(0);height=data.readUInt32BE(4);
    if(data[8]!==8 || ![2,6].includes(data[9]) || data[12]!==0) throw new Error("Unsupported Equus PNG format");
    bpp=data[9]===2?3:4;
  }
  if(type==="IDAT")blocks.push(data);
  offset+=length+12;
  if(type==="IEND")break;
}
if(!width || !height || !blocks.length)throw new Error("Missing Equus PNG data");
const unpacked=zlib.inflateSync(Buffer.concat(blocks));
const stride=width*bpp;
const pixels=Buffer.alloc(stride*height);
let p=0;
for(let y=0;y<height;y++){
  const filter=unpacked[p++];
  for(let x=0;x<stride;x++){
    const raw=unpacked[p++];
    const left=x>=bpp?pixels[y*stride+x-bpp]:0;
    const up=y>0?pixels[(y-1)*stride+x]:0;
    const ul=y>0&&x>=bpp?pixels[(y-1)*stride+x-bpp]:0;
    let predictor=0;
    if(filter===1)predictor=left;
    else if(filter===2)predictor=up;
    else if(filter===3)predictor=Math.floor((left+up)/2);
    else if(filter===4){
      const q=left+up-ul;
      const a=Math.abs(q-left),b=Math.abs(q-up),c=Math.abs(q-ul);
      predictor=a<=b&&a<=c?left:b<=c?up:ul;
    }else if(filter!==0)throw new Error("Unsupported Equus PNG filter");
    pixels[y*stride+x]=(raw+predictor)&255;
  }
}
const crcTable=new Uint32Array(256);
for(let i=0;i<256;i++){let c=i;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;crcTable[i]=c>>>0;}
function chunk(type,data){
  const body=Buffer.concat([Buffer.from(type),data]);
  let crc=0xffffffff;
  for(const octet of body)crc=crcTable[(crc^octet)&255]^(crc>>>8);
  const result=Buffer.alloc(12+data.length);
  result.writeUInt32BE(data.length,0);result.write(type,4,4,"ascii");data.copy(result,8);
  result.writeUInt32BE((crc^0xffffffff)>>>0,8+data.length);
  return result;
}
function exportIcon(size,file){
  const row=size*4+1, out=Buffer.alloc(row*size);
  // Bilinear scaling of the original black-and-white artwork.
  for(let y=0;y<size;y++){
    const sy=Math.max(0,Math.min(height-1,(y+0.5)*height/size-0.5));
    const y0=Math.floor(sy),y1=Math.min(height-1,y0+1),fy=sy-y0;
    out[y*row]=0;
    for(let x=0;x<size;x++){
      const sx=Math.max(0,Math.min(width-1,(x+0.5)*width/size-0.5));
      const x0=Math.floor(sx),x1=Math.min(width-1,x0+1),fx=sx-x0;
      for(let c=0;c<4;c++){
        const read=(xx,yy)=>c===3&&bpp===3?255:pixels[(yy*width+xx)*bpp+c];
        const top=read(x0,y0)*(1-fx)+read(x1,y0)*fx;
        const bottom=read(x0,y1)*(1-fx)+read(x1,y1)*fx;
        out[y*row+1+x*4+c]=Math.round(top*(1-fy)+bottom*fy);
      }
    }
  }
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(size,0);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=6;
  const encoded=Buffer.concat([bytes.subarray(0,8),chunk("IHDR",ihdr),chunk("IDAT",zlib.deflateSync(out,{level:9})),chunk("IEND",Buffer.alloc(0))]);
  fs.writeFileSync(path.join(root,"public",file),encoded);
  process.stdout.write(`Equus icon: ${file} (${size}x${size})\n`);
}

// Android notification badges require a transparent, monochrome symbol.
// The original navigation artwork is a white horse on black; remove the black
// background so Android never renders a solid white notification square.
function exportNotificationBadge(size,file) {
  const row=size*4+1, out=Buffer.alloc(row*size);
  for(let y=0;y<size;y++) {
    out[y*row]=0;
    for(let x=0;x<size;x++) {
      const sx=Math.min(width-1,Math.floor((x+0.5)*width/size));
      const sy=Math.min(height-1,Math.floor((y+0.5)*height/size));
      const ix=(sy*width+sx)*bpp;
      const luminance=(pixels[ix]*299+pixels[ix+1]*587+pixels[ix+2]*114)/1000;
      const originalAlpha=bpp===4?pixels[ix+3]:255;
      const dst=y*row+1+x*4;
      out[dst]=255;out[dst+1]=255;out[dst+2]=255;
      out[dst+3]=Math.round(Math.max(0,Math.min(1,(luminance-80)/120))*originalAlpha);
    }
  }
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(size,0);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=6;
  const encoded=Buffer.concat([bytes.subarray(0,8),chunk("IHDR",ihdr),chunk("IDAT",zlib.deflateSync(out,{level:9})),chunk("IEND",Buffer.alloc(0))]);
  fs.writeFileSync(path.join(root,"public",file),encoded);
  process.stdout.write(`Equus notification badge: ${file} (${size}x${size})\n`);
}

exportIcon(192,"equus-icon-192.png");
exportIcon(512,"equus-icon-512.png");
exportIcon(180,"apple-touch-icon.png");
exportNotificationBadge(96,"equus-badge-96.png");
