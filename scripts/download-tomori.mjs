import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..');
const dir=path.join(root,'models/gpt-sovits/takamatsu-tomori');
fs.mkdirSync(dir,{recursive:true});
const files=JSON.parse(fs.readFileSync(path.join(root,'downloads/tomori-files.json'))).filter(x=>x.type==='file'&&x.path.includes('高松灯'));
await Promise.all(files.map(async f=>{
 const dest=path.join(dir,path.basename(f.path));
 const url='https://huggingface.co/WLWolf56/gpt-sovits-model/resolve/main/'+f.path.split('/').map(encodeURIComponent).join('/')+'?download=true';
 if(!fs.existsSync(dest)||fs.statSync(dest).size!==f.size){
  const parts=dest+'.parts';fs.mkdirSync(parts,{recursive:true});
  const planFile=path.join(parts,'plan.json');
  let plan;
  if(fs.existsSync(planFile))plan=JSON.parse(fs.readFileSync(planFile));
  else {const prefix=fs.existsSync(dest)?fs.statSync(dest).size:0;plan={prefix,ranges:Array.from({length:4},(_,i)=>[prefix+Math.floor((f.size-prefix)*i/4),prefix+Math.floor((f.size-prefix)*(i+1)/4)-1])};if(prefix)fs.renameSync(dest,path.join(parts,'prefix'));fs.writeFileSync(planFile,JSON.stringify(plan));}
  await Promise.all(plan.ranges.map(async([start,end],i)=>{
   const part=path.join(parts,'part-'+i);
   if(fs.existsSync(part)&&fs.statSync(part).size===end-start+1)return;
   await new Promise((resolve,reject)=>{const p=spawn('curl.exe',['-sS','-L','--fail','--retry','6','--connect-timeout','20','--max-time','600','--range',`${start}-${end}`,'-o',part,url+'&segment='+i+'&t='+Date.now()],{stdio:'inherit',windowsHide:true});p.on('error',reject);p.on('close',c=>c===0?resolve():reject(Error('Download failed '+c)));});
   if(fs.statSync(part).size!==end-start+1)throw Error('Range size mismatch');
   console.log(path.basename(dest)+' segment '+i+' done');
  }));
  const fd=fs.openSync(dest,'w');try{for(const file of [plan.prefix?path.join(parts,'prefix'):null,...plan.ranges.map((_,i)=>path.join(parts,'part-'+i))].filter(Boolean)){for await(const chunk of fs.createReadStream(file))fs.writeSync(fd,chunk);}}finally{fs.closeSync(fd);}
 }
 const hash=createHash('sha256');for await(const b of fs.createReadStream(dest))hash.update(b);
 const sha=hash.digest('hex');if(sha!==f.lfs.oid)throw Error('SHA256 mismatch: '+dest);
 console.log('VERIFIED '+path.basename(dest));
}));
