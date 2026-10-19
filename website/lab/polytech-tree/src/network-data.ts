import * as THREE from 'three'
import { TECHS, type TechNode } from './data'
import cache from './network-layout.json'
import type { PlacedNode } from './layout'

export interface NetworkEdge { from: number; to: number; kind: 'prereq' | 'related' }
export interface NetworkData { placed: PlacedNode[]; edges: NetworkEdge[]; adj: number[][]; byId: Map<string, number>; towerHeight: number }
let promise: Promise<NetworkData> | undefined
export function loadNetwork() {
  return promise ??= createNetwork().catch(error => { promise = undefined; throw error })
}
async function createNetwork(): Promise<NetworkData> {
  const signature = JSON.stringify(TECHS.map(n => [n.id,n.year,n.era,n.category,n.importance]))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(signature))
  const hash = [...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('')
  if (cache.version !== 2 || hash !== cache.hash || cache.positions.length !== TECHS.length) throw new Error('知识与布局缓存不一致，请运行npm run cache-layout后重新构建')
  const originals = new Map(TECHS.map(n=>[n.id,n]))
  const placed: PlacedNode[] = cache.positions.map(row => {
    const [id,x,y,z,scale] = row
    const node = originals.get(String(id)) as TechNode
    if (!node || ![x,y,z,scale].every(n=>typeof n==='number' && Number.isFinite(n))) throw new Error('无效坐标缓存')
    return { node,position:new THREE.Vector3(Number(x),Number(y),Number(z)),scale:Number(scale),spinAxis:new THREE.Vector3(0,1,0),spinSpeed:0,phase:0 }
  })
  const byId = new Map(placed.map((p,i)=>[p.node.id,i]))
  if (byId.size !== TECHS.length) throw new Error('布局ID重复')
  const edges: NetworkEdge[] = [], adj = placed.map(()=>[] as number[]), keys = new Set<string>()
  for (const [to,p] of placed.entries()) for (const kind of ['prereq','related'] as const) for (const id of kind==='prereq'?p.node.prereqs:p.node.related) {
    const from = byId.get(id)
    if (from === undefined || from === to) continue
    const key = kind==='prereq'?`${from}>${to}`:`${Math.min(from,to)}~${Math.max(from,to)}`
    if (keys.has(key)) continue
    keys.add(key); edges.push({ from,to,kind }); adj[from].push(to); adj[to].push(from)
  }
  adj.forEach((ids,i)=>adj[i]=[...new Set(ids)])
  return { placed,edges,adj,byId,towerHeight:cache.towerHeight }
}
