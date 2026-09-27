import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
for(const [id,name] of [['gpt-sovits','GPT-SoVITS-v2pro-20250604-nvidia50.7z'],['rvc','RVC20260718Nvidia50x0.7z']]){
 const file=path.join(root,'downloads',name),dir=file+'.parts';
 const total=JSON.parse(fs.readFileSync(path.join(root,'downloads',id+'-repository.json'))).find(x=>x.path===name).size;
 let bytes=0;
 if(fs.existsSync(file+'.verified.json'))bytes=total;
 else if(fs.existsSync(dir))bytes=fs.readdirSync(dir).filter(x=>x==='prefix'||/^part-\d+(\.tail)?$/.test(x)).reduce((s,x)=>{try{return s+fs.statSync(path.join(dir,x)).size;}catch{return s;}},0);
 console.log(`${id}: ${(100*bytes/total).toFixed(1)}%, ${(bytes/1e9).toFixed(2)} / ${(total/1e9).toFixed(2)} GB, verified=${fs.existsSync(file+'.verified.json')}`);
}
