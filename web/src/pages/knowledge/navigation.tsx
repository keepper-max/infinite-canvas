import { Button, Input, Pagination, Select, Tree, Tooltip } from "antd";
import { FileText, FolderPlus, Plus, Search, Trash2, FolderPen, PanelLeftClose } from "lucide-react";
import type { KnowledgeFolder, KnowledgeSpace, KnowledgeSummary } from "@/services/api/knowledge";
import { knowledgeDragType } from "@/services/api/knowledge-canvas";
export function folderPath(folders: KnowledgeFolder[], id: string | null): string {
    const names: string[] = [],
        seen = new Set<string>();
    let at = id;
    while (at && !seen.has(at)) {
        seen.add(at);
        const f = folders.find((v) => v.id === at);
        if (!f) break;
        names.unshift(f.name);
        at = f.parent_id;
    }
    return names.join(" / ") || "根目录";
}
type Props = {
    spaces: KnowledgeSpace[];
    space: string;
    onSpace: (id: string) => void;
    folders: KnowledgeFolder[];
    folder: string;
    onFolder: (id: string) => void;
    items: KnowledgeSummary[];
    total: number;
    page: number;
    onPage: (v: number) => void;
    active: string;
    onOpen: (id: string) => void;
    query: string;
    onQuery: (s: string) => void;
    tags: { tag: string; count: number }[];
    tag: string;
    onTag: (t: string) => void;
    trash: boolean;
    onTrash: () => void;
    onNew: () => void;
    onFolderCreate: () => void;
    onFolderEdit: () => void;
    onFolderDelete: () => void;
    onCollapse: () => void;
    canWrite: boolean;
};
export default function KnowledgeNavigation(p: Props) {
    const nodes = (parent: string | null): any[] => p.folders.filter((f) => f.parent_id === parent).map((f) => ({ key: f.id, title: f.name, children: nodes(f.id) }));
    return (
        <aside className="knowledge-nav" aria-label="知识库导航">
            <header className="knowledge-nav-heading">
                <span>知识库</span>
                <button aria-label="收起知识导航" onClick={p.onCollapse}>
                    <PanelLeftClose size={16} />
                </button>
            </header>
            <Select aria-label="知识空间" value={p.space || undefined} onChange={p.onSpace} options={p.spaces.map((s) => ({ value: s.id, label: s.name + (s.kind === "project" ? " · 项目" : "") }))} />
            <Input aria-label="搜索知识" placeholder="搜索标题、标签、正文" prefix={<Search size={14} />} value={p.query} onChange={(e) => p.onQuery(e.target.value)} allowClear />
            <div className="knowledge-nav-actions">
                <Button type="text" disabled={!p.canWrite} icon={<Plus size={15} />} onClick={p.onNew}>
                    新建文档
                </Button>
                <Tooltip title="新建文件夹">
                    <Button aria-label="新建文件夹" type="text" disabled={!p.canWrite} icon={<FolderPlus size={16} />} onClick={p.onFolderCreate} />
                </Tooltip>
            </div>
            <div className="knowledge-nav-scroll">
                <div className="knowledge-section-label">
                    文件夹{" "}
                    {p.folder && (
                        <span>
                            <button aria-label="编辑文件夹" disabled={!p.canWrite} onClick={p.onFolderEdit}>
                                <FolderPen size={14} />
                            </button>
                            <button aria-label="删除文件夹" disabled={!p.canWrite} onClick={p.onFolderDelete}>
                                <Trash2 size={14} />
                            </button>
                        </span>
                    )}
                </div>
                <Tree
                    blockNode
                    selectedKeys={[p.folder || "root"]}
                    defaultExpandedKeys={["root"]}
                    onSelect={(keys) => p.onFolder(keys[0] === "root" ? "" : String(keys[0] || ""))}
                    treeData={[{ key: "root", title: "全部文档", isLeaf: false, children: nodes(null) }]}
                />
                <Select aria-label="标签筛选" placeholder="全部标签" allowClear value={p.tag || undefined} onChange={(v) => p.onTag(v || "")} options={p.tags.map((t) => ({ value: t.tag, label: "#" + t.tag + " · " + t.count }))} />
                <div className="knowledge-section-label">
                    <span>{p.trash ? "回收站" : p.query ? "搜索结果" : p.folder ? folderPath(p.folders, p.folder) : "最近编辑"}</span>
                    <span>{p.total}</span>
                </div>
                <div className="knowledge-document-list">
                    {p.items.map((d) => (
                        <button key={d.id} draggable onDragStart={e => e.dataTransfer.setData(knowledgeDragType, JSON.stringify({ spaceId: p.space, documentId: d.id }))} className={d.id === p.active ? "active" : ""} aria-current={d.id === p.active ? "page" : undefined} onClick={() => p.onOpen(d.id)}>
                            <FileText size={15} />
                            <span>
                                <strong>{d.title}</strong>
                                <small>{d.excerpt?.replace(/\n/g, " ").slice(0, 68) || "空白文档"}</small>
                            </span>
                        </button>
                    ))}
                    {!p.items.length && <div className="knowledge-nav-empty">{p.query ? "没有匹配的知识" : "从一篇文档开始积累"}</div>}
                </div>
            </div>
            <div className="knowledge-nav-footer">
                <Pagination simple current={p.page} total={p.total} pageSize={20} onChange={p.onPage} size="small" />
                <Button type="text" aria-pressed={p.trash} icon={<Trash2 size={14} />} onClick={p.onTrash}>
                    {p.trash ? "返回文档" : "回收站"}
                </Button>
            </div>
        </aside>
    );
}
