import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const specs=[['gpt-sovits','GPT-SoVITS-v2pro-20250604-nvidia50.7z','api_v2.py'],['rvc','RVC20260718Nvidia50x0.7z','webui.py']];
function run(cmd,args,options={}){return new Promise((resolve,reject)=>{const p=spawn(cmd,args,{windowsHide:true,stdio:'inherit',...options});p.on('error',reject);p.on('exit',c=>c===0?resolve():reject(Error(`${cmd}: exit ${c}`)));});}
function locate(dir,marker,depth=0){if(fs.existsSync(path.join(dir,marker)))return dir;if(depth>=3)return null;for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(e.isDirectory()){const found=locate(path.join(dir,e.name),marker,depth+1);if(found)return found;}}return null;}
const cfg=fs.existsSync(path.join(root,'config.local.json'))?JSON.parse(fs.readFileSync(path.join(root,'config.local.json'))):{};
const selected=process.argv.find(x=>x.startsWith('--engine='))?.split('=')[1];
if(selected&&!specs.some(([id])=>id===selected))throw Error('Unknown engine');
for(const [id,name,marker] of specs.filter(([id])=>!selected||selected===id)){
 const archive=path.join(root,'downloads',name),verified=archive+'.verified.json';
 if(!fs.existsSync(verified))throw Error(`${name} is not verified. Run download-engines.mjs first.`);
 const dest=path.join(root,'engines',id);fs.mkdirSync(dest,{recursive:true});
 if(!fs.existsSync(path.join(dest,'.extracted'))){await run(path.join(root,'tools/7zr.exe'),['x',archive,`-o${dest}`,'-y','-bsp0','-bso0']);fs.writeFileSync(path.join(dest,'.extracted'),name);}
 const engineRoot=locate(dest,marker);if(!engineRoot)throw Error(`${id}: entry point missing`);
 const python=path.join(engineRoot,'runtime','python.exe');if(!fs.existsSync(python))throw Error(`${id}: bundled Python missing`);
 await run(python,['-c','import torch; print("PyTorch", torch.__version__); assert torch.cuda.is_available(), "CUDA unavailable"; print(torch.cuda.get_device_name(0)); x=torch.randn(256,256,device="cuda"); print("CUDA matrix test",float((x@x).mean()))'],{cwd:engineRoot,env:{...process.env,PYTHONIOENCODING:'utf-8'}});
 cfg[id]={root:path.relative(root,engineRoot),python:path.relative(root,python),archive:name,installedAt:new Date().toISOString()};
 fs.writeFileSync(path.join(root,'config.local.json'),JSON.stringify(cfg,null,2));console.log(`${id}: installed and CUDA verified`);
}
