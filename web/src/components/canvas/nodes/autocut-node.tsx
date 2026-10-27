import { App, Button, Input, InputNumber, Progress } from "antd";
import { Scissors } from "lucide-react";
import { useState } from "react";
import { registerNodeDefinitions } from "@/lib/canvas/node-registry";
import { createAutoCutProject, getAutoCutProject, startAutoCutTask, cancelAutoCutTask } from "@/services/api/autocut";
import type { CanvasNodeContext } from "@/types/canvas-plugin";

function Content({ ctx }: { ctx: CanvasNodeContext }) {
    const project = ctx.node.metadata?.autocut?.projectId;
    return (
        <div className="flex h-full flex-col justify-center gap-3 p-4" style={{ color: ctx.theme.node.text }}>
            {ctx.node.metadata?.content ? (
                <video controls playsInline className="max-h-40 w-full" src={ctx.node.metadata.content} />
            ) : (
                <div className="flex items-center justify-center gap-2 text-sm">
                    <Scissors size={20} />
                    {ctx.node.metadata?.jobStatusMessage || "将素材连接到这里，交给 AI 剪辑"}
                </div>
            )}
            {ctx.node.metadata?.status === "loading" && <Progress percent={ctx.node.metadata.jobProgress || 0} size="small" />}
            {ctx.node.metadata?.errorDetails && <p className="text-xs">{ctx.node.metadata.errorDetails}</p>}
            {project && (
                <a className="text-xs underline" href={`/autocut?edit=${encodeURIComponent(project)}&workspace=${encodeURIComponent(ctx.projectId)}`}>
                    打开剪辑工程与时间线
                </a>
            )}
        </div>
    );
}
function Panel({ ctx }: { ctx: CanvasNodeContext }) {
    const { modal, message } = App.useApp(),
        [busy, setBusy] = useState(false);
    const state = ctx.node.metadata?.autocut;
    async function start() {
        setBusy(true);
        try {
            const versions = [...new Set(ctx.getUpstream().flatMap((n) => (n.metadata?.assetVersionId ? [n.metadata.assetVersionId] : [])))];
            let id = state?.projectId;
            if (!id) {
                if (!versions.length) throw new Error("请连接已上传云端的视频、图片或音频素材");
                id = (await createAutoCutProject(ctx.projectId, ctx.node.title || "智能剪辑", versions)).id;
                ctx.updateMetadata({ autocut: { ...state, projectId: id } });
            }
            const detail = await getAutoCutProject(id);
            const task = await startAutoCutTask(id, {
                operationId: crypto.randomUUID(),
                expectedRevision: detail.project.current_revision_id,
                kind: "edit",
                prompt: ctx.node.metadata?.prompt || "",
                mode: "auto",
                targetDurationMs: 60000,
                aspectRatio: "9:16",
                budgetCents: state?.budgetCents || 0,
                confirmed: true,
            });
            ctx.updateMetadata({ status: "loading", autocut: { ...state, projectId: id, taskId: task.id } });
        } catch (e) {
            void message.error(e instanceof Error ? e.message : "剪辑启动失败");
        } finally {
            setBusy(false);
        }
    }
    return (
        <div className="space-y-3 p-4">
            <Input.TextArea aria-label="智能剪辑要求" rows={3} value={ctx.node.metadata?.prompt || ""} onChange={(e) => ctx.updateMetadata({ prompt: e.target.value })} placeholder="不填也可以直接帮我剪。素材连接后将导入独立剪辑工程。" />
            <label className="flex items-center justify-between text-xs">
                本次预算（元）
                <InputNumber aria-label="剪辑预算" max={10} min={0.01} precision={2} value={state?.budgetCents ? state.budgetCents / 100 : null} onChange={(v) => ctx.updateMetadata({ autocut: { ...state, budgetCents: Math.round((v || 0) * 100) } })} />
            </label>
            <div className="flex gap-2">
                <Button
                    type="primary"
                    loading={busy}
                    disabled={!state?.budgetCents || ctx.node.metadata?.status === "loading"}
                    onClick={() => modal.confirm({ title: "开始智能剪辑？", content: `AI 智能剪辑 · 测试版。关键帧和转写将提交现有模型分析，请确认有素材使用权并允许此处理。本次预算上限 ¥${((state?.budgetCents || 0) / 100).toFixed(2)}，将复用已有分析。`, onOk: start })}
                >
                    开始剪辑
                </Button>
                {state?.projectId && state.taskId && ctx.node.metadata?.status === "loading" && <Button onClick={() => void cancelAutoCutTask(state.projectId!, state.taskId!).catch((e) => message.error(e.message))}>取消</Button>}
            </div>
            {state?.projectId && <p className="text-xs">当前工程使用初次导入的素材；增添素材请在工作台新建工程。</p>}
        </div>
    );
}
export function registerAutoCutNode() {
    registerNodeDefinitions([
        {
            type: "autocut:editor",
            workflowKind: "autocut.edit",
            definitionVersion: 1,
            title: "智能剪辑",
            icon: <Scissors />,
            description: "理解已有素材，生成可编辑时间线与成片",
            defaultSize: { width: 360, height: 260 },
            autoOpenPanel: true,
            Content,
            Panel,
            ports: [
                { id: "autocut.input", label: "素材", direction: "input", resourceTypes: ["video", "image", "audio", "asset"], roles: ["data", "video_input", "audio_input"], cardinality: "many" },
                { id: "autocut.video", label: "成片", direction: "output", resourceTypes: ["video"], roles: ["data"], cardinality: "many" },
                { id: "autocut.timeline", label: "剪辑工程", direction: "output", resourceTypes: ["timeline"], roles: ["data"], cardinality: "many" },
            ],
            resource: (n) => (n.metadata?.content ? { kind: "video", url: n.metadata.content } : null),
            execution: { capability: "compose" },
            execute: async (ctx) => {
                ctx.openPanel();
            },
        },
    ]);
}
