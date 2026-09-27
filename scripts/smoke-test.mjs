import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const base='http://127.0.0.1:3210';
async function call(p,body){const r=await fetch(base+p,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const x=await r.json();if(!r.ok)throw Error(JSON.stringify(x));return x;}
const kind=process.argv[2]||'gpt-sovits';
const upload=await fetch(base+'/api/upload?name=reference.wav',{method:'POST',body:fs.readFileSync(path.join(root,'data/samples/reference.wav'))}).then(r=>r.json());
if(!upload.id)throw Error('Reference upload failed');
const state=await call('/api/state');
const voice=kind==='rvc'?state.voices.find(v=>v.engine==='rvc'):state.voices.find(v=>v.id==='reference');
if(!voice)throw Error('No voice imported for '+kind);
const task=kind==='rvc'?{voiceId:voice.id,input:upload.id,pitch:0}:{voiceId:voice.id,text:'This is a local voice generation test. The studio is ready for a new story.',reference:upload.id,prompt:fs.readFileSync(path.join(root,'data/samples/reference.txt'),'utf8'),language:'en',referenceLanguage:'en',speed:1};
const job=await call('/api/jobs',task);console.log(`Started ${kind}: ${job.id}`);
for(let i=0;i<300;i++){
 const current=(await call('/api/state')).jobs.find(j=>j.id===job.id);
 if(current.status==='done'){
  const response=await fetch(base+current.audio);const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')throw Error('Output is not WAV');
  console.log(JSON.stringify({id:job.id,engine:kind,status:'done',bytes:bytes.length,audio:current.audio}));process.exit(0);
 }
 if(current.status==='failed')throw Error(current.error+` — data/logs/${job.id}.log`);
 await new Promise(r=>setTimeout(r,2000));
}
throw Error('Smoke test timed out');
