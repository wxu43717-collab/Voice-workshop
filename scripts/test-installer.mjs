// Local integration harness: serve exact release bytes with range support.
// The test install never creates a desktop shortcut or launches a browser.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const release=path.join(root,'dist/release'),target=path.join(root,'dist/installer-smoke');
fs.mkdirSync(target,{recursive:true});
const allowed=new Set(fs.readdirSync(release));
const server=http.createServer((req,res)=>{
 const name=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname.slice(1));
 if(!allowed.has(name)){res.writeHead(404).end();return;}
 const file=path.join(release,name),size=fs.statSync(file).size;
 let start=0;
 if(req.headers.range){const match=/^bytes=(\d+)-$/.exec(req.headers.range);if(!match||Number(match[1])>=size){res.writeHead(416).end();return;}start=Number(match[1]);res.setHeader('Content-Range',`bytes ${start}-${size-1}/${size}`);}
 res.writeHead(start?206:200,{'Content-Length':size-start,'Accept-Ranges':'bytes'});
 fs.createReadStream(file,{start}).pipe(res);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
console.log('Fresh installer integration test:',target);
try{
 const child=spawn(path.join(release,'VoiceWorkshop-Setup.exe'),['--test-install',target,`http://127.0.0.1:${server.address().port}/`],{windowsHide:true});
 const timer=setInterval(()=>{const log=path.join(target,'test-progress.log');if(fs.existsSync(log))console.log(fs.readFileSync(log,'utf8').trim().split(/\r?\n/).at(-1));},15000);
 try{const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});if(code!==0)throw Error(fs.readFileSync(path.join(target,'test-error.log'),'utf8'));}finally{clearInterval(timer);}
 const config=JSON.parse(fs.readFileSync(path.join(target,'config.local.json')));
 for(const engine of ['gpt-sovits','rvc'])if(!fs.existsSync(path.join(target,config[engine].python)))throw Error('Missing '+engine);
 if(!fs.existsSync(path.join(target,'installed-version.json')))throw Error('Missing completion marker');
 console.log('PASS: fresh download, hashes, extraction, GPU checks, config, training dependencies.');
}finally{server.close();}
