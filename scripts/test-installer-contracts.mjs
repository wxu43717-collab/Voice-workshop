import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const work=fs.mkdtempSync(path.join(root,'dist/contracts-'));
const release=path.join(root,'dist/release');
const compiler=path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
const exe=path.join(release,'InstallerContracts.exe');
function run(command,args){return new Promise((resolve,reject)=>{const child=spawn(command,args,{stdio:'inherit',windowsHide:true});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error(`Exit ${code}`)));});}
await run(compiler,['/nologo','/target:exe','/reference:System.IO.Compression.dll','/reference:System.IO.Compression.FileSystem.dll','/reference:'+path.join(release,'VoiceWorkshop-Setup.exe'),'/out:'+exe,path.join(root,'installer/ContractTests.cs')]);
const payload=Buffer.alloc(1024*1024);for(let i=0;i<payload.length;i++)payload[i]=i%251;
fs.writeFileSync(path.join(work,'payload.bin'),payload);let resumed=false;
const server=http.createServer((req,res)=>{
 const offset=Number(/^bytes=(\d+)-$/.exec(req.headers.range||'')?.[1]||0);
 if(offset){resumed=true;res.setHeader('Content-Range',`bytes ${offset}-${payload.length-1}/${payload.length}`);}
 res.writeHead(offset?206:200,{'Content-Length':payload.length-offset});res.end(payload.subarray(offset));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try{await run(exe,[work,`http://127.0.0.1:${server.address().port}/`]);if(!resumed)throw Error('HTTP range was not exercised');}
finally{server.close();fs.unlinkSync(exe);}
