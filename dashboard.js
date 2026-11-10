import {LANGUAGES, LICENSES, buildQuery, safeRepoUrl, normalizeRepo, formatNumber, relativeDate} from './core.mjs';

const $ = (id) => document.getElementById(id);
const state = {view:'trending', favorites:{}, saved:[], items:[], page:1, total:0, incomplete:false, query:'', request:0, theme:'dark', loading:false};
const titles = {
  trending:['热门趋势','好项目，不应该被埋没。','看看开发者们正在关注什么，发现值得收藏的下一件作品。','GitHub Trending'],
  rising:['近期高星','发现正在冒尖的新作品。','最近 30 天创建、至少 100 Star 的项目，按总 Star 排序。不是涨星榜。','新项目 · 高星发现'],
  search:['增强搜索','让搜索，真正找到答案。','组合关键词与筛选条件，不必再记住所有 GitHub 搜索语法。','搜索结果'],
  favorites:['我的收藏','给好作品，一个位置。','你的本地开源书签。收藏不等于 GitHub Star，也不会上传到任何服务器。','我的收藏']
};
const colors = {Python:'#e0c85c',TypeScript:'#458cdf',JavaScript:'#dec750',Go:'#51c6d9',Rust:'#d99979',Java:'#e69359','C++':'#db83be',C:'#9eaac4','C#':'#a39ae0',Shell:'#85c874'};
let toastTimer;
function node(tag, className, text){const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;}
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{$('toast').hidden=true;},4000);}
function showStatus(message,error=false){$('status').replaceChildren();$('status').className=error?'status error':'status';if(message)$('status').textContent=message;}
function options(){return {keyword:$('keyword').value.trim(),language:$('language').value,minStars:$('min-stars').value,updatedWithin:$('updated-within').value,license:$('license').value,includeForks:$('include-forks').checked,includeArchived:$('include-archived').checked,sort:$('sort').value};}
function applyOptions(value){$('keyword').value=typeof value.keyword==='string'?value.keyword.slice(0,1000):'';for(const [id,key] of [['language','language'],['min-stars','minStars'],['updated-within','updatedWithin'],['license','license'],['sort','sort']]){const select=$(id);select.value=String(value[key]??(key==='minStars'?'0':key==='sort'?'best-match':''));if(select.selectedIndex===-1){const raw=String(value[key]??'');const valid=key==='language'?LANGUAGES.includes(raw):key==='license'?LICENSES.includes(raw):key==='minStars'?/^(0|[1-9]\d*)$/.test(raw)&&Number.isSafeInteger(Number(raw)):false;if(valid){const option=node('option','',key==='minStars'?`${Number(raw).toLocaleString('zh-CN')}+`:raw);option.value=raw;select.append(option);select.value=raw;}else select.selectedIndex=0;}}$('include-forks').checked=value.includeForks===true;$('include-archived').checked=value.includeArchived===true;}
function previewQuery(){try{const q=buildQuery(options());$('query-preview').textContent=q;return q;}catch(error){$('query-preview').textContent=error.message;return null;}}
function switchView(view,load=true){state.view=view;document.body.dataset.view=view;document.querySelectorAll('[data-view]').forEach(button=>button.classList.toggle('active',button.dataset.view===view));const [crumb,title,desc,result]=titles[view];$('breadcrumb').textContent=crumb;$('page-title').textContent=title;$('page-description').textContent=desc;$('results-title').textContent=result;$('query-panel').hidden=view!=='search';previewQuery();if(load)loadResults();}
function parseTrending(html){
  const doc=new DOMParser().parseFromString(html,'text/html');
  const articles=[...doc.querySelectorAll('article.Box-row')];
  const items=articles.map(article=>{
    const anchor=article.querySelector('h2 a');const path=anchor?.getAttribute('href');const fullName=path?.replace(/^\//,'');const url=safeRepoUrl(fullName);
    if(!url)return null;
    const counts=[...article.querySelectorAll('a.Link--muted')];
    const count=(suffix)=>{const link=counts.find(a=>a.getAttribute('href')===`/${fullName}/${suffix}`);const digits=link?.textContent.replace(/[^0-9]/g,'');return Number(digits)||0;};
    const gain=[...article.querySelectorAll('span')].find(el=>el.classList.contains('float-sm-right')&&/stars?/.test(el.textContent));
    return {id:fullName,full_name:fullName,html_url:url,description:article.querySelector('p')?.textContent.trim()||'',language:article.querySelector('[itemprop="programmingLanguage"]')?.textContent.trim()||'',stars:count('stargazers'),forks:count('forks'),topics:[],updated_at:'',license:'',archived:false,growth:gain?.textContent.trim().replace(/\s+/g,' ')||''};
  }).filter(Boolean);
  if(!items.length)throw new Error('Trending 榜单为空或 GitHub 页面结构已变化。请稍后重试，或直接在 GitHub 查看榜单。');
  return items;
}
function setLoading(append){state.loading=true;$('load-more').disabled=true;$('refresh-button').disabled=true;$('results-meta').textContent='正在连接 GitHub…';showStatus('');if(!append){$('repo-grid').replaceChildren(...Array.from({length:6},()=>node('div','skeleton')));$('load-more').hidden=true;}}
function updateMeta(cached=false){if(state.view==='favorites')$('results-meta').textContent=`${state.items.length} 个本地收藏`;else if(state.view==='trending')$('results-meta').textContent=`${state.items.length} 个项目 · ${{daily:'今日',weekly:'本周',monthly:'本月'}[$('period').value]}${cached?' · 5 分钟内缓存':''}`;else $('results-meta').textContent=`${state.incomplete?'约 ':''}${Number(state.total).toLocaleString('zh-CN')} 个匹配 · 已展示 ${state.items.length}${cached?' · 缓存':''}`;}
async function loadResults(append=false){
  const request=++state.request;const view=state.view;
  if(view==='favorites'){state.loading=false;$('refresh-button').disabled=false;state.items=Object.values(state.favorites);state.total=state.items.length;showStatus('');renderCards();updateMeta();$('load-more').hidden=true;return;}
  if(!append){state.page=1;state.items=[];$('load-more').hidden=true;}
  let query='';
  try{if(view==='search'){query=append?state.query:buildQuery(options());if(!append){state.query=query;state.appliedSort=$('sort').value;}$('query-preview').textContent=query;}else if(view==='rising'){const date=new Date();date.setUTCDate(date.getUTCDate()-30);query=append?state.query:buildQuery({...options(),keyword:`created:>=${date.toISOString().slice(0,10)}`,minStars:100,updatedWithin:'',license:'',includeForks:false,includeArchived:false});state.query=query;}}
  catch(error){state.loading=false;$('refresh-button').disabled=false;showStatus(error.message,true);$('repo-grid').replaceChildren();$('results-meta').textContent='请检查筛选条件';return;}
  setLoading(append);
  try{
    const response=await chrome.runtime.sendMessage(view==='trending'?{type:'trending',language:$('language').value,since:$('period').value}:{type:'search',query,sort:view==='rising'?'stars':state.appliedSort,page:state.page});
    if(request!==state.request)return;
    if(!response?.ok){let message=response?.error||'未能获取数据。';if(response?.retryAt)message+=` 可在 ${new Date(response.retryAt).toLocaleTimeString('zh-CN')} 后重试。`;throw new Error(message);}
    const incoming=view==='trending'?parseTrending(response.data):response.data.items.map(normalizeRepo).filter(repo=>repo.html_url);
    const previous=append?state.items:[];const seen=new Set(previous.map(item=>item.full_name));state.items=[...previous,...incoming.filter(item=>!seen.has(item.full_name))];
    state.total=view==='trending'?incoming.length:response.data.total_count;state.incomplete=Boolean(response.data.incomplete_results);
    renderCards();updateMeta(response.cached);showStatus(state.incomplete?'GitHub 本次检索未完成，数量和结果可能不完整。可稍后重试。':'');
    $('load-more').hidden=view==='trending'||incoming.length<30||state.items.length>=Math.min(state.total,1000)||state.page>=33;
  }catch(error){if(request!==state.request)return;if(!append)$('repo-grid').replaceChildren();showStatus(`${error.message} 点击「刷新」重试。`,true);$('results-meta').textContent='数据获取失败';if(append)state.page=Math.max(1,state.page-1);if(view==='trending'){const link=node('a','text-button','打开 GitHub Trending ↗');link.href='https://github.com/trending';link.target='_blank';link.rel='noopener noreferrer';$('status').append(link);}}
  finally{if(request===state.request){state.loading=false;$('load-more').disabled=false;$('refresh-button').disabled=false;}}
}
function renderCards(){
  const grid=$('repo-grid');grid.replaceChildren();
  if(!state.items.length){const empty=node('div','empty-state');empty.append(node('strong','',state.view==='favorites'?'还没有收藏的项目':'没有找到匹配项目'),node('span','',state.view==='favorites'?'点击项目卡片右上角的 ☆，把灵感留在这里。':'试着减少筛选条件，或者换一个关键词。'));grid.append(empty);return;}
  for(const [index,repo] of state.items.entries()){
    const card=node('article','repo-card');if(state.view==='trending')card.append(node('span','rank',`TREND #${String(index+1).padStart(2,'0')}`));
    const top=node('div','card-top');const link=node('a','repo-name');link.href=safeRepoUrl(repo.full_name);link.target='_blank';link.rel='noopener noreferrer';const [owner,name]=repo.full_name.split('/');link.append(node('span','owner',`${owner} /`),document.createTextNode(name));
    const bookmark=node('button',`bookmark${state.favorites[repo.full_name]?' selected':''}`,state.favorites[repo.full_name]?'★':'☆');bookmark.title=state.favorites[repo.full_name]?'取消本地收藏':'加入本地收藏';bookmark.setAttribute('aria-label',`${bookmark.title} ${repo.full_name}`);bookmark.setAttribute('aria-pressed',String(Boolean(state.favorites[repo.full_name])));bookmark.addEventListener('click',()=>toggleFavorite(repo));top.append(link,bookmark);card.append(top,node('p','repo-description',repo.description||'这个项目暂未提供简介，去仓库看看吧。'));
    const topics=node('div','repo-topics');for(const topic of repo.topics.slice(0,4)){const button=node('button','topic',topic);button.addEventListener('click',()=>topicSearch(topic));topics.append(button);}if(repo.archived)topics.append(node('span','topic','已归档'));card.append(topics);
    const stats=node('div','repo-stats');if(repo.language){const lang=node('span');const dot=node('span','language-dot');dot.style.backgroundColor=colors[repo.language]||'#91b4ff';lang.append(dot,document.createTextNode(repo.language));stats.append(lang);}const stars=node('span','',`☆ ${formatNumber(repo.stars)}`);stars.title=`${repo.stars.toLocaleString('zh-CN')} Stars`;const forks=node('span','',`⑂ ${formatNumber(repo.forks)}`);forks.title='Fork 数';stats.append(stars,forks);
    if(repo.growth){stats.append(node('span','growth',`↗ ${repo.growth}`));}else if(repo.updated_at){const date=node('span','updated',`更新于 ${relativeDate(repo.updated_at)}`);date.title=repo.updated_at;stats.append(date);}card.append(stats);grid.append(card);
  }
}
async function persist(key,value){await chrome.storage.local.set({[key]:value});}
async function mutate(operation,payload={}){const response=await chrome.runtime.sendMessage({type:'data-mutate',operation,...payload});if(!response?.ok)throw new Error(response?.error||'本地数据保存失败。');state.favorites=response.data.favorites;state.saved=response.data.saved;renderSaved();return response.data;}
async function toggleFavorite(repo){try{const current=await mutate('toggle-favorite',{repo});if(state.view==='favorites')loadResults();else renderCards();toast(current.favorites[repo.full_name]?'已加入本地收藏':'已取消收藏');}catch(error){toast(`收藏未保存：${error.message}`);}}
function renderSaved(){
  $('favorite-count').textContent=Object.keys(state.favorites).length;$('saved-list').replaceChildren();
  if(!state.saved.length){$('saved-list').append(node('div','saved-empty','把常用搜索保存在这里。'));return;}
  for(const entry of state.saved){const row=node('div','saved-row');const button=node('button','saved-link',`⌕  ${entry.name}`);button.title=entry.name;button.addEventListener('click',()=>{applyOptions(entry.options);switchView('search');});const remove=node('button','', '×');remove.setAttribute('aria-label',`删除保存的搜索 ${entry.name}`);remove.addEventListener('click',async()=>{try{await mutate('delete-search',{id:entry.id});toast('已删除保存的搜索');}catch(error){toast(error.message);}});row.append(button,remove);$('saved-list').append(row);}
}
function topicSearch(topic){applyOptions({...options(),keyword:`topic:${topic}`});switchView('search');}
function openSave(){if(state.view!=='search'){state.request++;state.loading=false;state.items=[];switchView('search',false);$('repo-grid').replaceChildren();$('results-meta').textContent='';$('load-more').hidden=true;$('refresh-button').disabled=false;showStatus('设置好筛选后，点击「搜索项目」查看结果。');toast('设置好搜索条件后，保存这次搜索。');}if(!previewQuery()){toast('请先设置有效的搜索条件。');return;}$('saved-name').value=$('keyword').value.slice(0,40)||'我的项目搜索';$('save-dialog').showModal();$('saved-name').focus();}
function cleanFavorite(repo){if(!repo||typeof repo!=='object'||!safeRepoUrl(repo.full_name))return null;return {...normalizeRepo(repo),growth:''};}
async function importBackup(file){
  if(!file)return;if(file.size>2_000_000)throw new Error('备份文件不能超过 2 MB。');const data=JSON.parse(await file.text());if(data.version!==1||!Array.isArray(data.favorites)||!Array.isArray(data.saved))throw new Error('不是有效的 GitHub Lens 备份。');
  await mutate('import-backup',{favorites:data.favorites,saved:data.saved});if(state.view==='favorites')loadResults();else renderCards();toast('备份已合并到本地数据。');
}
async function init(){
  if(!globalThis.chrome?.runtime?.id||!chrome.storage){showStatus('请在 Chrome 中通过「加载已解压的扩展程序」安装后打开。直接打开 HTML 无法访问 GitHub。',true);return;}
  try{const saved=await chrome.storage.local.get(['favorites','saved','theme']);state.favorites={};for(const item of Object.values(saved.favorites||{})){const repo=cleanFavorite(item);if(repo)state.favorites[repo.full_name]=repo;}state.saved=Array.isArray(saved.saved)?saved.saved.filter(entry=>entry&&typeof entry.name==='string'&&entry.options).slice(0,100):[];state.theme=saved.theme==='light'?'light':'dark';document.body.classList.toggle('light',state.theme==='light');renderSaved();}catch(error){toast(`无法读取本地数据：${error.message}`);}
  document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>switchView(button.dataset.view)));
  $('search-form').addEventListener('submit',event=>{event.preventDefault();switchView('search');});
  document.querySelectorAll('[data-topic]').forEach(button=>button.addEventListener('click',()=>topicSearch(button.dataset.topic)));
  $('keyword').addEventListener('input',previewQuery);
  for(const id of ['language','period','min-stars','updated-within','license','sort','include-forks','include-archived'])$(id).addEventListener('change',()=>{previewQuery();if(state.view==='trending'||state.view==='rising')loadResults();else if(state.view==='search')toast('筛选已调整，点击「搜索项目」应用。');});
  $('reset-filters').addEventListener('click',()=>{applyOptions({keyword:$('keyword').value});$('period').value='daily';previewQuery();if(state.view==='search')toast('筛选已重置，点击「搜索项目」应用。');else loadResults();});
  $('open-github').addEventListener('click',()=>{const query=previewQuery();if(query)window.open(`https://github.com/search?type=repositories&q=${encodeURIComponent(query)}&s=${$('sort').value==='best-match'?'':$('sort').value}&o=desc`,'_blank','noopener,noreferrer');});
  $('refresh-button').addEventListener('click',async()=>{try{$('refresh-button').disabled=true;await chrome.runtime.sendMessage({type:'clear-cache'});await loadResults();}catch(error){showStatus(error.message,true);$('refresh-button').disabled=false;}});
  $('load-more').addEventListener('click',()=>{if(state.loading)return;state.page++;loadResults(true);});
  for(const id of ['save-search','save-search-inline'])$(id).addEventListener('click',openSave);
  $('save-form').addEventListener('submit',async event=>{event.preventDefault();const name=$('saved-name').value.trim();if(!name)return;try{await mutate('save-search',{entry:{id:crypto.randomUUID(),name,options:options()}});$('save-dialog').close();toast('搜索已保存');}catch(error){toast(`保存失败：${error.message}`);}});
  $('settings-button').addEventListener('click',()=>$('settings-dialog').showModal());document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>button.closest('dialog').close()));
  $('theme-button').addEventListener('click',async()=>{state.theme=state.theme==='dark'?'light':'dark';document.body.classList.toggle('light',state.theme==='light');try{await persist('theme',state.theme);}catch(error){toast(error.message);}});
  $('export-data').addEventListener('click',async()=>{try{const data=await chrome.storage.local.get(['favorites','saved']);const blob=new Blob([JSON.stringify({version:1,exportedAt:new Date().toISOString(),favorites:Object.values(data.favorites||{}),saved:data.saved||[]},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const link=node('a');link.href=url;link.download=`github-lens-backup-${new Date().toISOString().slice(0,10)}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);toast('已导出本地备份');}catch(error){toast(error.message);}});
  $('import-data').addEventListener('click',()=>$('import-file').click());$('import-file').addEventListener('change',async()=>{try{await importBackup($('import-file').files[0]);}catch(error){toast(`导入失败：${error.message}`);}finally{$('import-file').value='';}});
  document.addEventListener('keydown',event=>{if(event.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)&&!document.querySelector('dialog[open]')){event.preventDefault();$('keyword').focus();}});
  chrome.storage.onChanged.addListener((changes,area)=>{if(area!=='local')return;if(changes.favorites){state.favorites=changes.favorites.newValue||{};renderSaved();if(state.view==='favorites')loadResults();else if(!state.loading)renderCards();}if(changes.saved){state.saved=changes.saved.newValue||[];renderSaved();}if(changes.theme){state.theme=changes.theme.newValue;document.body.classList.toggle('light',state.theme==='light');}});
  switchView('trending');
}
init().catch(error=>showStatus(`初始化失败：${error.message}`,true));
