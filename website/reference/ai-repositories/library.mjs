const $=selector=>document.querySelector(selector);
const form=$('#filters');
const inputs={q:$('#query'),mode:$('#mode'),category:$('#category'),license:$('#license'),sort:$('#sort')};
const labels={study:'课程与学习参考',mother:'课程母本',tool:'工具与应用案例',pending:'待复核项目',noncourse:'不纳入选课',all:'全部仓库'};
let catalog=null;
let visible=[];
let lastOpener=null;

function node(tag,text,className){const item=document.createElement(tag);if(text!==undefined&&text!==null)item.textContent=String(text);if(className)item.className=className;return item}
function safeUrl(value){try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username?u.href:null}catch{return null}}
function link(label,url){const a=node('a',label);const target=safeUrl(url);if(!target)return null;a.href=target;a.target='_blank';a.rel='noopener noreferrer';return a}
function hashName(){try{return decodeURIComponent(location.hash.slice(1))}catch{return ''}}
function state(){return Object.fromEntries(Object.entries(inputs).map(([key,input])=>[key,input.value]))}
function updateUrl(){const current=state();const params=new URLSearchParams();for(const [key,value] of Object.entries(current))if(value&&!(key==='mode'&&value==='study')&&!(key==='sort'&&value==='recommended'))params.set(key,value);history.replaceState(null,'',location.pathname+(params.size?'?'+params.toString():'')+location.hash)}
function matches(record,s){
  if(s.mode==='study'&&!['featured','reference'].includes(record.status))return false;
  if(s.mode==='mother'&&record.status!=='featured')return false;
  if(['tool','pending','noncourse'].includes(s.mode)&&record.status!==s.mode)return false;
  if(s.category&&record.category!==s.category)return false;
  if(s.license&&record.licenseType!==s.license)return false;
  const terms=s.q.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const haystack=[record.name,record.title,record.category,record.summary,record.kind,record.courseTitle,record.outcome,record.prerequisites].filter(Boolean).join(' ').toLocaleLowerCase();
  return terms.every(term=>haystack.includes(term));
}
function render(sync=true){
  const s=state();
  visible=catalog.repositories.filter(record=>matches(record,s));
  const rank={featured:0,reference:1,tool:2,pending:3,noncourse:4};
  visible.sort((a,b)=>s.sort==='name'?a.name.localeCompare(b.name):s.sort==='updated'?b.updated.localeCompare(a.updated)||a.name.localeCompare(b.name):(rank[a.status]-rank[b.status])||a.name.localeCompare(b.name));
  const fragment=document.createDocumentFragment();
  visible.forEach((record,index)=>{
    const item=$('#repository-template').content.cloneNode(true);
    item.querySelector('.record-number').textContent=String(index+1).padStart(2,'0');
    item.querySelector('.category-name').textContent=record.category.replace(/^\d+\s+/,'');
    const status=item.querySelector('.status');status.textContent=catalog.statusLabels[record.status];status.classList.add(record.status);
    const button=item.querySelector('.open-detail');button.textContent=record.title===record.name?record.name:record.title+' · '+record.name;button.addEventListener('click',()=>openDetail(record,button));
    item.querySelector('.record-summary').textContent=record.summary;
    if(record.courseTitle){const course=item.querySelector('.record-course');course.hidden=false;course.textContent='可拆课方向：'+record.courseTitle}
    item.querySelector('.license-note').textContent=record.licenseLabel;
    item.querySelector('.proof').textContent=record.proof+' · 推送 '+record.updated;
    const upstream=item.querySelector('.upstream');upstream.href=safeUrl(record.url)||'https://github.com/datawhalechina';upstream.setAttribute('aria-label','查看 '+record.name+' 上游仓库');
    fragment.append(item);
  });
  $('#repository-list').replaceChildren(fragment);
  $('#result-count').textContent=String(visible.length);
  $('#scope-label').textContent=labels[s.mode]||labels.study;
  $('#summary-count').textContent=`总计 ${catalog.total} 个仓库 · ${catalog.featuredCount} 个母本`;
  $('#message').textContent=s.q.trim()?'搜索：'+s.q.trim()+'。资料状态与许可线索请结合详情判断。':'点击项目名称查看范围、门槛、缺口和上游章节。';
  $('#empty').hidden=visible.length>0;
  if(sync)updateUrl();
}
function section(title,paragraphs){const box=node('section',null,'detail-section');box.append(node('h3',title));for(const text of paragraphs.filter(Boolean))box.append(node('p',text));return box}
function openDetail(record,opener=null){
  lastOpener=opener;
  const body=$('#detail-content');body.replaceChildren();
  body.append(node('p',record.category.replace(/^\d+\s+/,''),'detail-subtitle'));
  const heading=node('h2',record.title);heading.id='detail-title';body.append(heading,node('p',record.name+' · '+catalog.statusLabels[record.status],'detail-subtitle'),node('p',record.summary,'detail-summary'));
  body.append(section('内容状态与依据',[record.reason,...record.notes]));
  body.append(section('学习范围与进入门槛',[record.scope,record.prerequisites]));
  if(record.courseTitle)body.append(section('适合怎样简化',[record.courseTitle,record.outcome?'目标作品：'+record.outcome:null,record.priority?'选题批次：'+record.priority:null]));
  body.append(section('材料许可线索',[record.licenseLabel,record.licenseNote]));
  if(record.entries.length){const entries=section('部分目录入口',[]);const list=node('ul');for(const entry of record.entries){const a=link(entry.title,entry.url);if(a){const li=node('li');li.append(a);list.append(li)}}entries.append(list,node('p',`已识别 ${record.entryCount} 个导航入口；这里展示部分入口，完整内容请查看上游目录。`));body.append(entries)}
  const actions=node('div',null,'detail-actions');for(const [label,url] of [['打开上游仓库 ↗',record.url],['阅读项目说明 ↗',record.readme]]){const a=link(label,url);if(a)actions.append(a)}body.append(actions,node('p','资料快照 '+catalog.asOf+'。本页不执行项目代码；文档路径数不等于课程数。','detail-scope'));
  history.replaceState(null,'',location.pathname+location.search+'#'+encodeURIComponent(record.name));
  if(!$('#detail').open)$('#detail').showModal();
  $('#detail').scrollTop=0;
}
async function load(){
  try{
    const response=await fetch(new URL('./catalog.json',import.meta.url),{cache:'no-cache'});
    if(!response.ok)throw new Error('资料文件暂时不可用');
    const data=await response.json();
    if(data.total!==223||!Array.isArray(data.repositories)||data.repositories.length!==data.total||new Set(data.repositories.map(r=>r.name)).size!==data.total)throw new Error('资料文件不完整');
    catalog=data;
    for(const name of data.categories){const option=node('option',name.replace(/^\d+\s+/,''));option.value=name;inputs.category.append(option)}
    const params=new URLSearchParams(location.search);
    for(const [key,input] of Object.entries(inputs)){const value=params.get(key);if(value!==null&&(input.tagName==='INPUT'||Array.from(input.options).some(option=>option.value===value)))input.value=value;input.disabled=false}
    $('#reset').disabled=false;$('#reload').hidden=true;
    render(false);
    const target=catalog.repositories.find(r=>r.name===hashName());if(target)openDetail(target);
  }catch(error){$('#message').textContent='资料未能载入。请检查连接后重新载入。';$('#summary-count').textContent='暂时无法读取资料';$('#reload').hidden=false;$('#empty').hidden=true;$('#result-count').textContent='—'}
}
form.addEventListener('submit',event=>event.preventDefault());
form.addEventListener('input',event=>{if(catalog&&event.target===inputs.q)render()});
form.addEventListener('change',event=>{if(catalog&&event.target.tagName==='SELECT')render()});
form.addEventListener('reset',event=>{event.preventDefault();inputs.q.value='';inputs.mode.value='study';inputs.category.value='';inputs.license.value='';inputs.sort.value='recommended';if(catalog)render()});
$('#close-detail').addEventListener('click',()=>$('#detail').close());
$('#detail').addEventListener('close',()=>{history.replaceState(null,'',location.pathname+location.search);lastOpener?.focus();lastOpener=null});
$('#reload').addEventListener('click',()=>location.reload());
window.addEventListener('hashchange',()=>{if(!catalog)return;const target=catalog.repositories.find(r=>r.name===hashName());if(target)openDetail(target);else if($('#detail').open)$('#detail').close()});
load();
