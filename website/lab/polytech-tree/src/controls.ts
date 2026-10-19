import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { BLEND, type TourPlan } from './tour'

// 相机系统：环绕观察（默认）+ 螺旋上升漫游动画（轨道与排期见 tour.ts）
export type CameraMode = 'orbit' | 'tour'

const WORLD_UP = new THREE.Vector3(0, 1, 0)

export class CameraRig {
  private events = new AbortController()
  mode: CameraMode = 'orbit'
  /** 漫游时钟（秒）：orbit 模式下无意义 */
  tourT = 0
  controls: OrbitControls
  onEraChange?: (era: number) => void
  onTourEnd?: () => void

  private camera: THREE.PerspectiveCamera
  private plan: TourPlan
  private towerHeight: number
  private lastEra = -1
  private startPos = new THREE.Vector3()
  private startTarget = new THREE.Vector3()
  private lookTarget = new THREE.Vector3()
  private pos = new THREE.Vector3()
  private up = new THREE.Vector3(0, 1, 0)
  private transition: { from: THREE.Vector3; targetFrom: THREE.Vector3; to: THREE.Vector3; targetTo: THREE.Vector3; time: number } | null = null
  private reduced = matchMedia('(prefers-reduced-motion: reduce)')

  constructor(
    camera: THREE.PerspectiveCamera, dom: HTMLElement,
    towerHeight: number, plan: TourPlan, private overview: THREE.Vector3[]
  ) {
    this.camera = camera
    this.plan = plan
    this.towerHeight = towerHeight

    this.controls = new OrbitControls(camera, dom)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.06
    this.controls.autoRotate = false
    this.controls.autoRotateSpeed = 0.35
    this.controls.maxDistance = 950
    this.controls.minDistance = 40
    this.controls.target.set(0, this.towerHeight * 0.5, 0)

    // 用户一旦交互就停掉自动旋转
    this.controls.addEventListener('start', () => { this.controls.autoRotate = false; this.transition = null })

    // ESC 中断漫游
    window.addEventListener('keydown', e => {
      if (e.key === 'Escape' && this.mode === 'tour') this.stopTour()
    }, { signal: this.events.signal })
    // 点击画布中断漫游
    dom.addEventListener('pointerdown', () => {
      if (this.mode === 'tour') this.stopTour()
    }, { signal: this.events.signal })
  }

  resetView() {
    this.stopTour()
    this.framePoints(this.overview, true, new THREE.Vector3(1, .22, 1).normalize())
  }

  frameBounds(bounds: THREE.Box3, animate = true, direction = this.camera.position.clone().sub(this.controls.target).normalize()) {
    if (bounds.isEmpty()) return
    const points: THREE.Vector3[] = []
    for (const x of [bounds.min.x,bounds.max.x]) for (const y of [bounds.min.y,bounds.max.y]) for (const z of [bounds.min.z,bounds.max.z]) points.push(new THREE.Vector3(x,y,z))
    this.framePoints(points, animate, direction)
  }

  private framePoints(points: THREE.Vector3[], animate: boolean, direction: THREE.Vector3) {
    if (!points.length) return
    if (Math.abs(direction.y) > .95) direction = new THREE.Vector3(1,.5,1).normalize()
    const center = new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3())
    const right = new THREE.Vector3().crossVectors(WORLD_UP, direction).normalize()
    const up = new THREE.Vector3().crossVectors(direction, right).normalize()
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)), tanH = tanV * this.camera.aspect
    let distance = 90 // 留出名称空间，避免孤立节点瞬间放大成巨物
    for (const point of points) {
      const offset = point.clone().sub(center), depth = offset.dot(direction)
      distance = Math.max(distance, Math.abs(offset.dot(right)) / tanH + depth, Math.abs(offset.dot(up)) / tanV + depth)
    }
    distance *= 1.16
    this.controls.maxDistance = Math.max(950, distance * 2)
    const to = center.clone().addScaledVector(direction, distance)
    if (animate && !this.reduced.matches) this.transition = { from:this.camera.position.clone(), targetFrom:this.controls.target.clone(), to, targetTo:center, time:0 }
    else { this.transition = null; this.camera.position.copy(to); this.controls.target.copy(center); this.controls.update() }
  }

  cancelTransition() { this.transition = null }

  fitInitial() {
    this.framePoints(this.overview, false, new THREE.Vector3(1,.22,1).normalize())
  }

  startTour() {
    if (this.mode === 'tour') return
    this.mode = 'tour'
    this.transition = null
    this.tourT = 0
    this.lastEra = -1
    this.plan.reset()
    this.startPos.copy(this.camera.position)
    this.startTarget.copy(this.controls.target)
    this.controls.enabled = false
  }

  dispose() {
    this.events.abort()
    this.controls.dispose()
    this.onEraChange = undefined
    this.onTourEnd = undefined
  }

  stopTour() {
    if (this.mode !== 'tour') return
    this.mode = 'orbit'
    this.controls.enabled = true
    // 漫游把 up 改成了水平向量（视线朝上时必需），环绕模式要交还世界竖直
    this.camera.up.copy(WORLD_UP)
    this.controls.target.copy(this.lookTarget.lengthSq() > 0 ? this.lookTarget : new THREE.Vector3(0, this.camera.position.y, 0))
    this.controls.update()
    this.onTourEnd?.()
  }

  update(dt: number) {
    if (this.mode === 'orbit') {
      if (this.transition) {
        const move = this.transition
        move.time += dt
        const t = Math.min(1, move.time / .85), ease = 1 - Math.pow(1 - t, 4)
        this.camera.position.lerpVectors(move.from, move.to, ease)
        this.controls.target.lerpVectors(move.targetFrom, move.targetTo, ease)
        if (t === 1 || this.reduced.matches) { this.camera.position.copy(move.to); this.controls.target.copy(move.targetTo); this.transition = null }
      }
      this.controls.update()
      return
    }

    this.tourT += dt
    if (this.tourT >= this.plan.total) {
      this.applyTourPose(this.plan.total)
      this.stopTour()
      return
    }
    this.applyTourPose(this.tourT)
  }

  private applyTourPose(t: number) {
    this.plan.poseAt(t, this.pos, this.lookTarget)
    this.plan.upAt(t, this.up)

    // 开场从当前位姿融入中轴线起点
    if (t < BLEND) {
      const k = t / BLEND
      const s = k * k * (3 - 2 * k) // smoothstep
      this.pos.lerpVectors(this.startPos, this.pos, s)
      this.lookTarget.lerpVectors(this.startTarget, this.lookTarget, s)
      this.up.lerpVectors(WORLD_UP, this.up, s)
    }

    this.camera.position.copy(this.pos)
    this.camera.up.copy(this.up)
    this.camera.lookAt(this.lookTarget)

    const era = this.plan.eraOf(t)
    if (era !== this.lastEra) {
      this.lastEra = era
      this.onEraChange?.(era)
    }
  }
}
