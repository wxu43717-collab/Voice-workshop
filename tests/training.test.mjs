import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {spawn} from 'node:child_process';
import {createTrainingController,validateTraining} from '../training.mjs';

test('audio-only training accepts no text and rejects invalid inputs',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'voice-training-validation-'));
 try{
  const audio=path.join(dir,'voice.wav');fs.writeFileSync(audio,Buffer.alloc(44));
  const resolve=id=>{assert.equal(id,'audio');return audio;};
  assert.deepEqual(validateTraining({name:' My voice ',language:'zh',inputs:['audio']},resolve),{name:'My voice',language:'zh',inputs:['audio']});
  for(const data of [{name:'',language:'zh',inputs:['audio']},{name:'a',language:'bad',inputs:['audio']},{name:'a',language:'zh',inputs:[]},{name:'a',language:'zh',inputs:['audio','audio']}])assert.throws(()=>validateTraining(data,resolve));
 }finally{fs.rmSync(dir,{recursive:true});}
});
test('queued training can cancel without starting a worker',()=>{
 const job={id:'sample',kind:'training',status:'queued'};let saved=0;
 const controller=createTrainingController({root:'unused',jobs:[job],saveJob:()=>saved++});
 controller.cancel(job);assert.equal(job.status,'cancelled');assert.equal(saved,1);assert.throws(()=>controller.cancel(job));
});
test('Windows cancellation terminates the worker and its child process',{skip:process.platform!=='win32',timeout:15000},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'voice-training-tree-'));let worker,descendant;
 try{
  fs.mkdirSync(path.join(root,'data/logs'),{recursive:true});
  const job={id:'tree',kind:'training',status:'running',request:{language:'zh',inputs:[]}};
  let identify;const identified=new Promise(resolve=>identify=resolve);
  const controller=createTrainingController({root,jobs:[job],inside:(base,p)=>path.join(base,p),config:()=>({'gpt-sovits':{root:'engine',python:'engine/python.exe'}}),uploaded:()=>'',audioExt:[],saveJob:()=>{},spawnProcess:()=>{
   worker=spawn(process.execPath,['-e',"const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});console.log(c.pid);setInterval(()=>{},1000)"],{windowsHide:true});
   worker.stdout.once('data',b=>{descendant=Number(b.toString().trim());identify();});return worker;
  }});
  const running=controller.run(job);await identified;assert.ok(descendant>0);
  const stopped=assert.rejects(running,/已取消/);controller.cancel(job);await stopped;
  assert.equal(job.status,'cancelled');assert.throws(()=>process.kill(descendant,0));descendant=undefined;
 }finally{worker?.kill();if(descendant){try{process.kill(descendant);}catch{}}fs.rmSync(root,{recursive:true});}
});
test('a worker exit without exported weights never publishes a voice',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'voice-training-incomplete-'));
 try{
  fs.mkdirSync(path.join(root,'data/logs'),{recursive:true});
  const job={id:'incomplete',kind:'training',status:'running',request:{language:'zh',inputs:[]}};
  const controller=createTrainingController({root,jobs:[job],inside:(base,p)=>path.join(base,p),config:()=>({'gpt-sovits':{root:'engine',python:'engine/python.exe'}}),uploaded:()=>'',audioExt:[],saveJob:()=>{},spawnProcess:()=>{const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();setImmediate(()=>{child.stdout.end();child.stderr.end();child.emit('close',0);});return child;}});
  await assert.rejects(controller.run(job),/输出不完整/);assert.equal(fs.existsSync(path.join(root,'models/gpt-sovits/incomplete/voice.json')),false);
 }finally{fs.rmSync(root,{recursive:true});}
});
test('running cancellation stays pending until worker exits and never publishes',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'voice-training-cancel-'));
 try{
  fs.mkdirSync(path.join(root,'data/logs'),{recursive:true});
  const job={id:'cancelled',kind:'training',status:'running',request:{language:'zh',inputs:[]}};
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();
  const controller=createTrainingController({root,jobs:[job],inside:(base,p)=>path.join(base,p),config:()=>({'gpt-sovits':{root:'engine',python:'engine/python.exe'}}),uploaded:()=>'',audioExt:[],saveJob:()=>{},spawnProcess:()=>child});
  const running=controller.run(job);controller.cancel(job);assert.equal(job.status,'cancelling');
  child.stdout.end();child.stderr.end();child.emit('close',1);await assert.rejects(running,/已取消/);
  assert.equal(job.status,'cancelled');assert.equal(fs.existsSync(path.join(root,'models/gpt-sovits/cancelled/voice.json')),false);
 }finally{fs.rmSync(root,{recursive:true});}
});
test('only complete paired output publishes a voice; downloads stay scoped',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'voice-training-controller-'));
 try{
  fs.mkdirSync(path.join(root,'data/logs'),{recursive:true});
  const inside=(base,relative)=>{const p=path.resolve(base,relative);assert.ok(p.startsWith(path.resolve(base)+path.sep));return p;};
  const job={id:'sample',kind:'training',status:'running',voiceName:'Test voice',request:{language:'zh',inputs:['audio.wav']}};
  const work=path.join(root,'data/training/sample');
  const controller=createTrainingController({root,jobs:[job],inside,config:()=>({'gpt-sovits':{root:'engine',python:'engine/python.exe'}}),uploaded:()=>path.join(root,'audio.wav'),audioExt:['.wav'],saveJob:()=>{},
   spawnProcess:()=>{const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();
    setImmediate(()=>{fs.mkdirSync(path.join(work,'result'),{recursive:true});for(const file of ['voice.pth','voice.ckpt','reference.wav'])fs.writeFileSync(path.join(work,'result',file),Buffer.alloc(64));fs.writeFileSync(path.join(work,'voice.zip'),'fixture');
     child.stdout.end('@TRAIN {"stage":"export","message":"Exporting","clips":6}\n');child.stderr.end();setImmediate(()=>child.emit('close',0));});return child;}});
  await controller.run(job);assert.equal(job.status,'done');assert.equal(job.voiceId,'sample');
  const voice=JSON.parse(fs.readFileSync(path.join(root,'models/gpt-sovits/sample/voice.json')));
  assert.equal(voice.version,'v2');assert.equal(voice.defaultReference.prompt,'');assert.ok(voice.gpt.endsWith('voice.ckpt'));
  assert.equal(controller.download(job,'pth'),path.join(work,'result/voice.pth'));assert.throws(()=>controller.download(job,'../config'));assert.throws(()=>controller.download({...job,status:'failed'},'zip'));
 }finally{fs.rmSync(root,{recursive:true});}
});

