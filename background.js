import {LANGUAGES, buildQuery, normalizeRepo, safeRepoUrl} from './core.mjs';

const cache=new Map();
const pending=new Map();
const TTL=5*60*1000;
let mutationQueue=Promise.resolve();

chrome.action.onClicked.addListener(async()=>{
  const url=chrome.runtime.getURL('dashboard.html');
  const tabs=await chrome.tabs.query({});
  const existing=tabs.find(tab=>tab.url===url);
  if(existing){await chrome.tabs.update(existing.id,{active:true});await chrome.windows.update(existing.windowId,{focused:true});}
  else await chrome.tabs.create({url});
});

function requestSpec(message){
  if(message.type==='search'){
    if(typeof message.query!=='string'||!message.query.trim()||message.query.length>1500)throw new Error('搜索查询无效或过长。');
    if(!['stars','updated','best-match'].includes(message.sort))throw new Error('不支持的搜索排序。');
    if(!Number.isInteger(message.page)||message.page<1||message.page>33)throw new Error('页码无效；最多浏览前 990 个项目。');
    const url=new URL('https://api.github.com/search/repositories');url.searchParams.set('q',message.query);url.searchParams.set('per_page','30');url.searchParams.set('page',String(message.page));if(message.sort!=='best-match'){url.searchParams.set('sort',message.sort);url.searchParams.set('order','desc');}
    return {url:url.href,kind:'json'};
  }
  if(message.type==='trending'){
    if(typeof message.language!=='string'||(message.language&&!LANGUAGES.includes(message.language)))throw new Error('不支持的趋势语言。');
    if(!['daily','weekly','monthly'].includes(message.since))throw new Error('不支持的趋势周期。');
    const slug=message.language.toLowerCase().replaceAll(' ','-');
    const url=new URL(`https://github.com/trending${slug?'/'+encodeURIComponent(slug):''}`);url.searchParams.set('since',message.since);
    return {url:url.href,kind:'html'};
  }
  throw new Error('未知请求。');
}
function retryTime(response){
  const now=Date.now();const retry=response.headers.get('retry-after');
  if(retry){const seconds=Number(retry);const date=Number.isFinite(seconds)?now+seconds*1000:Date.parse(retry);if(Number.isFinite(date))return Math.max(now,date);}
  const reset=Number(response.headers.get('x-ratelimit-reset'));if(reset>0)return Math.max(now,reset*1000);
  return undefined;
}
async function fetchData(spec){
  const hit=cache.get(spec.url);if(hit&&hit.expires>Date.now())return {ok:true,data:hit.data,cached:true};if(hit)cache.delete(spec.url);
  if(pending.has(spec.url))return pending.get(spec.url);
  const task=(async()=>{
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),20000);
    try{
      const response=await fetch(spec.url,{method:'GET',credentials:'omit',headers:{Accept:spec.kind==='json'?'application/vnd.github+json':'text/html',...(spec.kind==='json'?{'X-GitHub-Api-Version':'2022-11-28'}:{})},signal:controller.signal});
      if(!response.ok){
        const rate=response.status===429||response.status===403;
        const explanation=rate?'GitHub 拒绝请求或触发访问限流。':response.status===422?'GitHub 无法执行此查询，请检查高级语法与筛选条件。':`GitHub 返回 HTTP ${response.status}。`;
        return {ok:false,error:explanation,...(rate&&retryTime(response)?{retryAt:retryTime(response)}:{})};
      }
      let data;
      if(spec.kind==='json'){data=await response.json();if(!Array.isArray(data.items)||typeof data.total_count!=='number')throw new Error('GitHub 搜索数据格式异常。');}
      else {data=await response.text();if(data.length>5_000_000)throw new Error('GitHub Trending 响应过大。');}
      cache.set(spec.url,{data,expires:Date.now()+TTL});while(cache.size>60)cache.delete(cache.keys().next().value);
      return {ok:true,data,cached:false};
    }catch(error){return {ok:false,error:error.name==='AbortError'?'连接 GitHub 超时（20 秒），请检查网络后重试。':`无法获取 GitHub 数据：${error.message}`};}
    finally{clearTimeout(timer);}
  })();pending.set(spec.url,task);try{return await task;}finally{pending.delete(spec.url);}
}
function validSaved(entry){
  if(!entry||typeof entry.name!=='string'||!entry.name.trim()||entry.name.length>40)throw new Error('保存的搜索名称无效。');
  buildQuery(entry.options);
  const o=entry.options;const options={keyword:o.keyword||'',language:o.language||'',minStars:o.minStars??'0',updatedWithin:o.updatedWithin||'',license:o.license||'',includeForks:o.includeForks===true,includeArchived:o.includeArchived===true,sort:['stars','updated','best-match'].includes(o.sort)?o.sort:'best-match'};
  return {id:typeof entry.id==='string'&&entry.id.length<=80?entry.id:crypto.randomUUID(),name:entry.name.trim(),options};
}
async function mutateData(message){
  const current=await chrome.storage.local.get(['favorites','saved']);const favorites={...(current.favorites||{})};let saved=Array.isArray(current.saved)?current.saved:[];
  if(message.operation==='toggle-favorite'){
    if(!safeRepoUrl(message.repo?.full_name))throw new Error('无效的仓库路径。');const repo=normalizeRepo(message.repo);
    if(favorites[repo.full_name])delete favorites[repo.full_name];else{if(Object.keys(favorites).length>=3000)throw new Error('最多收藏 3,000 个项目，请先删除部分收藏。');favorites[repo.full_name]=repo;}
  }else if(message.operation==='save-search'){
    if(saved.length>=100)throw new Error('最多保存 100 个搜索。');saved=[...saved,validSaved(message.entry)];
  }else if(message.operation==='delete-search'){
    if(typeof message.id!=='string')throw new Error('无效的搜索标识。');saved=saved.filter(entry=>entry.id!==message.id);
  }else if(message.operation==='import-backup'){
    if(!Array.isArray(message.favorites)||!Array.isArray(message.saved)||JSON.stringify(message).length>2_000_000)throw new Error('备份格式无效或超过 2 MB。');
    for(const item of message.favorites.slice(0,3000)){if(safeRepoUrl(item?.full_name)&&(favorites[item.full_name]||Object.keys(favorites).length<3000))favorites[item.full_name]=normalizeRepo(item);}
    const ids=new Set(saved.map(entry=>entry.id));for(const entry of message.saved.slice(0,100)){try{const valid=validSaved(entry);if(!ids.has(valid.id)&&saved.length<100){saved.push(valid);ids.add(valid.id);}}catch{}}
  }else throw new Error('未知本地数据操作。');
  await chrome.storage.local.set({favorites,saved});return {ok:true,data:{favorites,saved}};
}
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(sender.id!==chrome.runtime.id){sendResponse({ok:false,error:'请求来源不合法。'});return false;}
  if(!message||typeof message!=='object'){sendResponse({ok:false,error:'请求格式无效。'});return false;}
  if(message.type==='clear-cache'){cache.clear();sendResponse({ok:true});return false;}
  let task;
  if(message.type==='data-mutate'){
    task=mutationQueue.then(()=>mutateData(message));mutationQueue=task.catch(()=>{});
  }else{try{task=fetchData(requestSpec(message));}catch(error){sendResponse({ok:false,error:error.message});return false;}}
  task.then(sendResponse,error=>sendResponse({ok:false,error:error.message}));return true;
});
