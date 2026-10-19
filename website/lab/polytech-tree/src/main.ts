// V3: V1's cached coordinates, batched real network, bounded foreground; no browsing-time physics.
import * as THREE from 'three'
import { TECHS, ERA_INFO, CATEGORY_NAMES, YEAR_BASIS_LABEL } from './data'
import { DISPLAY_HEX } from './presentation'
import { createScene } from './demo-scene'
import { CameraRig } from './controls'
import { buildNameLabels } from './labels'
import { loadNetwork } from './network-data'
import { NetworkRenderer } from './network-render'
import { ProjectedIndex } from './network-projection'
import type { PlacedNode } from './layout'

const el=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T
const escapeText=(text:string)=>text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
const frame=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()))

export async function mount(report:(value:number,message:string)=>void,fail:(message:string)=>void){
  const started=performance.now(),events=new AbortController(),{signal}=events
  const interactive=document.querySelectorAll<HTMLElement>('.explore-tools,.branch-bar,.branch-pager,.reader,.view-controls')
  interactive.forEach(element=>element.setAttribute('inert',''))
  report(35,'读取完整知识网络与已缓存的V1坐标');await frame()
  const data=await loadNetwork(),nodes=data.placed.map(p=>p.node),mobile=matchMedia('(max-width:700px)').matches,motion=matchMedia('(prefers-reduced-motion:reduce)')
  const {scene,camera,renderer}=createScene(data.towerHeight,[100]),host=el('scene')
  const network=new NetworkRenderer(data);scene.add(network.group)
  const projection=new ProjectedIndex(data),rig=new CameraRig(camera,renderer.domElement,data.towerHeight,null,data.placed.map(p=>p.position))
  rig.controls.mouseButtons.LEFT=THREE.MOUSE.PAN;rig.controls.mouseButtons.RIGHT=THREE.MOUSE.ROTATE
  rig.controls.touches.ONE=THREE.TOUCH.PAN;rig.controls.touches.TWO=THREE.TOUCH.DOLLY_PAN
  rig.controls.zoomToCursor=true;rig.controls.screenSpacePanning=true
  const era=el<HTMLSelectElement>('era'),category=el<HTMLSelectElement>('category'),picker=el<HTMLSelectElement>('node'),search=el<HTMLInputElement>('search')
  const tour=el<HTMLButtonElement>('tour'),limit=el<HTMLInputElement>('labels'),tooltip=el('node-tooltip')
  const performanceMode=el<HTMLSelectElement>('performance'),linesToggle=el<HTMLButtonElement>('lines-toggle')
  const normalized=nodes.map(n=>`${n.name} ${n.nameEn} ${n.id}`.normalize('NFKC').toLocaleLowerCase())
  const dependents=new Map<string,string[]>();nodes.forEach(n=>n.prereqs.forEach(id=>{const list=dependents.get(id)??[];list.push(n.id);dependents.set(id,list)}))
  const domainLabels:PlacedNode[]=CATEGORY_NAMES.map((name,cat)=>{
    const members=data.placed.filter(p=>p.node.category===cat),center=new THREE.Vector3()
    members.forEach(p=>center.add(p.position));center.divideScalar(Math.max(1,members.length))
    const anchor=[...members].sort((a,b)=>a.position.distanceToSquared(center)-b.position.distanceToSquared(center))[0]
    return {...anchor,node:{...anchor.node,id:`category:${cat}`,name,importance:1}}
  })
  const labelPlaced=[...data.placed,...domainLabels],names=buildNameLabels(labelPlaced)
  let width=host.clientWidth,height=host.clientHeight,disposed=false,animation=0,inViewport=true,dirty=true
  let selected:number|null=null,hover:number|null=null,pending:PointerEvent|null=null,path:number[]=[],history:number[]=[]
  let labelLimit=mobile?16:32,neighborPage=0,searchShown=30,economy=mobile,touring=false,tourTime=0,tourEra=0
  let lod=1,lodTarget=1,initialDistance=600,renderedKey='',down={x:0,y:0,id:-1,time:0,moved:false}
  const pointers=new Set<number>(),active=new Uint8Array(nodes.length).fill(1)
  const rankScores=new Float32Array(nodes.length)
  let focusKey='',filterKey='',filtered:number[]=nodes.map((_,i)=>i),lastProjectionTime=-1
  const orientation=new THREE.Vector3(1,.22,1).normalize()
  function updateAttribute(name:string,value:string|number){if(host.dataset[name]!==String(value))host.dataset[name]=String(value)}
  function matching(index:number){const n=nodes[index];return (era.value===''||n.era===Number(era.value))&&(category.value===''||n.category===Number(category.value))}
  function searchAll(){const q=search.value.trim().normalize('NFKC').toLocaleLowerCase();return q?normalized.flatMap((name,i)=>name.includes(q)?[i]:[]):[]}
  function stopTour(){touring=false;rig.controls.autoRotate=false;tour.textContent=motion.matches?'逐时代查看':'开始漫游';tour.setAttribute('aria-pressed','false')}
  function fit(indices:number[],animate=true){
    if(!indices.length)return
    const bounds=new THREE.Box3().setFromPoints(indices.map(i=>data.placed[i].position)).expandByScalar(8)
    rig.frameBounds(bounds,animate,orientation)
  }
  function overview(animate=true){
    stopTour();selected=null;hover=null;path=[];history=[];neighborPage=0;era.value='';category.value='';tooltip.hidden=true
    if(animate)rig.resetView();else rig.fitInitial()
    dirty=true;showDefault();updateNavigation()
  }
  function adjacency(index:number){return data.adj[index]??[]}
  function shortestPath(start:number,end:number){
    const parent=new Int32Array(nodes.length).fill(-1),queue=[start];parent[start]=start
    for(let head=0;head<queue.length&&parent[end]===-1;head++)for(const next of adjacency(queue[head]))if(parent[next]===-1){parent[next]=queue[head];queue.push(next)}
    if(parent[end]===-1)return []
    const result=[end];while(result[result.length-1]!==start)result.push(parent[result[result.length-1]])
    return result.reverse()
  }
  function showDefault(){
    el('detail').innerHTML=`<div class="reading-guide"><h3>知识彼此相连。</h3><p>沿着时间的纵深，探索人类科技文明的演进。</p><p class="network-total">${nodes.length.toLocaleString('zh-CN')} 项知识 · ${CATEGORY_NAMES.length} 个领域</p><dl><dt>远看文明全景</dt><dd>微点均对应真实知识，细线源于原始依赖或相关关系。</dd><dt>放大，沿着分支深入</dt><dd>拖动平移，滚轮以指针为中心缩放；右键拖动旋转。</dd><dt>从一个问题开始</dt><dd>搜索全部知识，或点选节点查看它的前置、后续与相关技术。</dd></dl><div class="domain-links">${CATEGORY_NAMES.map((name,i)=>`<button type="button" data-category="${i}"><i style="background:${DISPLAY_HEX[i]}"></i>${escapeText(name)}</button>`).join('')}</div></div>`
  }
  function tags(ids:string[],empty:string){return ids.filter(id=>data.byId.has(id)).map(id=>`<button type="button" class="knowledge-tag" data-locate="${escapeText(id)}">${escapeText(nodes[data.byId.get(id)!].name)}</button>`).join('')||`<span class="empty-note">${empty}</span>`}
  function showNode(){
    if(selected===null){showDefault();return}
    const n=nodes[selected],year=`${YEAR_BASIS_LABEL[n.yearBasis]?.approx?'约':''}${n.year<0?'公元前':''}${Math.abs(n.year).toLocaleString('zh-CN')}年`
    el('detail').innerHTML=`<h3>${escapeText(n.name)}</h3><p class="node-meta">${year} · ${ERA_INFO[n.era].name}<br><span class="category-key" style="--category:${DISPLAY_HEX[n.category]}">${escapeText(CATEGORY_NAMES[n.category])}</span></p><p class="node-description">${escapeText(n.desc||'原始索引暂未提供详细摘要。')}</p><h4>前置知识</h4><div class="knowledge-tags">${tags(n.prereqs,'本索引尚未列出前置知识')}</div><h4>后续依赖</h4><div class="knowledge-tags">${tags(dependents.get(n.id)??[],'本索引尚未列出后续依赖')}</div><h4>关键应用</h4><p class="node-meta">原始数据未单独提供应用清单；可沿后续依赖探索技术的延伸，不将依赖等同于实际应用。</p><h4>相关知识推荐</h4><div class="knowledge-tags">${tags(n.related,'本索引尚未列出相关技术')}</div>${path.length>1?`<p class="node-meta">已高亮与上次选择之间的 ${path.length-1} 步真实关联路径；关联路径不等同于因果链。</p>`:''}${n.wikiEn?`<p class="node-source">摘要参考 Wikipedia contributors：<a href="https://en.wikipedia.org/wiki/${encodeURIComponent(n.wikiEn)}" target="_blank" rel="noopener">${escapeText(n.wikiEn)}</a>，CC BY-SA 4.0。</p>`:''}`
  }
  function select(index:number,record=true){
    stopTour();if(!nodes[index])return
    if(record&&selected!==null&&selected!==index)history.push(selected)
    path=selected===null?[]:shortestPath(selected,index);selected=index;hover=null;neighborPage=0;pending=null
    era.value='';category.value='';el('search-results').hidden=true;search.value='';tooltip.hidden=true
    fit([index,...adjacency(index).slice(0,30)]);dirty=true;showNode();updateNavigation()
  }
  function clearSelection(){stopTour();selected=null;hover=null;path=[];history=[];tooltip.hidden=true;dirty=true;showDefault();updateNavigation()}
  function back(){const previous=history.pop();if(previous!==undefined)select(previous,false);else overview()}
  function updateNavigation(){
    const crumbs=['<button type="button" data-overview>文明全景</button>']
    if(selected!==null)crumbs.push(`<button type="button" data-category="${nodes[selected].category}">${escapeText(CATEGORY_NAMES[nodes[selected].category])}</button>`,`<span aria-current="page">${escapeText(nodes[selected].name)}</span>`)
    else if(category.value!=='')crumbs.push(`<span aria-current="page">${escapeText(CATEGORY_NAMES[Number(category.value)])}</span>`)
    el('breadcrumbs').innerHTML=crumbs.join('<span class="crumb-divider" aria-hidden="true">/</span>')
    el('branch-actions').hidden=selected===null&&category.value===''
    el<HTMLButtonElement>('up').disabled=history.length===0&&selected===null;el<HTMLButtonElement>('collapse').disabled=selected===null
    el('clear').hidden=selected===null
    const pages=selected===null?1:Math.max(1,Math.ceil(adjacency(selected).length/30))
    neighborPage=Math.min(neighborPage,pages-1)
    el<HTMLButtonElement>('prev').disabled=neighborPage===0;el<HTMLButtonElement>('next').disabled=neighborPage>=pages-1
    el('page-number').textContent=`${neighborPage+1} / ${pages}`
    el('branch-context').textContent=selected===null?'背景保留完整网络 · 标签与前景按需呈现':`共 ${adjacency(selected).length} 项直接关联 · 当前前景第 ${neighborPage+1} 页；其余仍保留在背景网络`
  }
  function chooseCategory(cat:number){stopTour();selected=null;hover=null;path=[];history=[];category.value=String(cat);era.value='';dirty=true;showDefault();fit(nodes.flatMap((n,i)=>n.category===cat?[i]:[]));updateNavigation()}
  function showSearch(){
    const results=searchAll(),shown=results.slice(0,searchShown);el('search-results').hidden=!search.value.trim()
    el('search-status').textContent=results.length?`找到 ${results.length} 项，已显示 ${shown.length} 项`:'未找到知识，请换一个关键词。'
    el('search-list').innerHTML=shown.map(i=>`<li><button type="button" data-locate="${escapeText(nodes[i].id)}">${escapeText(nodes[i].name)}<span>${escapeText(CATEGORY_NAMES[nodes[i].category])}</span></button></li>`).join('')
    el<HTMLButtonElement>('search-more').hidden=shown.length===results.length
  }
  function pick(event:PointerEvent){
    for(const label of host.querySelectorAll<HTMLElement>('.tree-label:not([hidden])')){
      const rect=label.getBoundingClientRect()
      if(event.clientX>=rect.left&&event.clientX<=rect.right&&event.clientY>=rect.top&&event.clientY<=rect.bottom){const id=label.dataset.node!;return id.startsWith('category:')?id:data.byId.get(id)??null}
    }
    if(projection.update(camera,width,height))dirty=true
    const rect=renderer.domElement.getBoundingClientRect();return projection.hit(event.clientX-rect.left,event.clientY-rect.top,event.pointerType==='touch'?14:7)
  }
  function refreshVisible(){
    const nextFilterKey=`${era.value}/${category.value}`
    if(nextFilterKey!==filterKey){filterKey=nextFilterKey;filtered=nodes.flatMap((_,i)=>matching(i)?[i]:[]);active.fill(0);filtered.forEach(i=>active[i]=1)}
    const main=hover??selected,focus=main===null?[]:[main,...adjacency(main),...path]
    if(selected!==null&&selected!==main)focus.push(selected,...adjacency(selected))
    const nextFocusKey=`${selected}/${hover}/${filterKey}/${path.join(',')}`
    if(nextFocusKey!==focusKey){focusKey=nextFocusKey;network.setFocus(focus.length?[...new Set(focus)]:filtered.length!==nodes.length?filtered:[],path,main,selected===null?.72:.18)}
    const near=projection.visible.filter(i=>active[i])
    near.forEach(i=>rankScores[i]=nodes[i].importance*1000+data.placed[i].position.distanceToSquared(rig.controls.target)/100)
    near.sort((a,b)=>rankScores[a]-rankScores[b])
    const candidates:number[]=[]
    if(selected!==null)candidates.push(selected,...adjacency(selected).slice(neighborPage*30,(neighborPage+1)*30))
    if(hover!==null)candidates.unshift(hover,...adjacency(hover).slice(0,12))
    const foreground=[...new Set([...candidates,...(main===null?near:path)])].filter(i=>projection.projected[i*3+2]>=-1&&projection.projected[i*3+2]<=1).slice(0,60)
    network.setViewport(projection.visible,projection.projected,lod,economy,foreground)
    const mask=new Int8Array(labelPlaced.length).fill(-1)
    const labelCandidates=[...foreground]
    if(main===null&&lod<1.7&&category.value==='')labelCandidates.unshift(...domainLabels.map((_,i)=>nodes.length+i))
    labelCandidates.forEach(i=>mask[i]=i===main?0:1)
    names.setFocus(mask);names.setCandidates(labelCandidates)
    const key=foreground.join(',')
    if(key!==renderedKey){picker.innerHTML='<option value="">选择重点知识</option>'+foreground.map(i=>`<option value="${i}">${escapeText(nodes[i].name)}</option>`).join('');renderedKey=key}
    picker.value=selected===null?'':String(selected)
    const stats=network.stats
    updateAttribute('totalNodes',nodes.length);updateAttribute('renderedNodes',stats.points);updateAttribute('foregroundNodes',stats.foreground)
    updateAttribute('totalEdges',data.edges.length);updateAttribute('renderedEdges',stats.edges);updateAttribute('highlightEdges',stats.highlightEdges);updateAttribute('lod',selected===null?lodTarget:4)
    updateAttribute('layoutRuns',0);updateAttribute('layoutSource','cached-v1');updateAttribute('level',selected===null?'network':'knowledge')
    updateAttribute('selectedId',selected===null?'':nodes[selected].id)
    el('scene-status').textContent=`全库 ${nodes.length} 项 · 视口 ${stats.points} 微点 · 前景 ${stats.foreground} 项 · ${stats.edges} 条关系${selected!==null?' · 知识详情':lodTarget===1?' · 文明全景':lodTarget===2?' · 领域探索':' · 知识探索'}${filtered.length!==nodes.length?` · 筛选 ${filtered.length} 项`:''}`
  }
  let resize:ResizeObserver|undefined,visibility:IntersectionObserver|undefined
  function dispose(){
    if(disposed)return;disposed=true;cancelAnimationFrame(animation);events.abort();resize?.disconnect();visibility?.disconnect();rig.dispose();names.dispose();network.dispose()
    renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();tooltip.hidden=true;host.dataset.disposed='true'
  }
  try{
    report(65,'批量准备真实微点与关系线');await frame()
    era.innerHTML='<option value="">所有时代</option>'+ERA_INFO.map((e,i)=>`<option value="${i}">${e.name}</option>`).join('')
    category.innerHTML='<option value="">所有领域</option>'+CATEGORY_NAMES.map((n,i)=>`<option value="${i}">${escapeText(n)}</option>`).join('')
    el('legend').innerHTML=CATEGORY_NAMES.map((name,i)=>`<span><i style="background:${DISPLAY_HEX[i]}"></i>${escapeText(name)}</span>`).join('')
    limit.value=String(labelLimit);el('label-count').textContent=String(labelLimit);performanceMode.value=economy?'economy':'quality'
    overview(false);initialDistance=camera.position.distanceTo(rig.controls.target)
    el('reset').addEventListener('click',()=>overview(),{signal});el('overview').addEventListener('click',()=>overview(),{signal});el('collapse').addEventListener('click',clearSelection,{signal});el('clear').addEventListener('click',clearSelection,{signal});el('up').addEventListener('click',back,{signal})
    for(const [id,delta] of [['prev',-1],['next',1]] as const)el(id).addEventListener('click',()=>{neighborPage=Math.max(0,neighborPage+delta);updateNavigation();if(selected!==null)fit([selected,...adjacency(selected).slice(neighborPage*30,(neighborPage+1)*30)]);dirty=true},{signal})
    document.querySelector('.experience')!.addEventListener('click',event=>{
      const target=(event.target as HTMLElement).closest<HTMLElement>('[data-locate],[data-category],[data-overview]');if(!target)return
      if(target.dataset.locate){const i=data.byId.get(target.dataset.locate);if(i!==undefined)select(i)}
      else if(target.dataset.category!==undefined)chooseCategory(Number(target.dataset.category))
      else overview()
    },{signal})
    for(const input of [era,category])input.addEventListener('change',()=>{stopTour();selected=null;hover=null;path=[];history=[];dirty=true;fit(nodes.flatMap((_,i)=>matching(i)?[i]:[]));showDefault();updateNavigation()},{signal})
    picker.addEventListener('change',()=>{if(picker.value!=='')select(Number(picker.value))},{signal})
    search.addEventListener('input',()=>{searchShown=30;showSearch()},{signal})
    el('search-more').addEventListener('click',()=>{searchShown+=30;showSearch()},{signal})
    search.addEventListener('keydown',event=>{
      if(event.key==='Escape'){el('search-results').hidden=true;return}
      if(event.key==='ArrowDown'){event.preventDefault();el('search-list').querySelector<HTMLButtonElement>('button')?.focus()}
      if(event.key==='Enter'){event.preventDefault();const i=searchAll()[0];if(i!==undefined)select(i)}
    },{signal})
    el('search-results').addEventListener('keydown',event=>{
      if(event.key==='Escape'){el('search-results').hidden=true;search.focus()}
      if(!['ArrowDown','ArrowUp'].includes(event.key))return
      const buttons=[...el('search-list').querySelectorAll('button')],i=buttons.indexOf(document.activeElement as HTMLButtonElement)
      event.preventDefault();buttons[THREE.MathUtils.clamp(i+(event.key==='ArrowDown'?1:-1),0,buttons.length-1)]?.focus()
    },{signal})
    document.addEventListener('click',event=>{if(!(event.target as HTMLElement).closest('.search-control'))el('search-results').hidden=true},{signal})
    limit.addEventListener('input',()=>{labelLimit=Number(limit.value);el('label-count').textContent=String(labelLimit);dirty=true},{signal})
    performanceMode.addEventListener('change',()=>{economy=performanceMode.value==='economy';renderer.setPixelRatio(Math.min(devicePixelRatio,economy?1:2));renderer.setSize(width,height);dirty=true},{signal})
    linesToggle.addEventListener('click',()=>{const enabled=linesToggle.getAttribute('aria-pressed')!=='true';linesToggle.setAttribute('aria-pressed',String(enabled));linesToggle.textContent=enabled?'隐藏关系线':'显示关系线';network.toggleLines(enabled);dirty=true},{signal})
    function zoom(factor:number){stopTour();rig.cancelTransition();const offset=camera.position.clone().sub(rig.controls.target);offset.setLength(THREE.MathUtils.clamp(offset.length()*factor,rig.controls.minDistance,rig.controls.maxDistance));camera.position.copy(rig.controls.target).add(offset);rig.controls.update()}
    el('zoom-in').addEventListener('click',()=>zoom(.8),{signal});el('zoom-out').addEventListener('click',()=>zoom(1.25),{signal})
    tour.addEventListener('click',()=>{
      if(touring){stopTour();return}
      if(motion.matches){era.value=String(tourEra++%ERA_INFO.length);selected=null;dirty=true;fit(nodes.flatMap((n,i)=>n.era===Number(era.value)?[i]:[]),false);showDefault();updateNavigation();return}
      touring=true;tourTime=0;rig.controls.autoRotate=true;tour.textContent='停止漫游';tour.setAttribute('aria-pressed','true')
    },{signal})
    rig.controls.addEventListener('start',()=>{stopTour();pending=null;hover=null;tooltip.hidden=true;dirty=true})
    motion.addEventListener('change',stopTour,{signal})
    renderer.domElement.addEventListener('pointerdown',event=>{pointers.add(event.pointerId);down={x:event.clientX,y:event.clientY,id:event.pointerId,time:performance.now(),moved:pointers.size>1}},{signal})
    renderer.domElement.addEventListener('pointermove',event=>{
      if(Math.hypot(event.clientX-down.x,event.clientY-down.y)>5)down.moved=true
      if(!event.buttons&&event.pointerType!=='touch')pending=event
    },{signal})
    renderer.domElement.addEventListener('pointerleave',()=>{hover=null;pending=null;tooltip.hidden=true;dirty=true;renderer.domElement.style.cursor='grab'},{signal})
    renderer.domElement.addEventListener('pointercancel',event=>{pointers.delete(event.pointerId);down.moved=true},{signal})
    renderer.domElement.addEventListener('pointerup',event=>{
      pointers.delete(event.pointerId);if(down.moved||event.button!==0||event.pointerId!==down.id||performance.now()-down.time>400)return
      const hit=pick(event);if(typeof hit==='number')select(hit);else if(typeof hit==='string')chooseCategory(Number(hit.slice(9)))
    },{signal})
    renderer.domElement.addEventListener('keydown',event=>{
      if(event.key==='Escape'){clearSelection();return}
      if(['+','='].includes(event.key)){event.preventDefault();zoom(.8);return}
      if(event.key==='-'){event.preventDefault();zoom(1.25);return}
      if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return
      event.preventDefault();stopTour();rig.cancelTransition()
      const offset=camera.position.clone().sub(rig.controls.target),spherical=new THREE.Spherical().setFromVector3(offset)
      if(event.key==='ArrowLeft')spherical.theta-=.12;if(event.key==='ArrowRight')spherical.theta+=.12;if(event.key==='ArrowUp')spherical.phi-=.12;if(event.key==='ArrowDown')spherical.phi+=.12
      spherical.makeSafe();camera.position.copy(rig.controls.target).add(new THREE.Vector3().setFromSpherical(spherical));rig.controls.update()
    },{signal})
    renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();fail('三维绘图上下文已中断。请关闭高显存占用页面后重新加载。')},{signal})
    resize=new ResizeObserver(()=>{width=host.clientWidth;height=host.clientHeight;if(!width||!height)return;camera.aspect=width/height;camera.updateProjectionMatrix();renderer.setSize(width,height);dirty=true});resize.observe(host)
    visibility=new IntersectionObserver(entries=>inViewport=entries[0]?.isIntersecting??false);visibility.observe(host)
    projection.update(camera,width,height,true);refreshVisible();dirty=false
    report(90,'编译批量图层，准备全景');await renderer.compileAsync(scene,camera)
    const clock=new THREE.Clock()
    function loop(){
      if(disposed)return;animation=requestAnimationFrame(loop);const dt=Math.min(clock.getDelta(),.1)
      if(document.hidden||!inViewport)return
      rig.update(dt)
      if(touring){tourTime+=dt;if(tourTime>=12){tourTime=0;tourEra=(tourEra+1)%ERA_INFO.length;fit(nodes.flatMap((n,i)=>n.era===tourEra?[i]:[]))}}
      const ratio=initialDistance/camera.position.distanceTo(rig.controls.target),next=ratio>3.4?3:ratio>1.65?2:1
      if(next!==lodTarget&&Math.abs(ratio-(lodTarget===1?1.65:lodTarget===3?3.4:next===1?1.65:3.4))>.08){lodTarget=next;dirty=true}
      const previousLod=lod
      lod=motion.matches?lodTarget:lod+(lodTarget-lod)*Math.min(1,dt*6)
      if(Math.abs(lod-previousLod)>.015)dirty=true
      // Camera matrices reach the GPU and DOM labels each frame. Only culling/hit-grid work is throttled.
      let changed=false
      if(dirty||clock.elapsedTime-lastProjectionTime>=1/30){changed=projection.update(camera,width,height);lastProjectionTime=clock.elapsedTime}
      if(pending){const event=pending;pending=null;const hit=pick(event),nextHover=typeof hit==='number'?hit:null
        if(nextHover!==hover){hover=nextHover;dirty=true}
        renderer.domElement.style.cursor=hit===null?'grab':'pointer';tooltip.hidden=hover===null
        if(hover!==null){const rect=renderer.domElement.getBoundingClientRect();tooltip.textContent=`${nodes[hover].name} · ${(nodes[hover].desc||'点击查看知识与关联').slice(0,100)}`;tooltip.style.left=`${Math.max(10,Math.min(width-260,event.clientX-rect.left+14))}px`;tooltip.style.top=`${Math.max(10,Math.min(height-80,event.clientY-rect.top+14))}px`}
      }
      if(changed||dirty){refreshVisible();dirty=false}
      names.update(camera,labelLimit,width,height)
      network.update(camera,height,renderer.getPixelRatio(),lod,dt);renderer.render(scene,camera)
    }
    loop();updateAttribute('initialRenderMs',Math.round(performance.now()-started));report(100,'完整科技网络已就绪');el('loading').hidden=true;interactive.forEach(element=>element.removeAttribute('inert'))
    return dispose
  }catch(error){dispose();throw error}
}
