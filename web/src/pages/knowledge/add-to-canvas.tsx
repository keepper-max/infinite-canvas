import { useEffect, useRef, useState } from "react";
import { Alert, App, Button, Checkbox, Modal, Select } from "antd";
import { useNavigate } from "react-router-dom";
import localforage from "localforage";
import { useAuth } from "@/components/auth/auth-context";
import { listProjects, PlatformApiError } from "@/services/api/platform";
import { getCanvas } from "@/services/api/canvas";
import { ensureKnowledgeSpace, getKnowledgeDocument, getKnowledgeReceipt, knowledgeAction, type KnowledgeSpace } from "@/services/api/knowledge";
import { addKnowledgeToCanvas, knowledgeCanvasReceipt, type KnowledgeCanvasAdd, type KnowledgeReference } from "@/services/api/knowledge-canvas";

type Target = { space: KnowledgeSpace; documentId: string };
type Pending = { projectId: string; input: KnowledgeCanvasAdd; copy?: { spaceId: string; operation: Parameters<typeof knowledgeAction>[1] } };
const journal = localforage.createInstance({ name: "infinite-canvas", storeName: "knowledge_canvas_actions" });
export default function AddToCanvas({ target, projectId, prepareLeave, onClose }: { target: Target | null; projectId: string; prepareLeave: () => Promise<void>; onClose: () => void }) {
    const { user } = useAuth(),
        { message } = App.useApp(),
        navigate = useNavigate(),
        [projects, setProjects] = useState<Awaited<ReturnType<typeof listProjects>>>([]),
        [project, setProject] = useState(projectId),
        [mode, setMode] = useState<"latest" | "pinned">("latest"),
        [copy, setCopy] = useState(false),
        [busy, setBusy] = useState(false),
        [error, setError] = useState(""),
        [conflict, setConflict] = useState(false),
        [pending, setPending] = useState<Pending | null>(null);
    let tab = sessionStorage.getItem("knowledge-tab");
    if (!tab) {
        tab = crypto.randomUUID();
        sessionStorage.setItem("knowledge-tab", tab);
    }
    const key = user.id + ":add-knowledge:" + tab,
        flight = useRef(false);
    useEffect(() => {
        if (!target) return;
        let live = true;
        setError("");
        setCopy(false);
        setProject(target.space.project_id || projectId);
        void listProjects()
            .then((r) => {
                if (live) setProjects(r);
            })
            .catch((e) => {
                if (live) setError(e.message);
            });
        void journal.getItem<Pending>(key).then((v) => {
            if (live) {
                setPending(v);
                if (v) setProject(v.projectId);
            }
        });
        return () => {
            live = false;
        };
    }, [target?.documentId, target?.space.id, key, projectId]);
    const submit = async () => {
        if (!target || flight.current) return;
        flight.current = true;
        setBusy(true);
        setError("");
        setConflict(false);
        let operation = pending;
        try {
            await prepareLeave();
            if (!operation) {
                let document = await getKnowledgeDocument(target.space.id, target.documentId);
                if (document.deletedAt) throw new Error("文档已删除，请先恢复");
                if (target.space.kind === "personal" && !copy) throw new Error("请确认复制为独立项目知识，个人知识不会自动共享");
                if (target.space.kind === "project" && target.space.project_id !== project) throw new Error("请选文档所属项目；首版不提供跨项目授权引用");
                const canvas = await getCanvas(project);
                const position = { x: (320 - canvas.viewport.x) / canvas.viewport.k, y: (220 - canvas.viewport.y) / canvas.viewport.k };
                for (const n of [...canvas.nodes].sort((a, b) => a.position.x - b.position.x))
                    if (position.x < n.position.x + n.width && position.x + 340 > n.position.x && position.y < n.position.y + n.height && position.y + 230 > n.position.y) position.x = n.position.x + n.width + 40;
                const reference: KnowledgeReference = mode === "pinned" ? { spaceId: document.spaceId, documentId: document.id, mode, revision: document.revision } : { spaceId: document.spaceId, documentId: document.id, mode };
                operation = { projectId: project, input: { operationId: crypto.randomUUID(), expectedCanvasRevision: canvas.revision, reference, position } };
                if (target.space.kind === "personal") {
                    const s = await ensureKnowledgeSpace("project", project);
                    operation.copy = { spaceId: s.id, operation: { operationId: crypto.randomUUID(), action: "document.copyFrom", payload: { sourceSpaceId: document.spaceId, sourceDocumentId: document.id, sourceRevision: document.revision } } };
                }
                await journal.setItem(key, operation);
                setPending(operation);
            }
            if (operation.copy) {
                let result;
                try {
                    result = await getKnowledgeReceipt(operation.copy.spaceId, operation.copy.operation.operationId);
                } catch (e) {
                    if (!(e instanceof PlatformApiError && e.code === "KNOWLEDGE_OPERATION_NOT_FOUND")) throw e;
                }
                result ??= await knowledgeAction(operation.copy.spaceId, operation.copy.operation);
                operation.input.reference = operation.input.reference.mode === "pinned" ? { spaceId: result.spaceId, documentId: result.id, mode: "pinned", revision: result.revision } : { spaceId: result.spaceId, documentId: result.id, mode: "latest" };
                operation = { ...operation, copy: undefined };
                await journal.setItem(key, operation);
                setPending(operation);
            }
            // Query the original receipt before retrying an ambiguous operation.
            let receipt = await knowledgeCanvasReceipt(operation.projectId, operation.input.operationId);
            receipt ??= await addKnowledgeToCanvas(operation.projectId, operation.input);
            await journal.removeItem(key);
            setPending(null);
            message.success(`知识节点已保存 · 画布 r${receipt.revision}`);
            onClose();
            navigate(`/canvas/${operation.projectId}?knowledgeNode=${receipt.result.createdNodeId}`);
        } catch (e) {
            const err = e as PlatformApiError;
            if (err.code === "KNOWLEDGE_REVISION_CONFLICT" && operation?.copy) {
                // A definitive source CAS rejection rolls back the entire copy.
                await journal.removeItem(key);
                setPending(null);
                setError("来源已更新，本次未复制。请检查原文后重新添加。");
                return;
            }
            setError(err.message);
            setConflict(err.code === "CANVAS_REVISION_CONFLICT");
        } finally {
            flight.current = false;
            setBusy(false);
        }
    };
    return (
        <Modal
            title="引用到创作画布"
            open={!!target}
            onCancel={() => {
                if (!busy) onClose();
            }}
            footer={
                <>
                    <Button onClick={onClose} disabled={busy}>
                        取消
                    </Button>
                    <Button loading={busy} onClick={() => void submit()} disabled={!project || conflict}>
                        {pending ? "核查并继续原操作" : "添加到画布"}
                    </Button>
                </>
            }
        >
            <div className="flex flex-col gap-4 py-3">
                <p>只创建文档引用节点，不会把 Wiki Links 转换成创作执行边。</p>
                {error && <Alert type="error" title={error} />}
                {pending && <Alert type="info" title="已保留原操作，回执不明时不会新建操作ID。" />}
                {conflict && (
                    <Button
                        onClick={() =>
                            void (async () => {
                                try {
                                    if (!pending) return;
                                    if (await knowledgeCanvasReceipt(pending.projectId, pending.input.operationId)) return submit();
                                    const current = await getCanvas(pending.projectId);
                                    const next = { ...pending, input: { ...pending.input, operationId: crypto.randomUUID(), expectedCanvasRevision: current.revision } };
                                    await journal.setItem(key, next);
                                    setPending(next);
                                    setConflict(false);
                                    setError("");
                                } catch (e) {
                                    setError((e as Error).message);
                                }
                            })()
                        }
                    >
                        确认冲突后重新读取画布版本
                    </Button>
                )}
                <Select
                    aria-label="添加知识的目标画布"
                    value={project || undefined}
                    disabled={!!pending}
                    onChange={setProject}
                    options={projects.filter((p) => ["owner", "admin", "editor"].includes(p.role) && (target?.space.kind !== "project" || p.projectId === target.space.project_id)).map((p) => ({ value: p.projectId, label: p.projectTitle }))}
                />
                <Select
                    aria-label="添加知识的引用模式"
                    value={mode}
                    disabled={!!pending}
                    onChange={setMode}
                    options={[
                        { value: "latest", label: "Latest · 执行时读取最新文档" },
                        { value: "pinned", label: "Pinned · 固定当前已保存版本" },
                    ]}
                />
                {target?.space.kind === "personal" && (
                    <Checkbox checked={copy} disabled={!!pending} onChange={(e) => setCopy(e.target.checked)}>
                        复制为独立项目文档，项目成员可读取；原文不共享，副本不自动同步。附件仅保留引用，仍受素材权限限制。
                    </Checkbox>
                )}
                <small>未保存编辑会保留为草稿。节点引用服务器已保存的版本。</small>
            </div>
        </Modal>
    );
}
