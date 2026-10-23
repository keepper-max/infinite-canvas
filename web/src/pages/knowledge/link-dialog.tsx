import { useEffect, useState } from 'react';
import { Alert, App, Button, Modal, Select, Spin } from 'antd';
import { getKnowledgeDocument, getKnowledgeRelations, listKnowledge, previewKnowledgeLink, type KnowledgeDocument, type KnowledgeLinkPreview } from '@/services/api/knowledge';
import { useKnowledgeActions } from './use-actions';
type Props = { actor: string; space: string; sourceId: string; mode: 'add' | 'remove' | 'view'; onClose: () => void; onSaved: (id: string) => void; onOpen: (id: string, start?: number, end?: number) => void };
export default function KnowledgeLinkDialog(p: Props) {
    const { message } = App.useApp(), [source, setSource] = useState<KnowledgeDocument | null>(null), [targets, setTargets] = useState<{ id: string; title: string; folderId?: string | null }[]>([]), [target, setTarget] = useState(''), [query, setQuery] = useState(''), [preview, setPreview] = useState<KnowledgeLinkPreview | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false), [attempt, retry] = useState(0);
    const actions = useKnowledgeActions(p.actor, p.space, (_, result) => { message.success(result.alreadyLinked ? '已存在关联，原文未重复插入' : '关联已保存到文档'); p.onSaved(result.id); p.onClose(); }, 'relations');
    useEffect(() => { let live = true; setError(''); void getKnowledgeDocument(p.space, p.sourceId).then(d => { if (live) setSource(d); }).catch(e => { if (live) setError(e.message); }); return () => { live = false; }; }, [p.space, p.sourceId, attempt]);
    useEffect(() => {
        const controller = new AbortController();
        if (p.mode === 'add') void listKnowledge(p.space, { q: query, page: 1, pageSize: 20 }, controller.signal).then(r => { if (!controller.signal.aborted) setTargets(r.items); }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
        else void getKnowledgeRelations(p.space, p.sourceId).then(r => { if (!controller.signal.aborted) setTargets([...new Map(r.outgoing.filter(l => l.target_id).map(l => [l.target_id!, { id: l.target_id!, title: l.target_title || l.target_text }])).values()]); }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
        return () => controller.abort();
    }, [p.space, p.sourceId, p.mode, query, attempt]);
    useEffect(() => { let live = true; setPreview(null); if (!target) return; setLoading(true); setError(''); void previewKnowledgeLink(p.space, p.sourceId, target, p.mode === 'add' ? 'add' : 'remove').then(v => { if (live) setPreview(v); }).catch(e => { if (live) setError(e.message); }).finally(() => { if (live) setLoading(false); }); return () => { live = false; }; }, [target, p.space, p.sourceId, p.mode, attempt]);
    const confirm = async () => { if (!preview || preview.requiresEditor || p.mode === 'view') return; await actions.run({ operationId: crypto.randomUUID(), action: p.mode === 'add' ? 'document.linkAdd' : 'document.linkRemove', payload: { id: p.sourceId, expectedRevision: preview.expectedRevision, targetId: target } }); };
    return <Modal open title={p.mode === 'add' ? '建立知识关联' : p.mode === 'view' ? '查看来源引用' : '移除知识关联'} onCancel={p.onClose} footer={<><Button onClick={p.onClose}>关闭</Button>{actions.pending ? <Button disabled={actions.busy} onClick={() => void actions.run()}>查询原操作回执</Button> : p.mode !== 'view' && <Button type="primary" disabled={!preview || preview.requiresEditor || !actions.ready || loading} loading={actions.busy} onClick={() => void confirm()}>{p.mode === 'add' ? '确认建立关联' : '确认移除这一处引用'}</Button>}</>} width="min(760px, 96vw)">
        <p>来源文档：{source?.title || '正在读取'} · 确认后会更新这篇文档中的双向链接。</p>
        <Select aria-label="目标知识文档" placeholder={p.mode === 'add' ? '搜索并选择目标文档' : '选择要查看的正向引用'} showSearch={{ filterOption: false, onSearch: setQuery }} value={target || undefined} onChange={setTarget} style={{ width: '100%' }} options={targets.map(t => ({ value: t.id, label: `${t.title} · ${t.folderId ? '文件夹 ' + t.folderId.slice(0, 8) : '根目录'} · ${t.id.slice(0, 8)}` }))} />
        <p>{source?.title || '来源'} → {targets.find(t => t.id === target)?.title || '目标文档'}（正向引用；目标文档会显示反向引用）</p>
        {(error || actions.error) && <Alert type="warning" title={error || actions.error} action={<Button onClick={() => retry(n => n + 1)}>重新读取预览</Button>} />}
        {actions.busy && <Button type="text" onClick={actions.stopWaiting}>停止等待并保留原操作</Button>}
        {loading && <Spin />}
        {preview && <>{preview.alreadyLinked && <Alert type="info" title="已有关联，不会重复插入引用" />}{preview.existingReference && <Alert type="info" title="将现有未消歧引用绑定到所选文档，原文保持不变" />}{preview.requiresEditor && <Alert type="warning" title="有多个引用或无法可靠定位，需在文档中选择具体引用；不会自动删除" />}
            <h4>{p.mode === 'add' ? '确认后来源文档的内容预览' : '当前来源原文（只移除已定位的那一处）'}</h4><pre className="knowledge-link-preview">{p.mode === 'add' ? preview.markdown : preview.beforeMarkdown}</pre>
            {p.mode === 'remove' && !preview.requiresEditor && <><h4>确认移除后的内容预览</h4><pre className="knowledge-link-preview">{preview.markdown}</pre></>}
            {(preview.occurrences || []).map(r => <Button key={r.ordinal} type="text" onClick={() => p.onOpen(p.sourceId, r.start ?? undefined, r.end ?? undefined)}>查看来源引用 {r.ordinal + 1}：{r.text}</Button>)}
            {p.mode !== 'add' && !(preview.occurrences || []).length && <Button onClick={() => p.onOpen(p.sourceId)}>打开来源文档定位</Button>}
        </>}
    </Modal>;
}
