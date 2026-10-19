// Rendering, layout, labels, graph and tour reused from Polytech Tree (secwind, MIT).
import * as THREE from 'three'
import { TECHS, ERA_INFO, CATEGORY_NAMES, YEAR_BASIS_LABEL, type TechNode } from './data'
import { CATEGORY_COLORS, DISPLAY_HEX } from './presentation'
import { layoutTower } from './layout'
import { createScene } from './demo-scene'
import { PolyhedraField } from './polyhedra'
import { buildEdges, buildEraRings } from './edges'
import { buildNameLabels, buildEraLabels, updateLabelFocal, clearLabelMaterials } from './labels'
import { CameraRig } from './controls'
import { TourPlan, BLEND } from './tour'
import { buildGraph, kHopDepth } from './graph'

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
const escapeText = (text: string) => text.replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!))

export async function mount(report: (value: number, message: string) => void, fail: (message: string) => void) {
  const mobile = matchMedia('(max-width: 700px)').matches
  const motion = matchMedia('(prefers-reduced-motion: reduce)')
  const events = new AbortController()
  const signal = events.signal
  // Mobile renders a deterministic core selection in every era, while keeping original data intact.
  const inputNodes = mobile ? TECHS.filter((n, i) => n.importance === 1 || (n.importance === 2 && i % 3 === 0)) : TECHS
  report(40, '按时代与领域组织知识节点')
  await frame()
  const { placed, eraRadii, eraY, towerHeight } = layoutTower(inputNodes)
  // Layout sorts by era/importance; picking, graph, filters and labels must share its index space.
  const nodes = placed.map(node => node.node)
  const { scene, camera, renderer } = createScene(towerHeight, eraRadii)
  const host=el('scene')
  let viewportW=host.clientWidth,viewportH=host.clientHeight,stageVisible=true
  let rig: CameraRig | undefined
  let observer: ResizeObserver | undefined
  let visibilityObserver: IntersectionObserver | undefined
  let animation = 0, disposed = false
  let disposeNames: (()=>void)|undefined
  function dispose() {
    if (disposed) return
    disposed = true
    cancelAnimationFrame(animation)
    events.abort(); observer?.disconnect();visibilityObserver?.disconnect(); rig?.dispose();disposeNames?.()
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>()
    scene.traverse(object => {
      const mesh = object as THREE.Mesh
      if (mesh.geometry) geometries.add(mesh.geometry)
      if (mesh.material) (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(material => materials.add(material))
    })
    materials.forEach(material => {
      Object.values(material).forEach(value => { if (value instanceof THREE.Texture) textures.add(value) })
      if (material instanceof THREE.ShaderMaterial) Object.values(material.uniforms).forEach(uniform => { if (uniform.value instanceof THREE.Texture) textures.add(uniform.value) })
      material.dispose()
    })
    geometries.forEach(geometry => geometry.dispose()); textures.forEach(texture => texture.dispose())
    clearLabelMaterials(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove()
    document.querySelector('.experience')?.setAttribute('data-disposed', 'true')
  }
  try {
    report(65, '准备多面体、关系线与文字图集')
    await frame()
    const field = new PolyhedraField(placed, CATEGORY_COLORS)
    field.meshes.forEach(mesh => scene.add(mesh))
    field.indicators.forEach(mesh => scene.add(mesh))
    const { rings } = buildEraRings(eraRadii, eraY)
    rings.forEach(ring => scene.add(ring))
    // Era glyphs are separate from the node-name budget: omit them on phones, not just hide their meshes.
    const names = buildNameLabels(placed), eras = mobile ? null : buildEraLabels(eraRadii, eraY)
    disposeNames=names.dispose
    eras?.meshes.forEach(mesh => scene.add(mesh))
    const plan = new TourPlan(placed, eraRadii, eraY)
    rig = new CameraRig(camera, renderer.domElement, towerHeight, plan, placed.map(p=>p.position))
    const cameraRig = rig
    cameraRig.fitInitial()
    const edges = buildEdges(placed, plan.revealAt)
    scene.add(edges.lines)
    const graph = buildGraph(nodes.map(n => n.id), nodes.map(n => n.prereqs))
    const byId = new Map(TECHS.map(n => [n.id, n]))
    let focus: Int8Array | null = null, selected: number | null = null
    let hover: number | null = null, labels = mobile ? 8 : 24, visibleCount = nodes.length
    let lastHover: number | null = null
    let pendingPointer:PointerEvent|null=null
    const visibility = new Uint8Array(nodes.length), active = new Uint8Array(nodes.length)
    const eraSelect = el<HTMLSelectElement>('era'), category = el<HTMLSelectElement>('category'), nodeSelect = el<HTMLSelectElement>('node')
    const tourButton = el<HTMLButtonElement>('tour'), clear = el<HTMLButtonElement>('clear')
    eraSelect.innerHTML = '<option value="">所有时代</option>' + ERA_INFO.map((era, i) => `<option value="${i}">${era.name}</option>`).join('')
    category.innerHTML = '<option value="">所有领域</option>' + CATEGORY_NAMES.map((name, i) => `<option value="${i}">${name}</option>`).join('')
    el('legend').innerHTML = CATEGORY_NAMES.map((name, i) => `<span><i style="background:${DISPLAY_HEX[i]}"></i>${escapeText(name)}</span>`).join('')
    const year = (n: TechNode) => `${YEAR_BASIS_LABEL[n.yearBasis]?.approx ? '约' : ''}${n.year < 0 ? '公元前' : ''}${Math.abs(n.year).toLocaleString('zh-CN')}年`
    function showNode(index: number) {
      const n = nodes[index]
      const tags = (ids: string[], empty: string) => ids.map(id => byId.get(id)?.name).filter(Boolean).map(name => `<span class="knowledge-tag">${escapeText(name!)}</span>`).join('') || `<span class="empty-note">${empty}</span>`
      el('detail').innerHTML = `<h3>${escapeText(n.name)}</h3><p class="node-meta">${year(n)} · ${ERA_INFO[n.era].name}<br><span class="category-key" style="--category:${DISPLAY_HEX[n.category]}">${CATEGORY_NAMES[n.category]}</span></p><p class="node-description">${escapeText(n.desc || '该技术尚未提供详细摘要。')}</p><h4>前置知识</h4><div class="knowledge-tags">${tags(n.prereqs, '本索引尚未列出前置知识')}</div><h4>相关技术</h4><div class="knowledge-tags">${tags(n.related, '可通过图中关系线探索')}</div>${selected === index ? '<p class="node-meta focus-note">已聚焦两跳内的前置关系；不在当前精选范围的技术仍在文字中保留。</p>' : ''}${n.wikiEn ? `<p class="node-source">摘要参考 Wikipedia contributors：<a href="https://en.wikipedia.org/wiki/${encodeURIComponent(n.wikiEn)}" target="_blank" rel="noopener">${escapeText(n.wikiEn)}</a>，CC BY-SA 4.0。</p>` : ''}`
    }
    function apply() {
      visibleCount = 0
      nodes.forEach((n, i) => {
        visibility[i] = (eraSelect.value === '' || n.era === Number(eraSelect.value)) && (category.value === '' || n.category === Number(category.value)) ? 1 : 0
        visibleCount += visibility[i]
      })
      if (selected !== null && !visibility[selected]) { selected = null; focus = null }
      nodes.forEach((_, i) => { active[i] = visibility[i] && (!focus || focus[i] >= 0) ? 1 : 0 })
      field.setVisible(i => active[i] > 0, focus); names.setFilter(i => active[i] > 0); names.setFocus(focus)
      rings.forEach(ring => { ring.visible = focus === null })
      eras?.meshes.forEach(mesh => { mesh.visible = focus === null })
      edges.setActive(active); edges.setEmphasis(focus)
      nodeSelect.innerHTML = '<option value="">选择节点，查看关联</option>' + nodes.map((n, i) => visibility[i] ? `<option value="${i}">${escapeText(n.name)}</option>` : '').join('')
      nodeSelect.value = selected === null ? '' : String(selected)
      clear.hidden = selected === null
      el('scene-status').textContent = `${mobile ? '移动精选 · ' : ''}${focus ? active.reduce((a,b)=>a+b,0) : visibleCount} / ${nodes.length} 项科技 · ${ERA_INFO.length} 个时代${visibleCount === 0 ? ' · 当前筛选没有节点，请调整筛选' : ''}`
      if (selected === null) el('detail').innerHTML = '<div class="reading-guide"><p>时间向上生长，<br>知识彼此相连。</p><dl><dt>纵览科技脉络</dt><dd>拖动旋转，滚轮或双指缩放。</dd><dt>找到感兴趣的领域</dt><dd>通过时代、领域或知识节点筛选。</dd><dt>沿着关系深入</dt><dd>点选一项科技，查看它的前置知识与关联技术。</dd></dl><p class="node-meta">高度代表时代，颜色区分领域，形状对应重要度。</p></div>'
    }
    function select(index: number | null) {
      pendingPointer=null;hover = null; lastHover = null; names.setHover(null); field.highlight(null)
      selected = selected === index ? null : index
      focus = selected === null ? null : kHopDepth(graph, selected, 2, new Int8Array(nodes.length))
      apply()
      if (selected !== null) {
        showNode(selected)
        // Frame the visible relationship subgraph, not the thousands of unrelated nodes.
        // User interaction interrupts the transition; reduced motion remains immediate.
        const bounds = new THREE.Box3()
        placed.forEach((node, i) => { if (active[i]) bounds.expandByPoint(node.position) })
        bounds.expandByScalar(12)
        cameraRig.frameBounds(bounds)
      } else cameraRig.resetView()
    }
    function endTour() {
      field.endTour(); edges.fillAll(); names.invalidate(); eras?.setVisibleThrough(ERA_INFO.length - 1)
      rings.forEach(ring => ring.visible = true)
      camera.fov = 55; camera.updateProjectionMatrix()
      tourButton.textContent = motion.matches ? '逐时代查看' : '开始漫游'; tourButton.setAttribute('aria-pressed','false')
      apply()
    }
    cameraRig.onTourEnd = endTour
    cameraRig.onEraChange = i => { el('scene-status').textContent = `正在漫游 · ${ERA_INFO[i].name} · ${ERA_INFO[i].range}` }
    tourButton.textContent = motion.matches ? '逐时代查看' : '开始漫游'
    tourButton.setAttribute('aria-pressed','false')
    tourButton.addEventListener('click', () => {
      if (motion.matches) {
        eraSelect.value = String((eraSelect.value === '' ? -1 : Number(eraSelect.value)) + 1 >= ERA_INFO.length ? 0 : Number(eraSelect.value || -1) + 1)
        apply(); return
      }
      if (cameraRig.mode === 'tour') { cameraRig.stopTour(); return }
      select(null); eraSelect.value = ''; category.value = ''; apply()
      cameraRig.startTour(); field.beginTour(plan.revealAt, 0); edges.beginTour()
      tourButton.textContent = '停止漫游'; tourButton.setAttribute('aria-pressed','true')
    }, { signal })
    const reset = () => { hover = null; lastHover = null; names.setHover(null); cameraRig.resetView(); eraSelect.value = ''; category.value = ''; selected = null; focus = null; endTour() }
    el('reset').addEventListener('click', reset, { signal })
    clear.addEventListener('click', () => select(null), { signal })
    for (const input of [eraSelect, category]) input.addEventListener('change', () => { cameraRig.stopTour(); apply() }, { signal })
    nodeSelect.addEventListener('change', () => { cameraRig.stopTour(); select(nodeSelect.value === '' ? null : Number(nodeSelect.value)) }, { signal })
    const limit = el<HTMLInputElement>('labels'); limit.value = String(labels); limit.max = String(mobile ? 24 : 100); el('label-count').textContent = String(labels)
    limit.addEventListener('input', () => { labels = Number(limit.value); el('label-count').textContent = String(labels) }, { signal })
    motion.addEventListener('change', () => { cameraRig.stopTour(); tourButton.textContent = motion.matches ? '逐时代查看' : '开始漫游' }, { signal })
    const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2()
    function pick(event: PointerEvent) {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1)
      camera.updateMatrixWorld();raycaster.setFromCamera(pointer, camera)
      return field.pick(raycaster)
    }
    let down = { x: 0, y: 0, time: 0, moved:false, pointer:-1 }
    const pointers = new Set<number>()
    renderer.domElement.addEventListener('pointermove', event => {
      if (event.pointerId === down.pointer && Math.hypot(event.clientX-down.x,event.clientY-down.y) > 5) down.moved = true
      if (cameraRig.mode === 'tour' || event.buttons || event.pointerType === 'touch') return
      pendingPointer=event
    }, { signal })
    renderer.domElement.addEventListener('pointerleave', () => { pendingPointer=null;hover = null; lastHover = null; names.setHover(null) }, { signal })
    renderer.domElement.addEventListener('pointerdown', event => { pointers.add(event.pointerId); down = {x:event.clientX,y:event.clientY,time:performance.now(),moved:pointers.size>1,pointer:event.pointerId} }, { signal })
    renderer.domElement.addEventListener('pointercancel', event => { pointers.delete(event.pointerId); down.moved = true }, { signal })
    renderer.domElement.addEventListener('pointerup', event => {
      pointers.delete(event.pointerId)
      if (event.button !== 0 || down.moved || event.pointerId !== down.pointer || Math.hypot(event.clientX-down.x,event.clientY-down.y) > 5 || performance.now()-down.time > 400) return
      select(pick(event))
    }, { signal })
    renderer.domElement.addEventListener('keydown', event => {
      if (event.key === 'Escape') { cameraRig.stopTour(); select(null); return }
      if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-'].includes(event.key)) return
      event.preventDefault(); cameraRig.stopTour()
      cameraRig.cancelTransition()
      const offset = camera.position.clone().sub(cameraRig.controls.target)
      const spherical = new THREE.Spherical().setFromVector3(offset)
      if (event.key === 'ArrowLeft') spherical.theta -= .12
      if (event.key === 'ArrowRight') spherical.theta += .12
      if (event.key === 'ArrowUp') spherical.phi -= .12
      if (event.key === 'ArrowDown') spherical.phi += .12
      if (event.key === '+' || event.key === '=') spherical.radius *= .9
      if (event.key === '-') spherical.radius *= 1.1
      spherical.makeSafe(); spherical.radius = THREE.MathUtils.clamp(spherical.radius, cameraRig.controls.minDistance, cameraRig.controls.maxDistance)
      camera.position.copy(cameraRig.controls.target).add(new THREE.Vector3().setFromSpherical(spherical)); cameraRig.controls.update()
    }, { signal })
    renderer.domElement.addEventListener('webglcontextlost', event => { event.preventDefault(); fail('三维绘图上下文已中断。请关闭占用显存的标签页后重新加载，或先查看静态介绍。') }, { signal })
    let firstSize = true
    observer = new ResizeObserver(() => {
      viewportW=host.clientWidth;viewportH=host.clientHeight
      if(!viewportW||!viewportH)return
      camera.aspect = viewportW / viewportH; camera.updateProjectionMatrix()
      renderer.setSize(viewportW, viewportH); updateLabelFocal(viewportH, camera.fov)
      if (firstSize) { cameraRig.fitInitial(); firstSize = false }
      else if (cameraRig.mode === 'orbit') {
        if (selected !== null) { const bounds = new THREE.Box3(); placed.forEach((p,i)=>{if(active[i])bounds.expandByPoint(p.position)}); cameraRig.frameBounds(bounds.expandByScalar(12),false) }
        else cameraRig.fitInitial()
      }
    }); observer.observe(host)
    visibilityObserver=new IntersectionObserver(entries=>{stageVisible=entries[0]?.isIntersecting??false});visibilityObserver.observe(host)
    apply()
    field.update(0); updateLabelFocal(viewportH, camera.fov)
    report(90, '准备第一帧')
    await renderer.compileAsync(scene, camera)
    if (disposed) return dispose
    const clock = new THREE.Clock(), nameIdx = new Int32Array(nodes.length), nameAlpha = new Float32Array(nodes.length)
    function loop() {
      if (disposed) return
      animation = requestAnimationFrame(loop)
      const dt = Math.min(clock.getDelta(), .1)
      if (document.hidden||!stageVisible) return
      cameraRig.update(dt)
      if (cameraRig.mode === 'tour') {
        const t = cameraRig.tourT - BLEND
        camera.fov = plan.fovAt(t); camera.updateProjectionMatrix(); updateLabelFocal(viewportH, camera.fov)
        field.setTourTime(t); field.update(clock.elapsedTime); edges.update(t)
        const era = plan.eraOf(t); eras?.setVisibleThrough(era); rings.forEach((ring, i) => ring.visible = i <= era)
        names.setTourNames(Math.max(0, plan.collectNames(t, nameIdx, nameAlpha)), nameIdx, nameAlpha)
        names.update(camera, labels, viewportW, viewportH, eras?.update(camera,viewportW,viewportH))
      } else {
        field.update(motion.matches ? 0 : clock.elapsedTime)
        if(pendingPointer){const event=pendingPointer;pendingPointer=null;hover=pick(event);names.setHover(hover);if(hover!==null&&hover!==lastHover&&selected===null)showNode(hover);lastHover=hover;renderer.domElement.style.cursor=hover===null?'grab':'pointer'}
        field.highlight(hover)
        names.update(camera, labels, viewportW, viewportH, eras?.update(camera,viewportW,viewportH))
      }
      field.updateIndicators(camera)
      renderer.render(scene, camera)
    }
    loop(); report(100, '知识空间已就绪')
    el('loading').hidden = true; document.querySelector('.explore-tools')!.removeAttribute('inert')
    return dispose
  } catch (error) { dispose(); throw error }
}
