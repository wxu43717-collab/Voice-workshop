import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';

export const root=path.dirname(fileURLToPath(import.meta.url));
for(const d of ['data/uploads','data/outputs','data/jobs','data/logs','models/rvc','models/gpt-sovits'])fs.mkdirSync(path.join(root,d),{recursive:true});
const read=(p,fallback)=>{try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch{return fallback;}};
const write=(p,v)=>{fs.writeFileSync(p+'.tmp',JSON.stringify(v,null,2));fs.renameSync(p+'.tmp',p);};
export function inside(base,relative){const resolved=path.resolve(base,relative);if(!resolved.startsWith(path.resolve(base)+path.sep))throw Error('文件路径无效');return resolved;}
function config(){return read(path.join(root,'config.local.json'),{});}
function engineState(id){const c=config()[id];return c&&fs.existsSync(path.resolve(root,c.python))&&fs.existsSync(path.resolve(root,c.root))?'ready':'missing';}
function voices(){const list=[{id:'reference',name:'参考音频克隆',engine:'gpt-sovits',version:'v2Pro',builtin:true}];for(const engine of ['rvc','gpt-sovits'])for(const d of fs.readdirSync(path.join(root,'models',engine),{withFileTypes:true})){if(d.isDirectory()){const v=read(path.join(root,'models',engine,d.name,'voice.json'),null);if(v)list.push(v);}}return list;}
const jobs=fs.readdirSync(path.join(root,'data/jobs')).filter(x=>x.endsWith('.json')).map(x=>read(path.join(root,'data/jobs',x),null)).filter(Boolean).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
function saveJob(j){write(path.join(root,'data/jobs',j.id+'.json'),j);}
function publicJob(j){const {request,...rest}=j;return rest;}
function uploaded(id,allowed){if(!/^[0-9a-f-]{36}\.[a-z0-9]+$/.test(id||''))throw Error('请先选择文件');const p=inside(path.join(root,'data/uploads'),id);if(!allowed.includes(path.extname(p).toLowerCase())||!fs.existsSync(p))throw Error('文件类型不匹配或文件不存在');return p;}
const audioExt=['.wav','.mp3','.flac','.m4a','.ogg','.webm'];
export function resolveReference(v,b){
 if(b.reference)return {reference:uploaded(b.reference,audioExt),prompt:b.prompt||'',referenceLanguage:b.referenceLanguage};
 const d=v.defaultReference;
 if(!d?.audio)throw Error('这个音色还没有默认参考，请在高级设置中配置一次');
 const reference=inside(root,d.audio);
 if(!audioExt.includes(path.extname(reference).toLowerCase())||!fs.existsSync(reference))throw Error('音色的默认参考文件不存在');
 return {reference,prompt:d.prompt||'',referenceLanguage:d.language||'ja'};
}
let running=false,activeChild;
async function processQueue(){
 if(running)return;const job=jobs.find(j=>j.status==='queued');if(!job)return;running=true;job.status='running';saveJob(job);
 try{
  const c=config()[job.engine];if(!c||engineState(job.engine)!=='ready')throw Error('引擎尚未安装完成');
  const v=voices().find(v=>v.id===job.request.voiceId);if(!v)throw Error('音色已不存在');
  const voice={...v};for(const k of ['weights','gpt','index'])if(voice[k])voice[k]=inside(root,voice[k]);
  const payload={...job.request,voice,engine:job.engine,engineRoot:inside(root,c.root),output:inside(root,`data/outputs/${job.id}.wav`)};
  if(job.engine==='rvc')payload.input=uploaded(job.request.input,audioExt);
  else Object.assign(payload,resolveReference(v,job.request));
  const requestFile=inside(root,`data/jobs/${job.id}.request`);write(requestFile,payload);
  const log=fs.createWriteStream(path.join(root,'data/logs',job.id+'.log'));
  try{await new Promise((resolve,reject)=>{
   const child=spawn(inside(root,c.python),[path.join(root,'scripts/engine-worker.py'),requestFile],{cwd:payload.engineRoot,windowsHide:true,env:{...process.env,PYTHONIOENCODING:'utf-8',PYTHONUTF8:'1'}});activeChild=child;
   child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
   const timeout=setTimeout(()=>{child.kill();reject(Error('任务超过 30 分钟，请缩短素材后重试'));},30*60*1000);
   child.on('error',e=>{clearTimeout(timeout);reject(e);});child.on('close',code=>{clearTimeout(timeout);code===0?resolve():reject(Error('引擎处理失败，请检查音色版本、参考文本与素材；详细原因见任务日志'));});
  });}finally{log.end();activeChild=null;}
  if(!fs.existsSync(payload.output)||fs.statSync(payload.output).size<44)throw Error('引擎没有生成有效音频');
  job.status='done';job.audio=`/outputs/${job.id}.wav`;
 }catch(e){job.status='failed';job.error=e.message;}
 job.finishedAt=new Date().toISOString();saveJob(job);running=false;setImmediate(processQueue);
}
async function jsonBody(req){let parts=[],size=0;for await(const b of req){size+=b.length;if(size>1024*1024)throw Error('请求过大');parts.push(b);}return JSON.parse(Buffer.concat(parts).toString());}
function send(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.wav':'audio/wav','.log':'text/plain; charset=utf-8'};
function serveFile(req,res,file){if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}const size=fs.statSync(file).size;const h={'Content-Type':types[path.extname(file)]||'application/octet-stream','Accept-Ranges':'bytes','Cache-Control':'no-store'};let start=0,end=size-1,status=200;if(req.headers.range){const m=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);if(!m||+m[1]>=size){res.writeHead(416);res.end();return;}start=+m[1];end=m[2]?Math.min(+m[2],size-1):end;if(end<start){res.writeHead(416);res.end();return;}status=206;h['Content-Range']=`bytes ${start}-${end}/${size}`;}h['Content-Length']=end-start+1;res.writeHead(status,h);fs.createReadStream(file,{start,end}).pipe(res);}
export const server=http.createServer(async(req,res)=>{
 try{
  const host=req.headers.host||'';if(!/^127\.0\.0\.1:\d+$/.test(host)&&!/^localhost:\d+$/.test(host)){send(res,403,{error:'仅支持本机访问'});return;}
  if(req.headers.origin&& ![`http://${host}`].includes(req.headers.origin)){send(res,403,{error:'来源不匹配'});return;}
  const url=new URL(req.url,`http://${host}`),p=url.pathname;
  if(req.method==='GET'&&p==='/api/state'){send(res,200,{engines:{rvc:engineState('rvc'),'gpt-sovits':engineState('gpt-sovits')},voices:voices().map(({weights,gpt,index,defaultReference,...v})=>({...v,hasDefaultReference:!!defaultReference?.audio})),jobs:jobs.map(publicJob).reverse()});return;}
  if(req.method==='POST'&&p==='/api/upload'){
   const name=url.searchParams.get('name')||'',ext=path.extname(name).toLowerCase();
   if(![...audioExt,'.pth','.ckpt','.index'].includes(ext))throw Error('请选择音频或音色模型文件');
   const id=randomUUID()+ext,dest=path.join(root,'data/uploads',id);let size=0;
   try{await pipeline(req,new Transform({transform(b,enc,cb){size+=b.length;cb(size>2*1024**3?Error('单文件不能超过 2GB'):null,b);}}),fs.createWriteStream(dest,{flags:'wx'}));if(size===0)throw Error('文件为空');}catch(e){if(fs.existsSync(dest))fs.unlinkSync(dest);throw e;}
   send(res,200,{id,name,bytes:size});return;
  }
  if(req.method==='POST'&&p==='/api/voices'){
   const b=await jsonBody(req);if(!['rvc','gpt-sovits'].includes(b.engine))throw Error('音色类型无效');if(!b.name?.trim()||b.name.length>80)throw Error('请输入 1–80 字音色名称');
   const files={weights:uploaded(b.weights,['.pth'])};if(b.engine==='rvc'&&b.index)files.index=uploaded(b.index,['.index']);
   if(b.engine==='gpt-sovits'){files.gpt=uploaded(b.gpt,['.ckpt']);if(!['v1','v2','v2Pro','v2ProPlus'].includes(b.version))throw Error('当前支持 v1、v2、v2Pro、v2ProPlus 完整权重');}
   const id=randomUUID(),dir=path.join(root,'models',b.engine,id);fs.mkdirSync(dir);const v={id,name:b.name.trim(),engine:b.engine,version:b.engine==='rvc'?'RVC':b.version,createdAt:new Date().toISOString()};
   for(const [k,src] of Object.entries(files)){const dest=path.join(dir,k+path.extname(src));fs.copyFileSync(src,dest);v[k]=path.relative(root,dest);}
   write(path.join(dir,'voice.json'),v);send(res,201,{id});return;
  }
  if(req.method==='POST'&&p==='/api/voice-reference'){
   const b=await jsonBody(req),v=voices().find(v=>v.id===b.voiceId&&!v.builtin&&v.engine==='gpt-sovits');
   if(!v)throw Error('请选择已导入的文字配音音色');
   const source=uploaded(b.reference,audioExt);
   if(typeof b.prompt!=='string'||b.prompt.length>5000)throw Error('参考原文格式无效');
   if(!['zh','en','ja','ko','yue'].includes(b.referenceLanguage))throw Error('参考语言无效');
   const dir=path.dirname(inside(root,v.weights)),dest=path.join(dir,'default-reference'+path.extname(source));
   fs.copyFileSync(source,dest);v.defaultReference={audio:path.relative(root,dest),prompt:b.prompt.trim(),language:b.referenceLanguage};
   write(path.join(dir,'voice.json'),v);send(res,200,{ok:true});return;
  }
  if(req.method==='POST'&&p==='/api/jobs'){
   const b=await jsonBody(req),v=voices().find(v=>v.id===b.voiceId);if(!v)throw Error('请先选择音色');
   if(engineState(v.engine)!=='ready')throw Error('引擎仍在安装，完成后即可生成');
   if(jobs.filter(j=>['queued','running'].includes(j.status)).length>=20)throw Error('任务较多，请稍后再试');
   if(v.engine==='rvc'){uploaded(b.input,audioExt);if(!Number.isInteger(b.pitch)||b.pitch < -12||b.pitch>12)throw Error('音高应为 -12 到 12 的整数');}
   else{if(typeof b.text!=='string'||!b.text.trim()||b.text.length>5000)throw Error('请输入 1–5000 字台词');const ref=resolveReference(v,b);if(typeof ref.prompt!=='string')throw Error('参考原文格式无效');if(!['zh','en','ja','ko','yue'].includes(b.language)||!['zh','en','ja','ko','yue'].includes(ref.referenceLanguage))throw Error('语言无效');if(!Number.isFinite(b.speed)||b.speed<0.5||b.speed>2)throw Error('语速应为 0.5–2');}
   const j={id:randomUUID(),engine:v.engine,voiceName:v.name,title:v.engine==='rvc'?'录音换声':b.text.slice(0,42),status:'queued',createdAt:new Date().toISOString(),request:b};jobs.push(j);saveJob(j);send(res,202,publicJob(j));setImmediate(processQueue);return;
  }
  if(req.method==='GET'&&/^\/outputs\/[\w-]+\.wav$/.test(p)){serveFile(req,res,inside(path.join(root,'data/outputs'),path.basename(p)));return;}
  if(req.method==='GET'&&/^\/logs\/[\w-]+\.log$/.test(p)){serveFile(req,res,inside(path.join(root,'data/logs'),path.basename(p)));return;}
  if(req.method==='GET'&&['/','/app.js','/style.css'].includes(p)){serveFile(req,res,path.join(root,'web',p==='/'?'index.html':p.slice(1)));return;}
  send(res,404,{error:'未找到页面'});
 }catch(e){if(!res.headersSent)send(res,400,{error:e.message});else res.end();}
});
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 for(const j of jobs)if(['queued','running'].includes(j.status)){j.status='failed';j.error='服务已重启，请重新生成';saveJob(j);}
 const port=Number(process.env.PORT||3270);server.listen(port,'127.0.0.1',()=>{console.log(`Voice Workshop: http://127.0.0.1:${port}`);if(process.argv.includes('--open')&&process.platform==='win32')spawn('cmd.exe',['/c','start','',`http://127.0.0.1:${port}`],{windowsHide:true});});
 server.on('error',e=>{console.error(e.code==='EADDRINUSE'?`端口 ${port} 已使用。工作台可能已启动，请打开 http://127.0.0.1:${port}`:e.message);process.exitCode=1;});
 for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{activeChild?.kill();server.close();process.exit(0);});
}
