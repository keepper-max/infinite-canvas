import { useEffect, useState } from "react";
import { App, Button, Drawer, Empty, Popconfirm, Spin } from "antd";
import { History } from "lucide-react";
import { useParams } from "react-router-dom";
import { listCanvasSnapshots, type CanvasSnapshotSummary } from "@/services/api/canvas";

export function CanvasSnapshotHistory({ onRestore }: { onRestore: (version: number) => Promise<void> }) {
    const { id } = useParams();
    const { message } = App.useApp();
    const [open, setOpen] = useState(false), [loading, setLoading] = useState(false), [busy, setBusy] = useState(false);
    const [rows, setRows] = useState<CanvasSnapshotSummary[]>([]);
    useEffect(() => {
        if (!open || !id) return;
        let disposed = false;
        setLoading(true);
        listCanvasSnapshots(id).then(value => { if (!disposed) setRows(value); }).catch(() => message.error("历史版本加载失败，请重试")).finally(() => { if (!disposed) setLoading(false); });
        return () => { disposed = true; };
    }, [open, id, message]);
    return <>
        <Button type="text" aria-label="画布历史版本" title="画布历史版本" icon={<History className="size-4" />} onClick={() => setOpen(true)} />
        <Drawer title="画布历史版本" open={open} width="min(440px, 100vw)" closable={!busy} maskClosable={!busy} keyboard={!busy} onClose={() => { if (!busy) setOpen(false); }}>
            <div onKeyDownCapture={event => { if (event.key !== "Escape") event.stopPropagation(); }}>
                <p className="mb-4 text-sm opacity-70">恢复会先保存当前画布，再创建更高版本；原始历史不会删除。</p>
                <Spin spinning={loading || busy}>{!rows.length && !loading ? <Empty description="暂无历史版本" /> : rows.map(row => <div key={row.version} className="flex items-center justify-between gap-3 border-b border-current/10 py-3">
                    <div><div>版本 {row.version}</div><div className="text-xs opacity-70">{new Date(row.createdAt).toLocaleString()}</div>{row.restorable !== true && <div className="mt-1 text-sm">{row.restoreReason || "历史版本不兼容，暂不可恢复"}</div>}</div>
                    <Popconfirm title="保存当前画布并恢复此版本？" disabled={row.restorable !== true || busy} onConfirm={async () => { setBusy(true); try { await onRestore(row.version); setOpen(false); message.success("已恢复为新的画布版本"); } catch (error) { message.error(error instanceof Error ? error.message : "恢复失败，当前画布已保留"); } finally { setBusy(false); } }}><Button disabled={row.restorable !== true || busy}>恢复</Button></Popconfirm>
                </div>)}</Spin>
            </div>
        </Drawer>
    </>;
}
