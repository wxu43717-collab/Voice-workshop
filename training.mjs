import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {finished} from 'node:stream/promises';

export function validateTraining(body,resolveAudio){
 if(typeof body.name!=='string'||!body.name.trim()||body.name.trim().length>60)throw Error('请填写 1–60 字音色名称');
 if(!['zh','en','ja','ko'].includes(body.language))throw Error('请选择录音语言');
 if(!Array.isArray(body.inputs)||!body.inputs.length||body.inputs.length>20)throw Error('请选择 1–20 个音频文件');
 if(new Set(body.inputs).size!==body.inputs.length)throw Error('请勿重复提交相同的音频');
 const inputs=body.inputs.map(resolveAudio);
 if(inputs.reduce((n,p)=>n+fs.statSync(p).size,0)>600*1024**2)throw Error('录音文件总大小不能超过 600MB');
 return {name:body.name.trim(),language:body.language,inputs:body.inputs};
}

export function createTrainingController({root,jobs,config,inside,uploaded,audioExt,saveJob,spawnProcess=spawn}){
 let active;
 const workFor=id=>inside(root,'data/training/'+id);
 function stop(){
  const child=active?.child;if(!child?.pid)return;
  if(process.platform==='win32'){
   const killer=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true});
   killer.on('error',()=>child.kill());
  }else child.kill('SIGTERM');
 }
 return {
  readiness(){
   const c=config()['gpt-sovits'];if(!c)return {ready:false,error:'未安装 GPT-SoVITS'};
   const engine=inside(root,c.root),base=path.join(engine,'GPT_SoVITS/pretrained_models');
   const required=[inside(root,c.python),path.join(root,'scripts/training-entry.py'),path.join(engine,'runtime/ffmpeg.exe'),
    ...['s2G2333k.pth','s2D2333k.pth','s1bert25hz-5kh-longer-epoch=12-step=369668.ckpt'].map(f=>path.join(base,'gsv-v2final-pretrained',f)),
    path.join(base,'chinese-roberta-wwm-ext-large/pytorch_model.bin'),path.join(base,'chinese-hubert-base/pytorch_model.bin')];
   const missing=required.find(p=>!fs.existsSync(p));if(missing)return {ready:false,error:'缺少训练文件：'+path.basename(missing)};
   const snapshots=path.join(root,'tools/asr-cache/models--Systran--faster-whisper-small/snapshots');
   if(!fs.existsSync(snapshots)||!fs.readdirSync(snapshots).some(d=>fs.existsSync(path.join(snapshots,d,'model.bin'))))return {ready:false,error:'缺少离线转写模型 Whisper small'};
   return {ready:true};
  },
  cancel(job){
   if(job.kind!=='training'||!['queued','running','cancelling'].includes(job.status))throw Error('这个训练任务已经结束');
   if(job.status==='queued'){job.status='cancelled';job.stage='cancelled';job.message='已取消';job.finishedAt=new Date().toISOString();}
   else{job.status='cancelling';job.message='正在停止训练并释放显卡';if(active?.job===job)stop();}
   saveJob(job);
  },
  stop,
  async run(job){
   const c=config()['gpt-sovits'],work=workFor(job.id);
   if(!c)throw Error('未安装 GPT-SoVITS 引擎');
   fs.mkdirSync(work,{recursive:true});
   const payload={root,engineRoot:inside(root,c.root),work,language:job.request.language,
    inputs:job.request.inputs.map(id=>uploaded(id,audioExt))};
   const requestFile=path.join(work,'request.json');fs.writeFileSync(requestFile,JSON.stringify(payload));
   const log=fs.createWriteStream(path.join(root,'data/logs',job.id+'.log'));
   const logFinished=finished(log);logFinished.catch(()=>{});
   log.on('error',()=>{if(active?.job===job)stop();});
   let failure='训练没有完成，请查看日志',timedOut=false;
   try{
    await new Promise((resolve,reject)=>{
     const child=spawnProcess(inside(root,c.python),['-X','utf8','-u',path.join(root,'scripts/training-worker.py'),requestFile],
      {cwd:root,windowsHide:true,env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',PYTHONUNBUFFERED:'1'}});
     active={job,child};
     child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
     const lines=createInterface({input:child.stdout});
     lines.on('line',line=>{if(!line.startsWith('@TRAIN '))return;try{const e=JSON.parse(line.slice(7));
      if(e.stage==='error')failure=e.message;
      if(job.status!=='cancelling'){job.stage=e.stage;job.message=e.message;if(Number.isFinite(e.clips))job.clips=e.clips;if(Number.isFinite(e.seconds))job.seconds=e.seconds;saveJob(job);}
     }catch{}});
     const timer=setTimeout(()=>{timedOut=true;stop();},4*60*60*1000);
     child.once('error',e=>{clearTimeout(timer);reject(e);});
     child.once('close',code=>{clearTimeout(timer);lines.close();active=undefined;
      if(job.status==='cancelling'){job.status='cancelled';job.message='已取消，原始录音保留';reject(Error('训练已取消'));}
      else if(timedOut)reject(Error('训练超过 4 小时，已停止；请缩短素材后重试'));
      else code===0?resolve():reject(Error(failure));
     });
    });
   }finally{log.end();await logFinished;}
   const result=path.join(work,'result');
   for(const file of ['voice.pth','voice.ckpt','reference.wav'])if(!fs.existsSync(path.join(result,file))||fs.statSync(path.join(result,file)).size<44)throw Error('训练输出不完整，未加入音色库');
   if(!fs.existsSync(path.join(work,'voice.zip')))throw Error('训练未生成导出包');
   const dir=inside(root,'models/gpt-sovits/'+job.id);fs.mkdirSync(dir,{recursive:true});
   for(const file of ['voice.pth','voice.ckpt','reference.wav'])fs.copyFileSync(path.join(result,file),path.join(dir,file));
   const voice={id:job.id,name:job.voiceName,engine:'gpt-sovits',version:'v2',createdAt:new Date().toISOString(),
    weights:path.relative(root,path.join(dir,'voice.pth')),gpt:path.relative(root,path.join(dir,'voice.ckpt')),
    defaultReference:{audio:path.relative(root,path.join(dir,'reference.wav')),prompt:'',language:job.request.language}};
   fs.writeFileSync(path.join(dir,'voice.json.tmp'),JSON.stringify(voice,null,2));fs.renameSync(path.join(dir,'voice.json.tmp'),path.join(dir,'voice.json'));
   job.voiceId=voice.id;job.status='done';job.stage='done';job.message='音色已加入音色库，可以下载权重或前往配音';
  },
  download(job,kind){
   if(job.kind!=='training'||job.status!=='done')throw Error('训练完成后才能下载');
   const files={zip:'voice.zip',pth:'result/voice.pth',ckpt:'result/voice.ckpt'};
   if(!files[kind])throw Error('下载类型无效');
   return path.join(workFor(job.id),files[kind]);
  }
 };
}

