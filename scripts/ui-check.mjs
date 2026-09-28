import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const base='http://127.0.0.1:3270';
const output=path.resolve('data/ui-review');fs.mkdirSync(output,{recursive:true});
let archivedId;
try{
 await page.goto(base);await page.locator('#voice option').first().waitFor({state:'attached'});
 await page.locator('#output-play:not([disabled])').waitFor();
 await page.locator('#wave-empty').waitFor({state:'hidden'});
 assert.equal(await page.locator('.intro').evaluate(e=>e.parentElement.className),'editor');
 await page.screenshot({path:path.join(output,'desktop.png'),animations:'disabled'});
 await page.locator('#mode-rvc').click();assert.equal(await page.locator('#audio-editor').isVisible(),true);assert.equal(await page.locator('#tts-options').isVisible(),false);
 await page.locator('#mode-tts').click();assert.equal(await page.locator('#text-editor').isVisible(),true);
 await page.locator('#library-open').click();assert.equal(await page.locator('#library').isVisible(),true);await page.locator('#library-close').click();
 const state=await(await page.request.get(base+'/api/state')).json();
 const sample=state.jobs.find(j=>j.status==='done'&&j.title.startsWith('你好，欢迎'));
 assert.ok(sample,'existing successful smoke-test recording is available');
 await page.locator('[data-job-id="'+sample.id+'"] button').first().click();
 await page.locator('#wave-empty').waitFor({state:'hidden'});
 await page.locator('#output-play').click();
 await page.waitForFunction(()=>document.querySelector('#output-audio').currentTime>.15);
 await page.locator('#output-play').click();
 await page.locator('#waveform').focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');
 assert.ok(await page.locator('#output-audio').evaluate(e=>e.currentTime>=.9));
 await page.locator('#output').screenshot({path:path.join(output,'waveform.png'),animations:'disabled'});
 const row=page.locator('[data-job-id="'+sample.id+'"]');
 await row.getByRole('button',{name:'删除',exact:true}).click();archivedId=sample.id;
 await row.waitFor({state:'detached'});
 await page.locator('#trash-toggle').click();await page.locator('[data-job-id="'+sample.id+'"]').getByRole('button',{name:'恢复',exact:true}).click();
 await page.locator('[data-job-id="'+sample.id+'"]').waitFor({state:'detached'});archivedId=undefined;
 await page.locator('#trash-toggle').click();assert.ok(await page.locator('[data-job-id="'+sample.id+'"]').count());
 for(const width of [390,768,1092,1920]){
  await page.setViewportSize({width,height:900});await page.evaluate(()=>window.scrollTo(0,0));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal overflow at '+width);
  if(width===390)await page.screenshot({path:path.join(output,'mobile.png'),animations:'disabled'});
 }
 await page.emulateMedia({reducedMotion:'reduce'});
 assert.equal(await page.locator('.intro h1>span').first().evaluate(e=>getComputedStyle(e).animationName),'none');
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:true,checks:['TTS/RVC mode','voice library','real waveform decode','playback','keyboard seek','delete and restore','390/768/1092/1920 overflow','reduced motion','no browser errors'],screenshots:output},null,2));
}finally{
 if(archivedId)await page.request.post(base+'/api/jobs/'+archivedId+'/restore');
 await browser.close();
}

