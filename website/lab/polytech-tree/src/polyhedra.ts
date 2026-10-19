// Adapted from Polytech Tree, Copyright (c) 2026 secwind, MIT.
import * as THREE from 'three'
import { geomRadius, type PlacedNode } from './layout'
import { FLASH } from './tour'
import { displayScale } from './presentation'

const R = geomRadius(2)
const geometries = [
  new THREE.IcosahedronGeometry(R * 1.12),
  new THREE.DodecahedronGeometry(R),
  new THREE.OctahedronGeometry(R),
  new THREE.BoxGeometry((R * 2) / Math.sqrt(3), (R * 2) / Math.sqrt(3), (R * 2) / Math.sqrt(3)),
  new THREE.TetrahedronGeometry(R)
]
export function facesOf(importance: number) {
  return [20, 12, 8, 6, 4][Math.min(5, Math.max(1, Math.round(importance))) - 1]
}
const levelOf = (p: PlacedNode) => Math.min(5, Math.max(1, Math.round(p.node.importance))) - 1

// Keep the exact CPU rotation/reveal formulas, but evaluate them once per vertex on the GPU.
const motionShader = `
attribute vec4 aSpin;
attribute float aPhase;
attribute float aReveal;
uniform float uNodeTime;
uniform float uTourTime;
uniform float uInTour;
vec3 spinNode(vec3 v) {
  float angle = aPhase + uNodeTime * aSpin.w;
  return v*cos(angle) + cross(aSpin.xyz,v)*sin(angle) + aSpin.xyz*dot(aSpin.xyz,v)*(1.0-cos(angle));
}
float nodeAge() { return uTourTime-aReveal; }
float nodeScale() {
  if(uInTour < 0.5) return 1.0;
  float age=nodeAge();
  if(age < 0.0) return 0.0;
  float k=clamp(age/${FLASH.toFixed(6)},0.0,1.0);
  return (1.0+0.3*sin(k*3.14159265))*min(1.0,k*4.0);
}
`

export class PolyhedraField {
  meshes: THREE.InstancedMesh[] = []
  indicators = [
    new THREE.Mesh(
      new THREE.RingGeometry(1, 1.06, 48),
      new THREE.MeshBasicMaterial({
        color: '#d5f5ff',
        transparent: true,
        opacity: 0.9,
        depthTest: false,
        depthWrite: false
      })
    ),
    new THREE.Mesh(
      new THREE.RingGeometry(1, 1.035, 48),
      new THREE.MeshBasicMaterial({
        color: '#9cbccc',
        transparent: true,
        opacity: 0.55,
        depthTest: false,
        depthWrite: false
      })
    )
  ]
  private buckets: number[][] = Array.from({ length: 5 }, () => [])
  private local: { level: number; instance: number }[] = []
  private keep: ((index: number) => boolean) | null = null
  private selected = -1
  private hover: number | null = null
  private tmp = new THREE.Object3D()
  private color = new THREE.Color()
  private focusColor = new THREE.Color('#d5f5ff')
  private uniforms = { uNodeTime: { value: 0 }, uTourTime: { value: 0 }, uInTour: { value: 0 } }
  private picker: THREE.Mesh
  private hits: THREE.Intersection[] = []

  constructor(
    private placed: PlacedNode[],
    private colors: THREE.Color[]
  ) {
    placed.forEach((p, index) => {
      const level = levelOf(p)
      this.local[index] = { level, instance: this.buckets[level].length }
      this.buckets[level].push(index)
    })
    this.buckets.forEach((indices, level) => {
      const geometry = geometries[level],
        spin = new Float32Array(indices.length * 4),
        phase = new Float32Array(indices.length)
      indices.forEach((index, i) => {
        const p = placed[index]
        spin.set([p.spinAxis.x, p.spinAxis.y, p.spinAxis.z, p.spinSpeed], i * 4)
        phase[i] = p.phase
      })
      geometry.setAttribute('aSpin', new THREE.InstancedBufferAttribute(spin, 4))
      geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1))
      geometry.setAttribute(
        'aReveal',
        new THREE.InstancedBufferAttribute(new Float32Array(indices.length), 1)
      )
      geometry.computeBoundingSphere()
      const material = new THREE.MeshStandardMaterial({ metalness: 0.32, roughness: 0.42 })
      material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, this.uniforms)
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\n' + motionShader)
          .replace(
            '#include <beginnormal_vertex>',
            '#include <beginnormal_vertex>\nobjectNormal = spinNode(objectNormal);'
          )
          .replace(
            '#include <begin_vertex>',
            '#include <begin_vertex>\ntransformed = spinNode(transformed)*nodeScale();'
          )
          .replace(
            '#include <color_vertex>',
            `#include <color_vertex>\n#ifdef USE_INSTANCING_COLOR\nif(uInTour > 0.5) vColor.rgb *= 1.0 + clamp(1.0-nodeAge()/${FLASH.toFixed(6)},0.0,1.0)*1.8;\n#endif`
          )
      }
      material.customProgramCacheKey = () => 'polytech-node-motion-v1'
      const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, indices.length))
      mesh.count = indices.length
      mesh.frustumCulled = false
      indices.forEach((index, i) => mesh.setColorAt(i, colors[placed[index].node.category]))
      this.meshes.push(mesh)
    })
    this.picker = new THREE.Mesh(geometries[0], this.meshes[0].material)
    this.writeMatrices()
    this.indicators.forEach((mesh) => {
      mesh.visible = false
      mesh.renderOrder = 5
    })
  }
  private writeMatrices() {
    this.tmp.quaternion.identity()
    this.meshes.forEach((mesh, level) => {
      this.buckets[level].forEach((index, i) => {
        const p = this.placed[index]
        this.tmp.position.copy(p.position)
        this.tmp.scale.setScalar(this.hidden(index) ? 0 : displayScale(p.scale))
        this.tmp.updateMatrix()
        mesh.setMatrixAt(i, this.tmp.matrix)
      })
      mesh.instanceMatrix.needsUpdate = true
    })
  }
  update(time: number) {
    this.uniforms.uNodeTime.value = time
  }
  beginTour(revealAt: Float32Array, time: number) {
    this.uniforms.uInTour.value = 1
    this.uniforms.uTourTime.value = time
    this.meshes.forEach((mesh, level) => {
      const attr = mesh.geometry.getAttribute('aReveal') as THREE.InstancedBufferAttribute
      this.buckets[level].forEach((index, i) => {
        attr.array[i] = revealAt[index]
      })
      attr.needsUpdate = true
    })
  }
  endTour() {
    this.uniforms.uInTour.value = 0
  }
  setTourTime(time: number) {
    this.uniforms.uTourTime.value = time
  }
  private hidden(index: number) {
    return !!this.keep && !this.keep(index)
  }
  private repaint(index: number) {
    const { level, instance } = this.local[index],
      mesh = this.meshes[level]
    this.color.copy(this.colors[this.placed[index].node.category])
    if (index === this.selected) this.color.copy(this.focusColor)
    else if (index === this.hover) this.color.lerp(this.focusColor, 0.45)
    mesh.setColorAt(instance, this.color)
    mesh.instanceColor!.needsUpdate = true
  }
  setVisible(keep: ((index: number) => boolean) | null, focus: Int8Array | null) {
    this.keep = keep
    this.selected = focus?.indexOf(0) ?? -1
    this.writeMatrices()
    this.placed.forEach((_, index) => this.repaint(index))
  }
  highlight(index: number | null) {
    if (index === this.hover) return
    const prev = this.hover
    this.hover = index
    if (prev !== null) this.repaint(prev)
    if (index !== null) this.repaint(index)
  }
  updateIndicators(camera: THREE.Camera) {
    this.indicators.forEach((mesh, i) => {
      const index = i === 0 ? this.selected : this.hover
      mesh.visible =
        index !== null && index >= 0 && !this.hidden(index) && (i === 0 || index !== this.selected)
      if (!mesh.visible || index === null) return
      const p = this.placed[index]
      mesh.position.copy(p.position)
      mesh.quaternion.copy(camera.quaternion)
      mesh.scale.setScalar(R * (p.node.importance === 1 ? 1.12 : 1) * displayScale(p.scale) * 1.65)
    })
  }
  /** Broad-phase sphere pruning, followed by the actual rotated geometry: no approximate picks. */
  pick(raycaster: THREE.Raycaster): number | null {
    let nearest = Infinity,
      result: number | null = null
    this.placed.forEach((p, index) => {
      if (this.hidden(index)) return
      const geometry = geometries[this.local[index].level],
        scale = displayScale(p.scale),
        radius = geometry.boundingSphere!.radius * scale
      if (raycaster.ray.distanceSqToPoint(p.position) > radius * radius) return
      this.tmp.position.copy(p.position)
      this.tmp.quaternion.setFromAxisAngle(
        p.spinAxis,
        p.phase + this.uniforms.uNodeTime.value * p.spinSpeed
      )
      this.tmp.scale.setScalar(scale)
      this.tmp.updateMatrix()
      this.picker.geometry = geometry
      this.picker.matrixWorld.copy(this.tmp.matrix)
      this.hits.length = 0
      this.picker.raycast(raycaster, this.hits)
      for (const hit of this.hits)
        if (hit.distance < nearest) {
          nearest = hit.distance
          result = index
        }
    })
    return result
  }
}
