import * as THREE from 'three'
import type { NetworkData } from './network-data'
import { CATEGORY_COLORS } from './presentation'

const pointVertex = `
attribute float aRadius; attribute float aStrength; attribute vec3 aColor;
uniform float uFocal; uniform float uDpr; uniform float uFront; uniform float uLod; uniform float uFocus; uniform float uDim;
varying vec3 vColor; varying float vAlpha;
void main(){
 vec4 p=modelViewMatrix*vec4(position,1.0); gl_Position=projectionMatrix*p;
 gl_PointSize=clamp(aRadius*uFocal/max(1.0,-p.z),1.2,7.0)*uDpr*(1.0+uFront*.9);
 vColor=mix(aColor,vec3(.815,.957,1.0),clamp(aStrength-1.0,0.0,1.0));
 vAlpha=(uFocus>.5&&aStrength<1.0?uDim:1.0)*(.56+min(1.0,aRadius/3.0)*.4)*(uFront>.5?.95:1.0);
}`
const pointFragment = `
varying vec3 vColor; varying float vAlpha; uniform float uFront;
void main(){float r=length(gl_PointCoord-.5)*2.0;if(r>1.0)discard;
 float a=1.0-smoothstep(.58,1.0,r);gl_FragColor=vec4(vColor,vAlpha*a);
 #include <colorspace_fragment>
}`

/** One static point buffer + real edge buffer, with small index lists for viewport/LOD/front focus. */
export class NetworkRenderer {
  readonly group = new THREE.Group()
  readonly points: THREE.Points
  readonly foreground: THREE.Points
  readonly lines: THREE.LineSegments
  readonly highlight: THREE.LineSegments
  readonly strengths: THREE.BufferAttribute
  private pointIndex: THREE.BufferAttribute
  private frontIndex: THREE.BufferAttribute
  private lineIndex: THREE.BufferAttribute
  private highlightIndex: THREE.BufferAttribute
  private focus = new Set<number>()
  private path = new Set<string>()
  private visibleEdges = 0
  private highlightEdges = 0
  private lineTarget = .2
  private opacity = .2
  private enabled = true
  private readonly edgeSteps = 4
  private readonly edgeOrder: number[] = []
  private readonly uniforms: Record<string,{value:number}>
  constructor(readonly data: NetworkData) {
    const n = data.placed.length, positions = new Float32Array(n*3), colors = new Float32Array(n*3), radii = new Float32Array(n)
    data.placed.forEach((p,i)=>{
      positions.set(p.position.toArray(),i*3)
      const c = CATEGORY_COLORS[p.node.category].clone().lerp(new THREE.Color(p.node.importance<3?'#a8d8e8':'#548ba7'),.65)
      colors.set(c.toArray(),i*3); radii[i] = p.node.importance<3?2.1:1.1
    })
    const eraBuckets: number[][] = Array.from({length:Math.max(...data.placed.map(p=>p.node.era))+1},()=>[])
    data.edges.forEach((edge,i)=>eraBuckets[data.placed[edge.to].node.era].push(i))
    for(let row=0;eraBuckets.some(bucket=>row<bucket.length);row++)for(const bucket of eraBuckets)if(row<bucket.length)this.edgeOrder.push(bucket[row])
    this.uniforms={uFocal:{value:600},uDpr:{value:1},uFront:{value:0},uLod:{value:1},uFocus:{value:0},uDim:{value:.18}}
    const geometry=new THREE.BufferGeometry()
    geometry.setAttribute('position',new THREE.BufferAttribute(positions,3))
    geometry.setAttribute('aColor',new THREE.BufferAttribute(colors,3))
    geometry.setAttribute('aRadius',new THREE.BufferAttribute(radii,1))
    this.strengths=new THREE.BufferAttribute(new Float32Array(n).fill(1),1);geometry.setAttribute('aStrength',this.strengths)
    this.pointIndex=new THREE.BufferAttribute(new Uint16Array(n),1);geometry.setIndex(this.pointIndex)
    const material=new THREE.ShaderMaterial({uniforms:this.uniforms,vertexShader:pointVertex,fragmentShader:pointFragment,transparent:true,depthWrite:false})
    this.points=new THREE.Points(geometry,material);this.points.frustumCulled=false
    const front=geometry.clone(); // Clone attributes so disposal ownership is explicit; still only one full coordinate system.
    this.frontIndex=new THREE.BufferAttribute(new Uint16Array(60),1);front.setIndex(this.frontIndex);front.setDrawRange(0,0)
    const frontMaterial=material.clone();frontMaterial.uniforms={...this.uniforms,uFront:{value:1}}
    this.foreground=new THREE.Points(front,frontMaterial);this.foreground.frustumCulled=false;this.foreground.renderOrder=2
    const vertices=new Float32Array(data.edges.length*this.edgeSteps*6)
    const mid=new THREE.Vector3(),control=new THREE.Vector3(),a=new THREE.Vector3(),b=new THREE.Vector3()
    const curve=(out:THREE.Vector3,p:THREE.Vector3,q:THREE.Vector3,t:number)=>out.copy(p).multiplyScalar((1-t)**2).addScaledVector(control,2*(1-t)*t).addScaledVector(q,t*t)
    data.edges.forEach((edge,i)=>{
      const from=data.placed[edge.from].position,to=data.placed[edge.to].position
      mid.addVectors(from,to).multiplyScalar(.5);control.set(-mid.x,0,-mid.z).normalize().multiplyScalar(Math.min(8,from.distanceTo(to)*.12)).add(mid)
      for(let s=0;s<this.edgeSteps;s++){curve(a,from,to,s/this.edgeSteps);curve(b,from,to,(s+1)/this.edgeSteps);vertices.set([...a.toArray(),...b.toArray()],(i*this.edgeSteps+s)*6)}
    })
    const lineGeometry=new THREE.BufferGeometry();lineGeometry.setAttribute('position',new THREE.BufferAttribute(vertices,3))
    this.lineIndex=new THREE.BufferAttribute(new Uint32Array(vertices.length/3),1);lineGeometry.setIndex(this.lineIndex)
    this.lines=new THREE.LineSegments(lineGeometry,new THREE.LineBasicMaterial({color:'#315c78',transparent:true,opacity:this.opacity,depthWrite:false}));this.lines.frustumCulled=false
    const highlights=new THREE.BufferGeometry();highlights.setAttribute('position',lineGeometry.getAttribute('position'))
    this.highlightIndex=new THREE.BufferAttribute(new Uint32Array(vertices.length/3),1);highlights.setIndex(this.highlightIndex)
    this.highlight=new THREE.LineSegments(highlights,new THREE.LineBasicMaterial({color:'#67d4f4',transparent:true,opacity:.8,depthWrite:false}));this.highlight.frustumCulled=false;this.highlight.renderOrder=1
    this.group.add(this.lines,this.points,this.highlight,this.foreground)
  }
  setFocus(indices: number[], path: number[] = [], primary: number | null = null, dim=.18) {
    this.focus=new Set(indices);this.path.clear()
    for(let i=1;i<path.length;i++)this.path.add(`${Math.min(path[i-1],path[i])}:${Math.max(path[i-1],path[i])}`)
    const values=this.strengths.array as Float32Array
    values.fill(indices.length?.3:1)
    for(const index of indices)values[index]=1.4
    if(primary!==null)values[primary]=2
    this.strengths.needsUpdate=true
    const frontStrength=this.foreground.geometry.getAttribute('aStrength') as THREE.BufferAttribute
    ;(frontStrength.array as Float32Array).set(values);frontStrength.needsUpdate=true
    this.uniforms.uFocus.value=indices.length?1:0
    this.uniforms.uDim.value=dim
  }
  setViewport(indices: number[], projected: Float32Array, lod: number, economy: boolean, front: number[]) {
    const pointArray=this.pointIndex.array as Uint16Array
    pointArray.set(indices);this.pointIndex.needsUpdate=true;this.points.geometry.setDrawRange(0,indices.length)
    const frontArray=this.frontIndex.array as Uint16Array;frontArray.set(front.slice(0,60));this.frontIndex.needsUpdate=true;this.foreground.geometry.setDrawRange(0,Math.min(60,front.length))
    let base=0,accent=0,count=0,highlightCount=0
    const lineArray=this.lineIndex.array as Uint32Array,highlightArray=this.highlightIndex.array as Uint32Array
    const budget=economy?1400:Math.round(lod<=2?3000+Math.max(0,lod-1)*3000:6000+Math.min(1,lod-2)*4000)
    for(const i of this.edgeOrder){
      const e=this.data.edges[i],x=projected[e.from*3],y=projected[e.from*3+1],z=projected[e.from*3+2],xx=projected[e.to*3],yy=projected[e.to*3+1],zz=projected[e.to*3+2]
      if((x< -1.05&&xx< -1.05)||(x>1.05&&xx>1.05)||(y< -1.05&&yy< -1.05)||(y>1.05&&yy>1.05)||(z< -1&&zz< -1)||(z>1&&zz>1))continue
      const isFocus=(this.focus.has(e.from)&&this.focus.has(e.to))||this.path.has(`${Math.min(e.from,e.to)}:${Math.max(e.from,e.to)}`)
      const p=this.data.placed[e.from].node,q=this.data.placed[e.to].node
      const representative=p.importance<=2||q.importance<=2||p.category!==q.category||i%4===0
      const draw=(count<budget&&(lod>=2.6||representative))
      if(!draw&&!isFocus)continue
      for(let k=0;k<this.edgeSteps*2;k++){
        const vertex=i*this.edgeSteps*2+k
        if(draw)lineArray[base++]=vertex
        if(isFocus)highlightArray[accent++]=vertex
      }
      if(draw)count++
      if(isFocus)highlightCount++
    }
    this.visibleEdges=count;this.highlightEdges=highlightCount
    this.lineIndex.needsUpdate=true;this.highlightIndex.needsUpdate=true
    this.lines.geometry.setDrawRange(0,base);this.highlight.geometry.setDrawRange(0,accent)
    this.lineTarget=(lod<1.6?.23:.32)*(this.focus.size?(this.uniforms.uDim.value<.5?.42:.85):1)
  }
  update(camera: THREE.PerspectiveCamera,height:number,dpr:number,lod:number,dt:number) {
    this.uniforms.uFocal.value=height/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2)))
    this.uniforms.uDpr.value=dpr;this.uniforms.uLod.value=lod
    this.opacity+=(this.lineTarget-this.opacity)*Math.min(1,dt*8)
    ;(this.lines.material as THREE.LineBasicMaterial).opacity=this.opacity
  }
  toggleLines(value:boolean){this.enabled=value;this.lines.visible=value;this.highlight.visible=value}
  get stats(){return {points:this.points.geometry.drawRange.count,foreground:this.foreground.geometry.drawRange.count,edges:this.enabled?this.visibleEdges:0,highlightEdges:this.enabled?this.highlightEdges:0}}
  dispose(){
    const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>()
    this.group.traverse(object=>{const mesh=object as THREE.Mesh;if(mesh.geometry)geometries.add(mesh.geometry);if(mesh.material)materials.add(mesh.material as THREE.Material)})
    geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());this.group.clear()
  }
}
