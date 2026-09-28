import {setupStudio,renderStudio} from '/studio.js';
const $=id=>document.getElementById(id);
let mode='gpt-sovits',state={voices:[],jobs:[],engines:{}},source=null,reference=null,sourceUrl,toastTimer,lastVoiceOptions='',submitting=false;
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,7000);}
async function api(url,options){const r=await fetch(url,options);const data=await r.json();if(!r.ok)throw Error(data.error||'操作失败');return data;}
function post(url,body){return api(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});}
function upload(file){if(!file)throw Error('请选择文件');return api(`/api/upload?name=${encodeURIComponent(file.name)}`,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file});}
function element(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;}
const advanced=document.querySelector('#tts-options details');
advanced.querySelector('summary').textContent='高级设置';
const referenceFields=element('div');referenceFields.id='reference-fields';
document.querySelector('label[for="prompt"]').textContent='参考录音原文（可留空）';
$('prompt').placeholder='留空即可生成；填写时应与参考录音一致';
referenceFields.append($('reference-audio').closest('.field'),$('prompt').closest('.field'),$('reference-language').closest('.field'));
const referenceToggle=element('label','muted');const customReference=element('input');customReference.type='checkbox';customReference.id='custom-reference';
referenceToggle.append(customReference,document.createTextNode(' 自定义参考声音'));
advanced.append(referenceToggle,referenceFields);
const saveReference=element('button','inline-link','保存为这个音色的默认参考');saveReference.type='button';referenceFields.append(saveReference);
const referenceNote=element('p','muted');$('tts-options').prepend(referenceNote);
let selectedVoice='';
function updateReference(){
 const v=state.voices.find(v=>v.id===$('voice').value);
 if(selectedVoice!==v?.id){selectedVoice=v?.id;reference=null;$('reference-audio').value='';$('reference-name').textContent='选择 3–10 秒清晰人声';$('prompt').value='';customReference.checked=false;advanced.open=!v?.hasDefaultReference;}
 referenceNote.textContent=v?.hasDefaultReference?'已配好声音，输入台词即可生成。':'请在高级设置中配置参考声音；导入的音色只需保存一次。';
 referenceToggle.hidden=!v?.hasDefaultReference;referenceFields.hidden=!!v?.hasDefaultReference&&!customReference.checked;saveReference.hidden=!!v?.builtin;
}
customReference.onchange=updateReference;$('voice').onchange=()=>{localStorage.setItem('voice-workshop-voice',$('voice').value);updateReference();};
saveReference.onclick=async()=>{saveReference.disabled=true;try{if(!reference)throw Error('请选择参考录音');await post('/api/voice-reference',{voiceId:$('voice').value,reference:(await upload(reference)).id,prompt:$('prompt').value,referenceLanguage:$('reference-language').value});customReference.checked=false;advanced.open=false;await refresh();toast('已保存，以后只需输入台词');}catch(e){toast(e.message);}finally{saveReference.disabled=false;}};
function render(){
 const current=$('voice').value;const list=state.voices.filter(v=>v.engine===mode);const optionsSignature=JSON.stringify([mode,list.map(v=>[v.id,v.name])]);
 if(optionsSignature!==lastVoiceOptions){lastVoiceOptions=optionsSignature;$('voice').replaceChildren();
  if(!list.length){const o=element('option','','请先导入 RVC 音色');o.value='';$('voice').append(o);}
  for(const v of list){const o=element('option','',v.name.replace(/\s*[·/]\s*GPT-SoVITS.*$/i,''));o.value=v.id;$('voice').append(o);}const preferred=[current,localStorage.getItem('voice-workshop-voice'),list.find(v=>v.hasDefaultReference)?.id].find(id=>list.some(v=>v.id===id));if(preferred)$('voice').value=preferred;
 }
 const ready=state.engines[mode]==='ready';$('engine-note').textContent=ready?'本地生成 · 文件保存在此电脑':'引擎准备中 · 下载完成并安装后可用';$('generate').disabled=submitting||!ready||!list.length;
 $('generate').firstChild.textContent=mode==='rvc'?'转换声音 ':'生成配音 ';
 $('voice-list').replaceChildren();for(const v of state.voices){const row=element('div','voice-row');row.append(element('span','',v.name),element('span','',v.engine==='rvc'?'RVC / 换声':`${v.version} / 配音`));$('voice-list').append(row);}
 updateReference();
 renderStudio(state);
}
async function refresh(){try{state=await api('/api/state');render();}catch(e){$('engine-note').textContent='工作空间连接中断，请检查启动窗口';}}
function setMode(next){mode=next;$('mode-tts').setAttribute('aria-selected',next==='gpt-sovits');$('mode-rvc').setAttribute('aria-selected',next==='rvc');$('text-editor').hidden=next==='rvc';$('audio-editor').hidden=next!=='rvc';$('tts-options').hidden=next==='rvc';$('rvc-options').hidden=next!=='rvc';render();}
$('mode-tts').onclick=()=>setMode('gpt-sovits');$('mode-rvc').onclick=()=>setMode('rvc');
for(const id of ['mode-tts','mode-rvc'])$(id).onkeydown=e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();const next=mode==='rvc'?'gpt-sovits':'rvc';setMode(next);$(next==='rvc'?'mode-rvc':'mode-tts').focus();}};
for(const label of document.querySelectorAll('label.file-line,label.drop-zone')){label.tabIndex=0;label.setAttribute('role','button');label.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$(label.htmlFor).click();}};}
$('script').value=localStorage.getItem('voice-workshop-draft')||'';
function draft(){$('char-count').textContent=`${$('script').value.length} / 5000`;localStorage.setItem('voice-workshop-draft',$('script').value);}$('script').oninput=draft;draft();
$('speed').oninput=()=> $('speed-value').textContent=Number($('speed').value).toFixed(1)+'×';$('pitch').oninput=()=> $('pitch-value').textContent=Number($('pitch').value)>0?'+'+$('pitch').value:$('pitch').value;
function selectSource(file){if(!file)return;source=file;$('source-name').textContent=file.name;if(sourceUrl)URL.revokeObjectURL(sourceUrl);sourceUrl=URL.createObjectURL(file);$('source-preview').src=sourceUrl;$('source-preview').hidden=false;}
$('source-audio').onchange=e=>selectSource(e.target.files[0]);const drop=document.querySelector('.drop-zone');drop.ondragover=e=>{e.preventDefault();drop.classList.add('dragging');};drop.ondragleave=()=>drop.classList.remove('dragging');drop.ondrop=e=>{e.preventDefault();drop.classList.remove('dragging');selectSource(e.dataTransfer.files[0]);};
$('reference-audio').onchange=e=>{reference=e.target.files[0];$('reference-name').textContent=reference?.name||'选择 3–10 秒清晰人声';};
$('generate').onclick=async()=>{const b=$('generate');submitting=true;b.disabled=true;try{const payload={voiceId:$('voice').value};if(mode==='rvc'){if(!source)throw Error('先放入一段录音');toast('正在准备录音…');payload.input=(await upload(source)).id;payload.pitch=Number($('pitch').value);}else{if(!$('script').value.trim())throw Error('先写下要配音的台词');Object.assign(payload,{text:$('script').value,language:$('language').value,speed:Number($('speed').value)});const v=state.voices.find(v=>v.id===payload.voiceId);if(!v?.hasDefaultReference||customReference.checked){if(!reference)throw Error('请选择参考音频');Object.assign(payload,{prompt:$('prompt').value,referenceLanguage:$('reference-language').value,reference:(await upload(reference)).id});}}await post('/api/jobs',payload);toast('已加入生成队列');await refresh();}catch(e){toast(e.message);}finally{submitting=false;render();}};
function openLibrary(){$('library').showModal();}$('library-open').onclick=openLibrary;$('library-close').onclick=()=>$('library').close();$('import-shortcut').onclick=()=>{$('import-engine').value=mode;importType();openLibrary();};
function importType(){const r=$('import-engine').value==='rvc';$('gpt-file-field').hidden=r;$('import-gpt').required=!r;$('index-file-field').hidden=!r;$('version-field').hidden=r;}$('import-engine').onchange=importType;
$('import-form').onsubmit=async e=>{e.preventDefault();const b=$('import-submit');b.disabled=true;try{toast('正在导入音色文件，请稍候…');const engine=$('import-engine').value,payload={engine,name:$('import-name').value,version:$('import-version').value,weights:(await upload($('import-weights').files[0])).id};if(engine==='gpt-sovits')payload.gpt=(await upload($('import-gpt').files[0])).id;else if($('import-index').files[0])payload.index=(await upload($('import-index').files[0])).id;const result=await post('/api/voices',payload);e.target.reset();importType();await refresh();setMode(engine);$('voice').value=result.id;$('library').close();toast('音色已加入，生成时将校验模型兼容性');}catch(e){toast(e.message);}finally{b.disabled=false;}};
setupStudio({api,refresh,toast});
await refresh();setInterval(refresh,5000);
