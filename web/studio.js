const $=id=>document.getElementById(id);
const make=(tag,cls,text)=>{const e=document.createElement(tag);e.className=cls||'';if(text!==undefined)e.textContent=text;return e;};
let hooks,currentState,selected='',trash=false,signature='',peaks=[],duration=0,decodeId=0,audioContext,lastCompleted='',initialized=false,pendingSelection;
const time=n=>{n=Math.max(0,Number(n)||0);return Math.floor(n/60)+':'+String(Math.floor(n%60)).padStart(2,'0');};
export function setupStudio(callbacks){
 hooks=callbacks;
 document.querySelector('.wordmark span').textContent='VOICE ATELIER';
 const note=make('span','header-note','A PRIVATE SPACE FOR SOUND');document.querySelector('header').insertBefore(note,$('library-open'));
 const editor=document.querySelector('.editor'),intro=document.querySelector('.intro');
 editor.prepend(intro);editor.prepend(make('p','section-index','01 / SCRIPT'));
 intro.querySelector('h1').innerHTML='<span>让文字，</span><span>有声有色<span class="period">。</span></span>';
 intro.append(make('span','vertical-note','WORDS BECOME SOUND'));
 $('script').placeholder='从一句话开始。\n让你想说的声音，被真正听见。';
 document.querySelector('.editor-bottom>span').textContent='CHARACTERS';
 document.querySelector('.inspector').prepend(make('p','section-index','02 / VOICE'));
 const identity=make('div','voice-identity');identity.id='voice-identity';$('voice').after(identity);
 $('voice').dataset.cursor='SELECT';
 const speed=$('speed').closest('.field');speed.classList.add('speed-field');
 const ends=make('div','range-ends');ends.innerHTML='<span>0.5 × / 慢</span><span>2.0 × / 快</span>';speed.append(ends);
 $('tts-options').insertBefore(speed,document.querySelector('#tts-options details'));
 const status=make('div','render-status');status.innerHTML='<span id="render-label">READY TO CREATE</span><span class="signal" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>';
 document.querySelector('.generate-area').prepend(status);
 $('generate').dataset.cursor='CREATE';
 $('generate').after(make('span','generate-footnote','MADE HERE. HEARD EVERYWHERE.'));
 const output=make('section','output');output.id='output';
 output.innerHTML='<p class="section-index"><span>03 / LISTEN</span><span>THE SOUND OF YOUR WORDS</span></p><div class="output-heading"><h2 id="output-title">声音，即将发生。</h2><button id="output-play" class="play-button" disabled aria-label="播放音频" data-cursor="LISTEN"><span id="play-symbol">▶</span><span id="play-label">PLAY SOUND</span></button></div><div class="wave-wrap"><canvas id="waveform" role="slider" tabindex="0" aria-label="音频播放位置" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0"></canvas><p id="wave-empty">生成一段声音，在这里听见它。</p><span id="wave-time" hidden></span></div><div class="output-meta"><span><span id="elapsed">0:00</span> / <span id="duration">0:00</span></span><a id="output-download" hidden>下载 WAV ↗</a></div><audio id="output-audio" preload="metadata"></audio>';
 const history=document.querySelector('.history');history.before(output);
 const heading=document.querySelector('.section-heading');heading.querySelector('h2').firstChild.textContent='声音档案 ';
 heading.querySelector('.muted').remove();
 const toggle=make('button','text-button','回收站');toggle.id='trash-toggle';toggle.onclick=()=>{trash=!trash;signature='';renderStudio(currentState);};heading.append(toggle);
 const columns=make('div','archive-columns');columns.innerHTML='<span>NO.</span><span>RECORDING / 声音记录</span><span>LISTEN · SAVE · REMOVE</span>';heading.after(columns);
 const cursor=make('div');cursor.id='cursor-label';cursor.setAttribute('aria-hidden','true');document.body.append(cursor);
 document.addEventListener('pointermove',e=>{const target=e.target.closest('[data-cursor]');cursor.classList.toggle('visible',!!target&&matchMedia('(pointer:fine)').matches&&!matchMedia('(prefers-reduced-motion:reduce)').matches);if(target){cursor.textContent=target.dataset.cursor;cursor.style.transform='translate('+(e.clientX+18)+'px,'+(e.clientY+18)+'px)';}});
 document.addEventListener('pointerout',e=>{if(!e.relatedTarget)cursor.classList.remove('visible');});
 const audio=$('output-audio');
 $('output-play').onclick=()=>{if(audio.paused)audio.play().catch(()=>hooks.toast('无法播放这个音频，请检查文件或重新生成'));else audio.pause();};
 for(const event of ['play','pause','ended'])audio.addEventListener(event,()=>{const playing=!audio.paused;output.classList.toggle('is-playing',playing);$('play-symbol').textContent=playing?'Ⅱ':'▶';$('play-label').textContent=playing?'PAUSE SOUND':'PLAY SOUND';$('output-play').setAttribute('aria-label',playing?'暂停音频':'播放音频');});
 audio.addEventListener('timeupdate',draw);
 audio.addEventListener('ended',()=>{if(pendingSelection&&currentState?.jobs.some(j=>j.id===pendingSelection.id)){selectAudio(pendingSelection);renderStudio(currentState);}});
 audio.addEventListener('loadedmetadata',()=>{if(Number.isFinite(audio.duration)){duration=audio.duration;$('duration').textContent=time(duration);draw();}});
 audio.addEventListener('error',()=>{if(audio.getAttribute('src')){$('wave-empty').textContent='音频无法播放，可查看任务日志或重新生成。';$('wave-empty').hidden=false;$('output-play').disabled=true;}});
 const canvas=$('waveform');
 const position=e=>Math.max(0,Math.min(1,(e.clientX-canvas.getBoundingClientRect().left)/canvas.clientWidth));
 canvas.addEventListener('pointermove',e=>{if(!duration)return;$('wave-time').hidden=false;$('wave-time').textContent=time(position(e)*duration);$('wave-time').style.left=(position(e)*100)+'%';if(canvas.hasPointerCapture(e.pointerId))seek(position(e)*duration);});
 canvas.addEventListener('pointerleave',()=>{$('wave-time').hidden=true;});
 canvas.addEventListener('pointerdown',e=>{if(!duration)return;canvas.focus();canvas.setPointerCapture(e.pointerId);seek(position(e)*duration);});
 canvas.addEventListener('keydown',e=>{if(!duration)return;if(['ArrowLeft','ArrowRight','Home','End',' '].includes(e.key)){e.preventDefault();if(e.key===' ')$('output-play').click();else seek(e.key==='Home'?0:e.key==='End'?duration:audio.currentTime+(e.key==='ArrowRight'?1:-1));}});
 new ResizeObserver(draw).observe(canvas);
 $('voice').addEventListener('change',()=>updateIdentity(currentState));
}
function seek(value){$('output-audio').currentTime=Math.max(0,Math.min(duration,value));draw();}
function updateIdentity(state){const v=state?.voices.find(v=>v.id===$('voice').value);$('voice-identity').replaceChildren(make('span','',v?.engine==='rvc'?'RVC / VOICE CONVERSION':'GPT-SoVITS / TEXT TO SPEECH'),make('span','',v?.version||''));}
function draw(){
 const canvas=$('waveform');if(!canvas)return;
 const rect=canvas.getBoundingClientRect(),dpr=devicePixelRatio||1;if(!rect.width)return;
 canvas.width=Math.round(rect.width*dpr);canvas.height=Math.round(rect.height*dpr);
 const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);
 const current=$('output-audio').currentTime||0,ratio=duration?current/duration:0;
 const count=Math.min(peaks.length,Math.floor(rect.width/4));
 for(let i=0;i<count;i++){const start=Math.floor(i*peaks.length/count),end=Math.max(start+1,Math.floor((i+1)*peaks.length/count));let p=0;for(let j=start;j<end;j++)p=Math.max(p,peaks[j]);const h=Math.max(2,p*(rect.height-34));ctx.fillStyle=i/count<ratio?'#bb412c':'#81877d';ctx.fillRect(i*rect.width/count,(rect.height-h)/2,2,h);}
 $('elapsed').textContent=time(current);canvas.setAttribute('aria-valuemax',String(duration));canvas.setAttribute('aria-valuenow',String(current));canvas.setAttribute('aria-valuetext',time(current)+' / '+time(duration));
}
async function selectAudio(job){
 if(selected===job.id)return;
 pendingSelection=undefined;
 const token=++decodeId;selected=job.id;peaks=[];duration=0;
 const audio=$('output-audio');audio.pause();audio.src=job.audio;
 $('output-title').textContent=job.title;$('output-play').disabled=false;$('duration').textContent='0:00';
 const download=$('output-download');download.hidden=false;download.href=job.audio;download.download='声间-'+job.id.slice(0,8)+'.wav';
 $('wave-empty').textContent='正在读取声音波形…';$('wave-empty').hidden=false;draw();signature='';
 try{
  const response=await fetch(job.audio);if(!response.ok)throw Error('audio');
  audioContext||=new AudioContext();const buffer=await audioContext.decodeAudioData(await response.arrayBuffer());if(token!==decodeId)return;
  duration=buffer.duration;const data=buffer.getChannelData(0),bins=1600;peaks=Array.from({length:bins},(_,i)=>{let max=0;for(let k=Math.floor(i*data.length/bins);k<Math.floor((i+1)*data.length/bins);k++)max=Math.max(max,Math.abs(data[k]));return max;});
  $('duration').textContent=time(duration);$('wave-empty').hidden=true;draw();
 }catch{if(token===decodeId){$('wave-empty').textContent='波形暂时无法读取，仍可尝试播放或下载。';}}
}
export function renderStudio(state){
 if(!state)return;currentState=state;updateIdentity(state);
 const pending=state.jobs.filter(j=>['queued','running'].includes(j.status));
 const latest=state.jobs.find(j=>j.status==='done');
 if(initialized&&latest&&latest.id!==lastCompleted){if($('output-audio').paused)selectAudio(latest);else pendingSelection=latest;}
 lastCompleted=latest?.id||'';initialized=true;
 document.body.classList.toggle('is-generating',pending.length>0);
 $('render-label').textContent=pending.length?'正在生成 · '+pending.length+' 个任务':'READY TO CREATE';
 const active=state.jobs.find(j=>j.id===selected&&j.status==='done');
 if(!active){const next=state.jobs.find(j=>j.status==='done');if(next)selectAudio(next);else if(selected){++decodeId;selected='';peaks=[];duration=0;$('output-audio').pause();$('output-audio').removeAttribute('src');$('output-audio').load();$('output-play').disabled=true;$('output-title').textContent='声音，即将发生。';$('wave-empty').textContent='生成一段声音，在这里听见它。';$('wave-empty').hidden=false;$('output-download').hidden=true;$('duration').textContent='0:00';draw();}}
 const list=trash?(state.archivedJobs||[]):state.jobs;
 $('job-count').textContent=String(list.length).padStart(2,'0');
 $('trash-toggle').textContent=trash?'返回声音档案':'回收站 / '+(state.archivedJobs||[]).length;
 $('trash-toggle').setAttribute('aria-pressed',String(trash));
 const nextSignature=JSON.stringify([list,selected,trash]);if(signature===nextSignature)return;signature=nextSignature;
 $('jobs').replaceChildren();if(!list.length){$('jobs').append(make('p','empty',trash?'回收站为空。':'还没有声音记录，从一句话开始。'));return;}
 for(const [i,j] of list.entries()){
  const row=make('article','job'+(j.id===selected?' is-selected':''));row.dataset.jobId=j.id;
  row.append(make('span','job-index',String(list.length-i).padStart(2,'0')));
  const info=make('div');info.style.minWidth='0';info.append(make('p','job-title',j.title),make('p','job-meta',j.voiceName+' / '+new Date(j.createdAt).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})));row.append(info);
  const actions=make('div','job-actions');
  if(!trash&&j.status==='done'){const play=make('button','',j.id===selected?'已选中 ↗':'试听 ↗');play.dataset.cursor='LISTEN';play.onclick=()=>{selectAudio(j);signature='';renderStudio(currentState);$('output').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth',block:'center'});};const download=make('a','','下载');download.href=j.audio;download.download='声间-'+j.id.slice(0,8)+'.wav';actions.append(play,download);}
  else if(!trash){actions.append(make('span','job-status',({queued:'等待生成',running:'正在生成…',failed:'生成未完成'})[j.status]||j.status));if(j.status==='failed'){const log=make('a','','日志 ↗');log.href='/logs/'+j.id+'.log';log.target='_blank';log.rel='noopener';actions.append(log);}}
  const remove=make('button','',trash?'恢复':'删除');remove.disabled=['queued','running'].includes(j.status);remove.title=remove.disabled?'生成结束后可删除':trash?'恢复到声音档案':'移入回收站，保留音频文件';
  remove.onclick=async()=>{const restoring=trash;remove.disabled=true;try{await hooks.api('/api/jobs/'+j.id+(restoring?'/restore':''),{method:restoring?'POST':'DELETE'});hooks.toast(restoring?'记录已恢复':'已移入回收站，可随时恢复');signature='';await hooks.refresh();}catch(e){hooks.toast(e.message);remove.disabled=false;}};
  actions.append(remove);row.append(actions);if(j.error&&!trash)row.append(make('p','job-error',j.error));$('jobs').append(row);
 }
}

