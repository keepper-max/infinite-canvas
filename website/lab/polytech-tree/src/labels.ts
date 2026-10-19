import * as THREE from 'three'
import { geomRadius, type PlacedNode } from './layout'
import { ERA_INFO } from './data'

// 文字标签：Canvas 图集 + 实例化 billboard（始终正对摄像机）
// 图集支持变宽条目：每个条目有自己的 UV 矩形与宽高比（科技名称长短不一）
// 名称使用轻底板并抬离节点；时代名整词显示，两者共用屏幕空间避让。

export interface LabelData {
  position: THREE.Vector3
  uv: [number, number, number, number] // 条目 UV 矩形（u0, v0, du, dv）
  aspect: number                        // 条目宽高比（世界宽 = 高 × aspect）
  size: number                          // 世界单位高度
  always: boolean                       // 重要节点常显
  offset: number                        // 沿视线朝相机的偏移（避免被自身多面体遮挡）
}

interface AtlasPage {
  texture: THREE.Texture
  count: number // 本页条目数
}

const VERT = `
attribute vec3 aPos;
attribute vec4 aUv;
attribute float aAspect;
attribute float aSize;
attribute float aAlways;
attribute float aOffset;
attribute float aVisible;   // 0=隐藏；(0,1] 同时作为不透明度（漫游中名称淡出）
uniform float uFocal;   // 视频焦距（像素）：屏幕高 / (2·tan(fov/2))
uniform float uMinPx;   // 常显标签的屏幕最小像素高（远处不缩成点）
uniform float uMinAll;  // 漫游中所有名称的屏幕最小像素高（远处的名字也要能读）
uniform float uMaxPx;   // 标签的屏幕最大像素高（贴近相机也不放大）
uniform float uNear;    // 相机近裁剪面（锚点比它更近则隐藏）
varying vec2 vUv;
varying float vAlpha;
void main() {
  if (aVisible <= 0.001) {
    // 隐藏实例：挪到 NDC 视锥外，整三角形被裁剪
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vAlpha = 0.0;
    return;
  }
  // 锚点变换到视图空间
  vec4 mv = viewMatrix * vec4(aPos, 1.0);
  vec2 corner = position.xy; // quad -0.5..0.5
  // 相机在视图原点看向 -Z：锚点进入相机背后或比近裁剪面更近时，
  // billboard 强透视会把字放大到糊屏 → 直接裁剪掉
  if (mv.z > -uNear) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vAlpha = 0.0;
    return;
  }
  float dist = -mv.z; // 正前方向深度（不用 length，避免背后/侧向误算）
  // 世界尺寸 → 自然屏幕像素；钳制在 [uMinPx, uMaxPx]：
  // 常显标签远处不小于 uMinPx，所有标签贴近相机也不超过 uMaxPx
  float naturalPx = aSize * uFocal / dist;
  float minPx = max(uMinPx, uMinAll);
  float pxSize = clamp(naturalPx, minPx, uMaxPx);
  float finalSize = pxSize * dist / uFocal;
  // 屏幕对齐 billboard：视图空间中相机永远看向 -Z，right=(1,0,0) up=(0,1,0)
  mv.xyz += vec3(corner.x * finalSize * aAspect, corner.y * finalSize, 0.0);
  mv.y += finalSize * 0.85;
  mv.z += aOffset; // 沿视线朝相机偏移：文字浮在多面体正对面上
  // 偏移后若文字越过近裁剪面（贴到相机上），同样裁掉，避免最后一刻放大糊屏
  if (mv.z > -uNear) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vAlpha = 0.0;
    return;
  }
  gl_Position = projectionMatrix * mv;
  vUv = aUv.xy + vec2(corner.x + 0.5, 0.5 - corner.y) * aUv.zw;
  vAlpha = aVisible;
}`

const FRAG = `
uniform sampler2D uMap;
varying vec2 vUv;
varying float vAlpha;
void main() {
  vec4 c = texture2D(uMap, vUv);
  if (c.a < 0.04) discard;
  gl_FragColor = vec4(c.rgb, c.a * vAlpha);
  #include <colorspace_fragment>
}`

// 已创建的标签材质（updateLabelFocal 时统一更新焦距）
const labelMaterials: THREE.ShaderMaterial[] = []
export function clearLabelMaterials() { labelMaterials.length = 0 }

export function createBillboards(datas: LabelData[], pages: AtlasPage[]): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = []
  const base = new THREE.PlaneGeometry(1, 1)

  let start = 0
  pages.forEach(page => {
    const slice = datas.slice(start, start + page.count)
    start += page.count
    if (slice.length === 0) return

    const geo = new THREE.InstancedBufferGeometry()
    geo.index = base.index
    geo.setAttribute('position', base.attributes.position)

    const pos = new Float32Array(slice.length * 3)
    const uv = new Float32Array(slice.length * 4)
    const aspect = new Float32Array(slice.length)
    const size = new Float32Array(slice.length)
    const always = new Float32Array(slice.length)
    const offset = new Float32Array(slice.length)
    const visible = new Float32Array(slice.length).fill(1)
    slice.forEach((d, i) => {
      pos[i * 3] = d.position.x; pos[i * 3 + 1] = d.position.y; pos[i * 3 + 2] = d.position.z
      uv[i * 4] = d.uv[0]; uv[i * 4 + 1] = d.uv[1]; uv[i * 4 + 2] = d.uv[2]; uv[i * 4 + 3] = d.uv[3]
      aspect[i] = d.aspect
      size[i] = d.size
      always[i] = d.always ? 1 : 0
      offset[i] = d.offset
    })
    geo.setAttribute('aPos', new THREE.InstancedBufferAttribute(pos, 3))
    geo.setAttribute('aUv', new THREE.InstancedBufferAttribute(uv, 4))
    geo.setAttribute('aAspect', new THREE.InstancedBufferAttribute(aspect, 1))
    geo.setAttribute('aSize', new THREE.InstancedBufferAttribute(size, 1))
    geo.setAttribute('aAlways', new THREE.InstancedBufferAttribute(always, 1))
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offset, 1))
    geo.setAttribute('aVisible', new THREE.InstancedBufferAttribute(visible, 1))
    geo.instanceCount = slice.length

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: page.texture },
        uFocal: { value: 700 },
        uMinPx: { value: 24 },
        uMinAll: { value: 0 },
        uMaxPx: { value: 28 },
        uNear: { value: 0.1 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    })
    labelMaterials.push(mat)
    const mesh = new THREE.Mesh(geo, mat)
    mesh.frustumCulled = false
    mesh.renderOrder = 10
    meshes.push(mesh)
  })
  return meshes
}

function makeCanvasTexture(canvas: HTMLCanvasElement): THREE.Texture {
  const tex = new THREE.CanvasTexture(canvas)
  tex.flipY = false
  tex.colorSpace = THREE.SRGBColorSpace
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.generateMipmaps = true
  return tex
}

/** 视口/fov 变化时更新焦距（保证屏幕最小像素尺寸换算正确） */
export function updateLabelFocal(viewportHeight: number, fovDeg: number) {
  const focal = viewportHeight / (2 * Math.tan((fovDeg * Math.PI) / 360))
  labelMaterials.forEach(m => { m.uniforms.uFocal.value = focal })
}

/** 漫游时给所有名称垫一个可读字号（0 = 恢复常态的按距离缩放） */
export function setLabelMinPxAll(px: number) {
  labelMaterials.forEach(m => { m.uniforms.uMinAll.value = px })
}

// ───── 科技名称图集（shelf pack：行式排布，条目宽度随文字长度变化） ─────

const PAGE_W = 2048 // 独立课件减少纹理内存，不改变节点数据
const LINE_H = 72
const FONT_PX = 34
const PAD_X = 22
const MAX_LINES = 32 // 每页最多行数（高度上限 3584px）

const NAME_FONT = `500 ${FONT_PX}px "Microsoft YaHei", "PingFang SC", "Segoe UI", sans-serif`

interface NameSlot {
  page: number
  x: number     // 条目左上角像素 x
  y: number     // 条目左上角像素 y（行 × 行高）
  w: number     // 条目像素宽（含留白）
  pageH: number // 所在页总高（像素，用于归一化）
}

/** 名称打包进图集页：第一遍测量宽度并预排，第二遍逐页绘制 */
function buildNameAtlas(names: string[]): { pages: AtlasPage[]; slots: NameSlot[] } {
  // 第一遍：测量
  const measure = document.createElement('canvas').getContext('2d')!
  measure.font = NAME_FONT
  const widths = names.map(n => Math.ceil(measure.measureText(n).width) + PAD_X * 2)

  // 第二遍：预排（页 → 行 → 列）
  const slots: NameSlot[] = []
  const pageLineCounts: number[] = [1] // 每页已占用的行数
  let page = 0, x = 0, line = 0
  for (let i = 0; i < names.length; i++) {
    const w = widths[i]
    if (x + w > PAGE_W) { x = 0; line++ } // 当前行放不下 → 换行
    if (line >= MAX_LINES) { page++; line = 0; pageLineCounts.push(1); x = 0 }
    else if (line + 1 > pageLineCounts[page]) { pageLineCounts[page] = line + 1 }
    slots.push({ page, x, y: line * LINE_H, w, pageH: 0 })
    x += w
  }
  const pageCount = pageLineCounts.length
  slots.forEach(s => { s.pageH = pageLineCounts[s.page] * LINE_H })

  // 第三遍：逐页绘制
  const pages: AtlasPage[] = []
  for (let p = 0; p < pageCount; p++) {
    const canvas = document.createElement('canvas')
    canvas.width = PAGE_W
    canvas.height = pageLineCounts[p] * LINE_H
    const ctx = canvas.getContext('2d')!
    ctx.font = NAME_FONT
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    let count = 0
    for (let i = 0; i < names.length; i++) {
      const s = slots[i]
      if (s.page !== p) continue
      const cx = s.x + s.w / 2
      const cy = s.y + LINE_H / 2
      ctx.fillStyle = 'rgba(10,31,49,0.94)'
      ctx.beginPath(); ctx.roundRect(s.x + 2, s.y + 2, s.w - 4, LINE_H - 4, 12); ctx.fill()
      ctx.strokeStyle = 'rgba(143,186,209,0.27)'; ctx.lineWidth = 1.5; ctx.stroke()
      ctx.fillStyle = '#e4f1fa'
      ctx.fillText(names[i], cx, cy)
      count++
    }
    pages.push({ texture: makeCanvasTexture(canvas), count })
  }
  return { pages, slots }
}

/** 科技名称标签：名称打包进变宽图集，锚定多面体中心；
 *  update 按到相机距离只保留最近的 limit 个名称 */
export function buildNameLabels(placed: PlacedNode[]): {
  meshes: THREE.Mesh[]
  update: (camera: THREE.PerspectiveCamera, limit: number, viewportW: number, viewportH: number, reserved?: number[][]) => void
  /** 漫游：只点亮刚显现的科技名（带淡出 alpha） */
  setTourNames: (count: number, idx: Int32Array, alpha: Float32Array) => void
  /** 让下一次 update 无视静止缓存强制重算 */
  invalidate: () => void
  /** 名称筛选：非匹配条目直接不参与"屏内最近 N 个"的选取 */
  setFilter: (keep: ((nodeIdx: number) => boolean) | null) => void
  /** 聚焦：跳数表（>=0 的条目名字优先占名额），传 null 取消 */
  setFocus: (focus: Int8Array | null) => void
  setHover: (index: number | null) => void
} {
  const names = placed.map(p => p.node.name)
  const { pages, slots } = buildNameAtlas(names)

  const datas: LabelData[] = placed.map((p, i) => {
    const s = slots[i]
    return {
      // 锚定多面体中心 + 沿视线朝相机偏移 → 任何角度看文字都"贴"在多面体正面上
      position: p.position.clone(),
      uv: [s.x / PAGE_W, s.y / s.pageH, s.w / PAGE_W, LINE_H / s.pageH],
      aspect: s.w / LINE_H,
      size: 1.9 - p.node.importance * 0.2,
      always: p.node.importance <= 2,
      offset: geomRadius(p.node.importance) * p.scale + 0.8,
    }
  })

  const meshes = createBillboards(datas, pages)

  // 节点索引 → 所在页的 aVisible 属性 + 页内实例索引（页大小不一，需逐页累计）
  const visAttrs = meshes.map(m =>
    (m.geometry as THREE.InstancedBufferGeometry).getAttribute('aVisible') as THREE.InstancedBufferAttribute
  )
  const nodeLocal: { attr: THREE.InstancedBufferAttribute; local: number }[] = []
  const pageStarts: number[] = [] // 每页在 datas 中的起始偏移
  let acc = 0
  pages.forEach(p => { pageStarts.push(acc); acc += p.count })
  placed.forEach((_, i) => {
    const pg = slots[i].page
    nodeLocal.push({ attr: visAttrs[pg], local: i - pageStarts[pg] })
  })

  // 距离排序缓存（避免每帧分配）
  const dists = new Float32Array(placed.length)
  const boxes: number[][] = []
  const occupied: number[][] = []
  const order: number[] = []
  const pinOrder: number[] = [] // 聚焦集内、本轮真正拿到名额的条目
  const pinned = new Uint8Array(placed.length)
  const lastCamPos = new THREE.Vector3(0, -1e9, 0) // 初始值保证首帧必更新
  let lastLimit = -1
  let lastW = 0, lastH = 0
  let keep: ((nodeIdx: number) => boolean) | null = null
  let focus: Int8Array | null = null
  let hover: number | null = null
  let tourVisibility: Float32Array | null = null
  const lastQuaternion = new THREE.Quaternion()
  const priority = (i: number) => focus?.[i] === 0 ? -2 : i === hover ? -1 : focus ? focus[i] : placed[i].node.importance

  const _v = new THREE.Vector3()
  const _proj = new THREE.Vector3()

  // 与 shader 一致的像素尺寸钳制常量
  const MIN_PX = 24, MAX_PX = 28, MARGIN_PX = 12
  const PIN_MAX = 40 // 聚焦时钉住的名字上限：2 跳集 p90 = 39，个别枢纽到 184，不能让字糊屏

  const update = (
    camera: THREE.PerspectiveCamera,
    limit: number,
    viewportW: number,
    viewportH: number,
    reserved: number[][] = []
  ) => {
    // 相机静止、上限/视口未变时跳过
    if (
      limit === lastLimit && viewportW === lastW && viewportH === lastH &&
      camera.position.distanceToSquared(lastCamPos) < 0.25 && camera.quaternion.angleTo(lastQuaternion) < .001
    ) return
    lastCamPos.copy(camera.position)
    lastQuaternion.copy(camera.quaternion)
    lastLimit = limit; lastW = viewportW; lastH = viewportH

    const focal = viewportH / (2 * Math.tan((camera.fov * Math.PI) / 360))
    camera.updateMatrixWorld()

    // 只统计"文字能完整落在屏幕内"的节点：
    // 投影到 NDC，再按该标签的屏幕像素半宽/半高判定矩形是否整体在内
    order.length = 0
    for (let i = 0; i < placed.length; i++) {
      if (keep && !keep(i)) continue
      if (tourVisibility && tourVisibility[i] <= .05) continue
      if (focus && focus[i] < 0) continue
      const p = placed[i]
      // 相机空间深度：在相机背后或比近裁剪面近的剔除
      _proj.copy(p.position).applyMatrix4(camera.matrixWorldInverse)
      const depth = -_proj.z
      if (depth < camera.near) continue

      // 投影到 NDC（裁剪空间归一化坐标）
      _v.copy(p.position).project(camera)

      // 复刻 shader 像素高度
      const naturalPx = datas[i].size * focal / depth
      const pxH = Math.min(Math.max(naturalPx, MIN_PX), MAX_PX)
      const pxW = pxH * datas[i].aspect

      // 文字矩形相对屏幕中心的半尺寸（NDC 单位）
      const halfNdcW = (pxW / 2 + MARGIN_PX) / (viewportW / 2)
      const halfNdcH = (pxH / 2 + MARGIN_PX) / (viewportH / 2)

      // 整个矩形落在 NDC [-1,1] 内才算完整可见
      if (
        _v.x - halfNdcW >= -1 && _v.x + halfNdcW <= 1 &&
        _v.y - halfNdcH >= -1 && _v.y + halfNdcH <= 1
      ) {
        const sx = (_v.x + 1) * viewportW / 2, sy = (1 - _v.y) * viewportH / 2 - pxH * .85
        if (sy - pxH / 2 < MARGIN_PX) continue
        boxes[i] = [sx - pxW / 2 - 4, sy - pxH / 2 - 3, sx + pxW / 2 + 4, sy + pxH / 2 + 3]
        dists[i] = depth * depth
        order.push(i)
      }
    }
    order.sort((a, b) => priority(a) - priority(b) || dists[a] - dists[b])

    // 聚焦：跳数小的先占名额（自身→1 跳→2 跳），拿不到名额的仍按近者优先
    pinOrder.length = 0
    if (focus) {
      const cand = order.filter(i => focus![i] >= 0)
      const nPin = Math.min(PIN_MAX, limit, cand.length)
      for (let k = 0; k < nPin; k++) { pinned[cand[k]] = 1; pinOrder.push(cand[k]) }
    }

    visAttrs.forEach(a => (a.array as Float32Array).fill(0))
    occupied.length = 0
    occupied.push(...reserved)
    const put = (i: number, v: number) => {
      const box = boxes[i]
      if (box && occupied.some(b => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) return false
      if (box) occupied.push(box)
      const e = nodeLocal[i]
      ;(e.attr.array as Float32Array)[e.local] = v * (tourVisibility ? tourVisibility[i] : 1)
      return true
    }
    let shown = 0
    for (const i of pinOrder) { if (put(i, 1)) shown++ }
    for (let k = 0; shown < limit && k < order.length; k++) {
      const i = order[k]
      if (pinned[i]) continue // 已钉住，不重复占名额
      if (put(i, 1)) shown++
    }
    for (const i of pinOrder) pinned[i] = 0
    visAttrs.forEach(a => { a.needsUpdate = true })
  }

  return {
    meshes,
    update,
    /** 漫游：可见名称仍经过同一投影避让和优先级逻辑。 */
    setTourNames: (count: number, idx: Int32Array, alpha: Float32Array) => {
      tourVisibility ??= new Float32Array(placed.length)
      tourVisibility.fill(0)
      for (let k = 0; k < count; k++) {
        tourVisibility[idx[k]] = alpha[k]
      }
      lastCamPos.set(0, -1e9, 0)
    },
    /** 迫使下一次 update 重算（退出漫游时名额集需要立刻恢复） */
    invalidate: () => { tourVisibility = null; lastCamPos.set(0, -1e9, 0) },
    setFilter: (fn: ((nodeIdx: number) => boolean) | null) => {
      keep = fn
      lastCamPos.set(0, -1e9, 0) // 迫使下一帧重算可见集
    },
    setFocus: (fn: Int8Array | null) => {
      focus = fn
      lastCamPos.set(0, -1e9, 0)
    },
    setHover: (index: number | null) => { if (hover !== index) { hover = index; lastCamPos.set(0,-1e9,0) } },
  }
}

// 时代整词标签：沿各层外侧布局，屏幕投影与知识名称共同避让。
export function buildEraLabels(eraRadii: number[], eraY: number[]): {
  meshes: THREE.Mesh[]
  update: (camera: THREE.PerspectiveCamera, width: number, height: number) => number[][]
  /** 漫游：只显示已到达时代（含当前层）的时代名；传 -1 恢复全部 */
  setVisibleThrough: (era: number) => void
} {
  // 收集所有时代名的字符并去重，生成字符图集
  const uniqueChars: string[] = []
  const charSet = new Set<string>()
  for (let e = 0; e < eraRadii.length; e++) {
    for (const ch of [ERA_INFO[e].name]) {
      if (!charSet.has(ch)) { charSet.add(ch); uniqueChars.push(ch) }
    }
  }

  // 每个时代整词占一格，避免逐字弧排在远景中堆叠。
  const cols = 4, rows = Math.ceil(uniqueChars.length / cols)
  const cellW = 256, cellH = 64
  const canvas = document.createElement('canvas')
  canvas.width = cols * cellW
  canvas.height = rows * cellH
  const ctx = canvas.getContext('2d')!
  const charToCell = new Map<string, [number, number]>()
  uniqueChars.forEach((ch, i) => {
    const col = i % cols, row = Math.floor(i / cols)
    charToCell.set(ch, [col, row])
    const x = col * cellW + cellW / 2
    const y = row * cellH + cellH / 2
    ctx.font = '400 32px "Microsoft YaHei", "PingFang SC", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowBlur = 0
    ctx.fillStyle = '#9cbccc'
    ctx.fillText(ch, x, y)
  })
  const tex = makeCanvasTexture(canvas)

  const angle = Math.PI * .75
  const datas: LabelData[] = eraRadii.map((radius, era) => {
    const cell = charToCell.get(ERA_INFO[era].name)!, r = radius + 24.5
    return {
      position: new THREE.Vector3(Math.cos(angle) * r, eraY[era], Math.sin(angle) * r),
      uv: [cell[0] / cols, cell[1] / rows, 1 / cols, 1 / rows],
      aspect: cellW / cellH,
      size: 2.2,
      always: true,
      offset: 0,
    }
  })
  const meshes = createBillboards(datas, [{ texture: tex, count: datas.length }])

  meshes.forEach(mesh => { const material = mesh.material as THREE.ShaderMaterial; material.uniforms.uMinPx.value = 20; material.uniforms.uMaxPx.value = 20; mesh.renderOrder = 9 })

  const visAttr = (meshes[0].geometry as THREE.InstancedBufferGeometry)
    .getAttribute('aVisible') as THREE.InstancedBufferAttribute
  let through = -1
  const projected = new THREE.Vector3()
  const update = (camera: THREE.PerspectiveCamera, width: number, height: number) => {
    const boxes: number[][] = [], values = visAttr.array as Float32Array
    values.fill(0)
    for (let i = 0; i < datas.length; i++) {
      if (!meshes[0].visible || (through >= 0 && i > through)) continue
      projected.copy(datas[i].position).project(camera)
      if (projected.z < -1 || projected.z > 1) continue
      const x = (projected.x+1)*width/2, y=(1-projected.y)*height/2-17
      const halfWidth = ERA_INFO[i].name.length * 5 + 8
      const box = [x-halfWidth,y-11,x+halfWidth,y+11]
      if (box[0]<10 || box[2]>width-10 || box[1]<10 || box[3]>height-10 || boxes.some(b=>box[0]<b[2]&&box[2]>b[0]&&box[1]<b[3]&&box[3]>b[1])) continue
      boxes.push(box); values[i]=1
    }
    visAttr.needsUpdate=true
    return boxes
  }

  return {
    meshes,
    update,
    setVisibleThrough: (era: number) => {
      through = era
      const a = visAttr.array as Float32Array
      for (let i = 0; i < a.length; i++) a[i] = era < 0 || i <= era ? 1 : 0
      visAttr.needsUpdate = true
    },
  }
}
