import * as THREE from 'three'
import { STAGE } from './presentation'
// Adapted from Polytech Tree, Copyright (c) 2026 secwind, MIT.
export function createScene(towerHeight: number, eraRadii: number[]) {
  const host = document.getElementById('scene')!
  const mobile = matchMedia('(max-width: 700px)').matches
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(STAGE)
  scene.fog = new THREE.Fog(STAGE, 650, 1800)
  const camera = new THREE.PerspectiveCamera(55, host.clientWidth / host.clientHeight, 0.1, 4000)
  camera.position.set(Math.max(...eraRadii) * 3, towerHeight * .65, Math.max(...eraRadii) * 3)
  const renderer = new THREE.WebGLRenderer({ antialias: !mobile })
  renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1 : 2))
  renderer.setSize(host.clientWidth, host.clientHeight)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.domElement.tabIndex = 0
  renderer.domElement.setAttribute('aria-label', '科技树三维场景，方向键旋转，加减缩放；也可用上方知识节点列表探索')
  host.appendChild(renderer.domElement)
  scene.add(new THREE.HemisphereLight('#c4e6ff', '#142d46', 2.1))
  const sun = new THREE.DirectionalLight('#ffefd8', 3.1)
  sun.position.set(90, 240, 70)
  scene.add(sun)
  const fill = new THREE.DirectionalLight('#83c7e7', 1.4)
  fill.position.set(-130, 130, -70); scene.add(fill)
  return { scene, camera, renderer }
}
