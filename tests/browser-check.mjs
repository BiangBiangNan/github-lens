// Local Edge headless integration check. Requires Node with built-in WebSocket.
import {spawn} from 'node:child_process';
import {writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const artifacts=path.resolve(root,'../github-lens-artifacts');
await mkdir(artifacts,{recursive:true});
const port=19437;
const browser=spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',[
  '--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
  '--disable-background-networking',`--remote-debugging-port=${port}`,
  `--user-data-dir=${path.join(artifacts,'browser-profile')}`,
  `--disable-extensions-except=${root}`,`--load-extension=${root}`,'about:blank'
],{stdio:'inherit'});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
class CDP {
  constructor(socket){this.socket=socket;this.id=0;this.pending=new Map();this.events=[];socket.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.id){const p=this.pending.get(data.id);this.pending.delete(data.id);if(data.error)p?.reject(new Error(data.error.message));else p?.resolve(data.result);}else this.events.push(data);});}
  static async open(url){const socket=new WebSocket(url);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});return new CDP(socket);}
  send(method,params={}){const id=++this.id;return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.socket.send(JSON.stringify({id,method,params}));setTimeout(()=>{if(this.pending.has(id)){this.pending.delete(id);reject(new Error(`CDP timeout ${method}`));}},25000).unref();});}
  async evaluate(expression){const result=await this.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;}
  close(){this.socket.close();}
}
let cdp;
const checks=[];
const check=(name,condition,detail)=>{checks.push({name,pass:Boolean(condition),detail});console.log(`${condition?'PASS':'FAIL'} ${name}`,detail??'');if(!condition)throw new Error(name);};
try{
  let targets;
  for(let i=0;i<50;i++){try{targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();if(targets.some(t=>t.type==='service_worker'&&t.url.includes('background.js')))break;}catch{}await pause(200);}
  const worker=targets?.find(t=>t.type==='service_worker'&&t.url.includes('background.js'));
  check('MV3 background service worker starts',worker,targets?.map(t=>({type:t.type,url:t.url})));
  const base=worker.url.replace(/background\.js$/,'');
  const target=await(await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(base+'dashboard.html')}`,{method:'PUT'})).json();
  cdp=await CDP.open(target.webSocketDebuggerUrl);await cdp.send('Runtime.enable');await cdp.send('Page.enable');
  await pause(1500);
  check('Dashboard initializes in extension context',await cdp.evaluate(`Boolean(chrome.runtime.id && document.body.dataset.view === 'trending')`));
  for(let i=0;i<110;i++){if(await cdp.evaluate(`!document.getElementById('refresh-button').disabled`))break;await pause(250);}
  const live=await cdp.evaluate(`({cards:document.querySelectorAll('.repo-card').length,status:document.getElementById('status').textContent,meta:document.getElementById('results-meta').textContent})`);
  console.log('LIVE TRENDING:',JSON.stringify(live));checks.push({name:'Live Trending fetch',pass:live.cards>0,detail:live});
  if(live.cards>0){await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});await pause(300);const shot=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(path.join(artifacts,'dashboard-live.png'),Buffer.from(shot.data,'base64'));}
  // A fixed, visibly named fixture is used only for deterministic UI testing.
  await cdp.evaluate(`window.__requests=[];window.__realSend=chrome.runtime.sendMessage;chrome.runtime.sendMessage=async function(message){if(message.type==='data-mutate')return window.__realSend.call(chrome.runtime,message);window.__requests.push(message);if(message.type==='clear-cache')return {ok:true};if(message.type==='search')return {ok:true,data:{total_count:60,incomplete_results:false,items:Array.from({length:30},(_,i)=>({id:i+(message.page-1)*30,full_name:'test-owner/repository-'+(i+(message.page-1)*30),description:'TEST FIXTURE <img src=x onerror=alert(1)>',stargazers_count:1234,forks_count:50,language:'Python',topics:['llm'],updated_at:'2026-11-09T00:00:00Z',license:{spdx_id:'MIT'}}))}};return {ok:false,error:'TEST NETWORK ERROR'};};document.getElementById('keyword').value='topic:llm';document.getElementById('search-form').requestSubmit();`);
  await pause(300);
  check('Search displays cards',await cdp.evaluate(`document.querySelectorAll('.repo-card').length===30`));
  check('Repository descriptions are text, not executable HTML',await cdp.evaluate(`document.querySelector('.repo-description').textContent.includes('<img') && document.querySelector('.repo-grid img')===null`));
  await cdp.evaluate(`document.querySelector('.bookmark').click()`);await pause(250);
  check('Favorites persist locally',await cdp.evaluate(`(async()=>Object.keys((await chrome.storage.local.get('favorites')).favorites||{}).length===1)()`));
  await cdp.evaluate(`document.getElementById('keyword').value='different topic';document.getElementById('sort').value='updated';document.getElementById('load-more').click();`);await pause(250);
  check('Pagination retains submitted query and sort',await cdp.evaluate(`window.__requests.at(-1).query.includes('topic:llm') && window.__requests.at(-1).sort==='best-match' && document.querySelectorAll('.repo-card').length===60`));
  await cdp.evaluate(`document.getElementById('save-search-inline').click();document.getElementById('saved-name').value='Test saved search';document.getElementById('save-form').requestSubmit();`);await pause(250);
  check('Saved search persists',await cdp.evaluate(`(async()=>((await chrome.storage.local.get('saved')).saved||[]).length===1)()`));
  await cdp.evaluate(`document.querySelector('[data-view="favorites"]').click()`);await pause(150);
  check('Favorites view renders local bookmark',await cdp.evaluate(`document.querySelectorAll('.repo-card').length===1 && document.getElementById('results-meta').textContent.includes('本地收藏')`));
  await cdp.evaluate(`document.getElementById('theme-button').click()`);await pause(150);
  check('Light theme toggles and persists',await cdp.evaluate(`(async()=>document.body.classList.contains('light') && (await chrome.storage.local.get('theme')).theme==='light')()`));
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await pause(150);
  check('Mobile-width layout has no horizontal overflow',await cdp.evaluate(`document.documentElement.scrollWidth<=window.innerWidth`));
  await cdp.evaluate(`chrome.runtime.sendMessage=async()=>({ok:false,error:'TEST RATE LIMIT',retryAt:Date.now()+60000});document.querySelector('[data-view="search"]').click();`);await pause(200);
  check('Rate limit error is visible with retry time',await cdp.evaluate(`document.getElementById('status').textContent.includes('TEST RATE LIMIT')&&document.getElementById('status').textContent.includes('后重试')`));
  check('No uncaught runtime errors',cdp.events.filter(e=>e.method==='Runtime.exceptionThrown').length===0,cdp.events.filter(e=>e.method==='Runtime.exceptionThrown'));
} catch(error){console.error(error);process.exitCode=1;} finally {
  if(cdp)cdp.close();browser.kill();await writeFile(path.join(artifacts,'browser-report.json'),JSON.stringify(checks,null,2));
}
