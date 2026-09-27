import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const specs=[['gpt-sovits','lj1995/GPT-SoVITS-windows-package','GPT-SoVITS-v2pro-20250604-nvidia50.7z'],['rvc','lj1995/VoiceConversionWebUI','RVC20260718Nvidia50x0.7z']];
async function hash(file){const h=createHash('sha256');for await(const b of fs.createReadStream(file))h.update(b);return h.digest('hex');}
function run(args){return new Promise((resolve,reject)=>{const p=spawn('curl.exe',args,{windowsHide:true});let err='';p.stderr.on('data',b=>err+=b);p.on('error',reject);p.on('exit',c=>c===0?resolve():reject(Error(err||`curl exit ${c}`)));});}
async function download([id,repo,name]){
 const meta=JSON.parse(fs.readFileSync(path.join(root,`downloads/${id}-repository.json`))).find(x=>x.path===name);
 const file=path.join(root,'downloads',name),dir=file+'.parts';fs.mkdirSync(dir,{recursive:true});
 let planFile=path.join(dir,'plan.json'),plan;
 if(fs.existsSync(planFile))plan=JSON.parse(fs.readFileSync(planFile));else{
  const prefix=fs.existsSync(file)?fs.statSync(file).size:0;
  if(prefix===meta.size && await hash(file)===meta.lfs.oid){console.log(`${id}: already verified`);return;}
  if(prefix>0)fs.renameSync(file,path.join(dir,'prefix'));
  const chunk=Math.ceil((meta.size-prefix)/8);
  plan={prefix,ranges:Array.from({length:8},(_,i)=>({start:prefix+i*chunk,end:Math.min(meta.size-1,prefix+(i+1)*chunk-1)})).filter(x=>x.start<=x.end)};
  fs.writeFileSync(planFile,JSON.stringify(plan));
 }
 const timer=setInterval(()=>{const n=fs.readdirSync(dir).filter(x=>x==='prefix'||/^part-\d+(\.tail)?$/.test(x)).reduce((s,x)=>{try{return s+fs.statSync(path.join(dir,x)).size;}catch{return s;}},0);console.log(`${id}: ${(100*n/meta.size).toFixed(1)}% (${(n/1e9).toFixed(2)} / ${(meta.size/1e9).toFixed(2)} GB)`);},30000);
 try{
 await Promise.all(plan.ranges.map(async({start,end},i)=>{
  const part=path.join(dir,`part-${i}`),expected=end-start+1;
  if(fs.existsSync(part+'.tail')){
   const have=fs.existsSync(part)?fs.statSync(part).size:0;
   if(have+fs.statSync(part+'.tail').size>expected)throw Error('Interrupted segment is larger than expected');
   const out=fs.openSync(part,'a');try{for await(const b of fs.createReadStream(part+'.tail'))fs.writeSync(out,b);}finally{fs.closeSync(out);}
   fs.unlinkSync(part+'.tail');
  }
  if(fs.existsSync(part)&&fs.statSync(part).size===expected)return;
  for(let attempt=0;attempt<20;attempt++){
   const have=fs.existsSync(part)?fs.statSync(part).size:0;
   if(have>expected)throw Error('Range size exceeds expected size');
   if(have===expected)return;
   const tail=part+'.tail';let error;
   const source=id==='gpt-sovits'&&attempt%2===0
    ? `https://www.modelscope.cn/models/FlowerCry/gpt-sovits-7z-pacakges/resolve/master/${name}`
    : `https://huggingface.co/${repo}/resolve/main/${name}`;
   try{await run(['-L','--fail','--silent','--show-error','--connect-timeout','20','--speed-time','60','--speed-limit','1024','--max-time','14400','--range',`${start+have}-${end}`,'-o',tail,`${source}?download=true&segment=${i}&offset=${have}&t=${Date.now()}`]);}catch(e){error=e;}
   if(fs.existsSync(tail)){
    const size=fs.statSync(tail).size;if(size>expected-have)throw Error('Server ignored byte range');
    const out=fs.openSync(part,'a');try{for await(const b of fs.createReadStream(tail))fs.writeSync(out,b);}finally{fs.closeSync(out);}
    fs.unlinkSync(tail);
   }
   if(fs.existsSync(part)&&fs.statSync(part).size===expected)return;
   console.log(`${id} segment ${i}: retry ${attempt+1}, ${error?.message||'incomplete range'}`);
   if(attempt===19)throw error||Error('Incomplete byte range');
  }
 }));
 console.log(`${id}: joining and verifying SHA-256`);
 const out=fs.openSync(file,'w');try{for(const p of [...(plan.prefix?['prefix']:[]),...plan.ranges.map((_,i)=>`part-${i}`)])for await(const b of fs.createReadStream(path.join(dir,p)))fs.writeSync(out,b);}finally{fs.closeSync(out);}
 const actual=await hash(file);if(actual!==meta.lfs.oid)throw Error(`${id}: SHA-256 mismatch`);
 fs.writeFileSync(file+'.verified.json',JSON.stringify({file:name,bytes:meta.size,sha256:actual,source:`https://huggingface.co/${repo}`,verifiedAt:new Date().toISOString()},null,2));
 console.log(`${id}: VERIFIED`);
 }finally{clearInterval(timer);}
}
await Promise.all(specs.map(download));
