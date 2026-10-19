import * as THREE from 'three'
import type { NetworkData } from './network-data'

/** Screen-space grid, rebuilt only after the actual camera/container changes; no per-node listeners. */
export class ProjectedIndex {
  readonly projected: Float32Array
  visible: number[] = []
  private grid = new Map<string,number[]>()
  private v = new THREE.Vector3()
  private matrix = new THREE.Matrix4().set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0)
  private width=0;private height=0
  constructor(private data: NetworkData){this.projected=new Float32Array(data.placed.length*3)}
  update(camera:THREE.PerspectiveCamera,width:number,height:number,force=false){
    camera.updateMatrixWorld()
    const matrix=new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse)
    if(!force&&this.width===width&&this.height===height&&this.matrix.equals(matrix))return false
    this.matrix.copy(matrix);this.width=width;this.height=height;this.visible=[];this.grid.clear()
    this.data.placed.forEach((p,i)=>{
      this.v.copy(p.position).applyMatrix4(matrix);const {x,y,z}=this.v
      this.projected[i*3]=x;this.projected[i*3+1]=y;this.projected[i*3+2]=z
      // A margin lets GPU clipping stay continuous between throttled culling-index updates.
      if(x< -1.18||x>1.18||y< -1.18||y>1.18||z< -1||z>1)return
      this.visible.push(i)
      const key=`${Math.floor((x+1)*width/128)}:${Math.floor((1-y)*height/128)}`
      const bucket=this.grid.get(key)??[];bucket.push(i);this.grid.set(key,bucket)
    });return true
  }
  hit(x:number,y:number,radius:number){
    const col=Math.floor(x/64),row=Math.floor(y/64);let best=radius*radius,result:number|null=null
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const i of this.grid.get(`${col+dx}:${row+dy}`)??[]){
      const sx=(this.projected[i*3]+1)*this.width/2,sy=(1-this.projected[i*3+1])*this.height/2,d=(x-sx)**2+(y-sy)**2
      if(d<best){best=d;result=i}
    }return result
  }
}
