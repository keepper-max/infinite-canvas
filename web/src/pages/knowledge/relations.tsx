import { ArrowUpRight, Link2, PanelRightClose } from "lucide-react";
import type { KnowledgeRelations } from "@/services/api/knowledge";
export default function Relations({ relations, onOpen, onWiki, onCollapse }: { relations: KnowledgeRelations | null; onOpen: (id: string) => void; onWiki: (target: string) => void; onCollapse: () => void }) {
    return (
        <aside className="knowledge-relations" aria-label="文档关系">
            <header className="knowledge-nav-heading">
                <span>文档关系</span>
                <button aria-label="收起文档关系" onClick={onCollapse}>
                    <PanelRightClose size={16} />
                </button>
            </header>
            <div className="knowledge-section-label">
                正向链接 <span>{relations?.outgoing.length ?? 0}</span>
            </div>
            {relations?.outgoing.map((l) => (
                <button className="knowledge-reference" key={l.ordinal} onClick={() => (l.target_id ? onOpen(l.target_id) : onWiki(l.target_text))}>
                    <Link2 size={14} />
                    <span>
                        <strong>{l.display_text || l.target_text}</strong>
                        <small>{l.status === "resolved" ? l.target_title : l.status === "ambiguous" ? "同名文档 · 请选择" : "未解析 · 尚无对应文档"}</small>
                    </span>
                    <ArrowUpRight size={13} />
                </button>
            ))}
            {!relations?.outgoing.length && <p className="knowledge-muted">用 [[文档名]] 建立引用。</p>}
            <div className="knowledge-section-label">
                反向引用 <span>{relations?.backlinks.length ?? 0}</span>
            </div>
            {relations?.backlinks.map((l) => (
                <button className="knowledge-reference" key={l.id} onClick={() => onOpen(l.id)}>
                    <Link2 size={14} />
                    <span>
                        <strong>{l.title}</strong>
                        <small>引用了当前文档</small>
                    </span>
                    <ArrowUpRight size={13} />
                </button>
            ))}
            {!relations?.backlinks.length && <p className="knowledge-muted">还没有文档引用此处。</p>}
            <div className="knowledge-relations-note">
                链接只在当前知识空间中解析。
                <br />
                知识关系与画布执行连线独立。
            </div>
        </aside>
    );
}
