import type { TechNode } from './data'

// UI directories only, not new scientific categories or prerequisite edges.
export const DOMAINS = [
  { name: '数学与逻辑', categories: [0, 1] },
  { name: '计算与智能', categories: [2, 3] },
  { name: '信息与传播', categories: [4] },
  { name: '物理学', categories: [5] },
  { name: '化学与材料', categories: [6, 9] },
  { name: '生命与医学', categories: [7] },
  { name: '地球与空间探索', categories: [8, 16] },
  { name: '制造与能源', categories: [10, 11] },
  { name: '建造与交通', categories: [12, 13] },
  { name: '农业与日常生活', categories: [14, 21] },
  { name: '社会与安全', categories: [15, 17] },
  { name: '经济、教育与文化', categories: [18, 19, 20] },
] as const

export const PAGE_SIZE = 30
export const MAX_VISIBLE = 60
export interface BrowseState { domain: number | null; page: number; selected: string | null; relationPage: number }
export interface BrowseFilter { era: number | null; category: number | null }
export const rootState = (): BrowseState => ({ domain: null, page: 0, selected: null, relationPage: 0 })

export function createHierarchy(nodes: TechNode[]) {
  const byId = new Map(nodes.map(n => [n.id, n]))
  const domainOf = (node: TechNode) => DOMAINS.findIndex(d => (d.categories as readonly number[]).includes(node.category))
  const ordered = [...nodes].sort((a, b) => a.year - b.year || a.name.localeCompare(b.name, 'zh-CN') || a.id.localeCompare(b.id))
  const children = DOMAINS.map((_, i) => ordered.filter(n => domainOf(n) === i))
  const dependents = new Map<string, string[]>()
  for (const node of nodes) for (const id of node.prereqs) {
    const list = dependents.get(id) ?? []; list.push(node.id); dependents.set(id, list)
  }
  const matches = (n: TechNode, f: BrowseFilter) => (f.era === null || n.era === f.era) && (f.category === null || n.category === f.category)
  const members = (domain: number, f: BrowseFilter) => (children[domain] ?? []).filter(n => matches(n, f))
  const relations = (id: string) => {
    const node = byId.get(id)
    if (!node) return []
    return [...new Set([...node.prereqs, ...(dependents.get(id) ?? []), ...node.related])].filter(other => other !== id && byId.has(other)).map(other => byId.get(other)!)
  }
  function locate(id: string, filter: BrowseFilter): BrowseState | null {
    const node = byId.get(id)
    if (!node) return null
    const domain = domainOf(node), index = members(domain, filter).findIndex(n => n.id === id)
    if (index < 0) return null
    return { domain, page: Math.floor(index / PAGE_SIZE), selected: id, relationPage: 0 }
  }
  function view(state: BrowseState, filter: BrowseFilter) {
    if (state.domain === null) {
      const domains = DOMAINS.flatMap((domain, index) => {
        const count = members(index, filter).length
        return count ? [{ index, name: domain.name, count }] : []
      })
      return { domains, nodes: [] as TechNode[], page: 0, pages: 1, total: domains.length }
    }
    if (state.selected) {
      // Keep the selected anchor on every page, while every relation remains reachable.
      const node = byId.get(state.selected), all = relations(state.selected)
      const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE)), page = Math.max(0, Math.min(state.relationPage, pages - 1))
      return { domains: [], nodes: node ? [node, ...all.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)] : [], page, pages, total: all.length }
    }
    const all = members(state.domain, filter), pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE)), page = Math.max(0, Math.min(state.page, pages - 1))
    return { domains: [], nodes: all.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), page, pages, total: all.length }
  }
  function search(query: string) {
    const q = query.trim().normalize('NFKC').toLocaleLowerCase()
    return q ? ordered.filter(n => `${n.name} ${n.nameEn} ${n.id}`.normalize('NFKC').toLocaleLowerCase().includes(q)) : []
  }
  return { byId, domainOf, members, dependents, relations, locate, view, search }
}
