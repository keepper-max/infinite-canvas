import { formatCreditPoints } from "@/lib/credit-display";
import { useEffect, useRef, useState } from "react";
import { App, Alert, Button, Input, InputNumber, Select, Space, Spin, Switch, Table, Tag, Modal } from "antd";
import { Link } from "react-router-dom";
import { useAuth } from "@/components/auth/auth-context";
import { getAgentAdmin, saveAgentAdmin, verifyAgentModel, type AgentAdminSnapshot, type AgentAdminPolicy } from "@/services/api/agent-admin";
import { cancelAgentRun, getAgentTrace } from "@/services/api/native-agent";
import { randomUuid } from "@/lib/utils";
export default function AgentModels() {
    const [trace, setTrace] = useState<unknown>(null);
    const { modal, message } = App.useApp();
    const { user, workspace } = useAuth(),
        [data, setData] = useState<AgentAdminSnapshot | null>(null),
        [draft, setDraft] = useState<AgentAdminPolicy | null>(null),
        [error, setError] = useState(""),
        [busy, setBusy] = useState(false),
        [reason, setReason] = useState(""),
        [projectId, setProjectId] = useState(workspace.projectId),
        [verifyBudget, setVerifyBudget] = useState(100);
    const pending = useRef(new Map<string, string>());
    const load = async (reset = false) => {
        try {
            const next = await getAgentAdmin();
            setData(next);
            if (reset || !draft) setDraft(next.settings);
            for (const run of next.runs) if (run.purpose === "model_probe" && ["completed", "failed", "cancelled"].includes(run.status) && pending.current.get(run.model_id) === run.operation_id) pending.current.delete(run.model_id);
            for (const run of next.runs) if (run.purpose === "model_probe" && !["completed", "failed", "cancelled"].includes(run.status)) pending.current.set(run.model_id, run.operation_id);
            setError("");
        } catch (e) {
            setError(e instanceof Error ? e.message : "加载Agent配置失败");
        }
    };
    useEffect(() => {
        void load(true);
    }, []);
    const set = <K extends keyof AgentAdminPolicy>(key: K, value: AgentAdminPolicy[K]) => setDraft((old) => (old ? { ...old, [key]: value } : old));
    const verify = (model: AgentAdminSnapshot["models"][number]) =>
        modal.confirm({
            title: "实际工具调用核验",
            content: `使用当前管理员积分账号，模型${model.display_name}，只读当前填写项目，不写画布。预算上限${formatCreditPoints(verifyBudget)}，按既有积分账本结算；提交不明保留预留并停止，不自动重试。`,
            okText: "确认费用并核验",
            cancelText: "取消",
            onOk: async () => {
                const operationId = pending.current.get(model.id) ?? randomUuid();
                pending.current.set(model.id, operationId);
                setBusy(true);
                try {
                    const run = await verifyAgentModel(projectId, model.id, verifyBudget, operationId);
                    message.success("核验已启动，请刷新记录查看结果");
                    await load();
                    return run;
                } catch (e) {
                    setError((e instanceof Error ? e.message : "核验失败") + "；请先刷新运行记录，不要另建操作盲目重试。");
                    throw e;
                } finally {
                    setBusy(false);
                }
            },
        });
    if (!draft && !error) return <Spin />;
    return (
        <section className="mx-auto max-w-7xl space-y-7 px-6 py-8" aria-label="Agent模型管理">
            <header className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h1 className="text-xl font-semibold">AI 配置 · Agent 模型管理</h1>
                    <p className="mt-2 text-sm text-muted-foreground">复用平台模型、服务器凭据及积分账本；只有实际核验通过的模型可开放执行。</p>
                </div>
                <Button onClick={() => void load()} loading={busy}>
                    刷新状态
                </Button>
            </header>
            {error && <Alert type="error" title={error} showIcon action={<Button onClick={() => void load(true)}>重新加载</Button>} />}
            {draft && (
                <>
                    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                        <label className="flex items-center justify-between gap-4">
                            全用户 Agent 基础功能
                            <Switch aria-label="全局Agent开关" checked={draft.enabled} onChange={(v) => set("enabled", v)} />
                        </label>
                        <label className="flex items-center justify-between gap-4">
                            用户可切换模型
                            <Switch aria-label="用户可切换模型" checked={draft.userModelSelectionEnabled} onChange={(v) => set("userModelSelectionEnabled", v)} />
                        </label>
                        <label className="flex items-center justify-between gap-4">
                            仅Agent授权知识推理
                            <Switch aria-label="Agent知识推理" checked={draft.knowledgeReasoningEnabled} onChange={(v) => set("knowledgeReasoningEnabled", v)} />
                        </label>
                        <label className="space-y-2">
                            <span>平台默认模型</span>
                            <Select
                                aria-label="平台默认Agent模型"
                                className="w-full"
                                allowClear
                                value={draft.defaultModelId ?? undefined}
                                onChange={(v) => set("defaultModelId", v ?? null)}
                                options={data?.models.filter((m) => m.verified && draft.allowedModelIds.includes(m.id)).map((m) => ({ value: m.id, label: m.display_name }))}
                            />
                        </label>
                        <label className="space-y-2">
                            <span>每Run累计积分上限</span>
                            <InputNumber aria-label="每Run积分上限" className="!w-full" min={0} precision={0} suffix="积分" value={draft.maxBudgetCents} onChange={(v) => set("maxBudgetCents", Number(v ?? 0))} />
                        </label>
                        {(
                            [
                                ["rounds", "每次批准模型轮次", 16],
                                ["tools", "每次批准工具次数", 32],
                                ["totalTokens", "每次批准Token", 64000],
                                ["activeMs", "每次批准执行时间（分钟）", 15],
                                ["concurrency", "全局执行并发", 2],
                            ] as const
                        ).map(([key, label, max]) => (
                            <label key={key} className="space-y-2">
                                <span>{label}</span>
                                <InputNumber
                                    aria-label={label}
                                    className="!w-full"
                                    min={1}
                                    max={max}
                                    precision={0}
                                    value={key === "activeMs" ? draft.limits[key] / 60000 : draft.limits[key]}
                                    onChange={(v) => set("limits", { ...draft.limits, [key]: Number(v ?? 1) * (key === "activeMs" ? 60000 : 1) })}
                                />
                            </label>
                        ))}
                    </div>
                    <p className="text-xs leading-6 text-muted-foreground">
                        单账号固定1个未结束Run（数据库唯一约束）；12k上下文、2k输出及现有超时不变。技术上限本版仅可收紧。续跑需要用户再次确认预算，累计费用仍受每Run上限保护。关闭Agent保留历史读取；原画布知识付费生成门禁不受此配置影响。
                    </p>
                    <div className="flex flex-wrap items-center gap-3">
                        <Input aria-label="Agent配置变更原因" className="max-w-lg" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="必填：配置变更原因（写入审计）" />
                        <Button
                            type="primary"
                            loading={busy}
                            disabled={!reason.trim()}
                            onClick={() => {
                                setBusy(true);
                                void saveAgentAdmin(draft, randomUuid(), reason)
                                    .then(() => {
                                        setReason("");
                                        return load(true);
                                    })
                                    .catch((e) => setError(e.message))
                                    .finally(() => setBusy(false));
                            }}
                        >
                            保存策略
                        </Button>
                        <span className="text-xs text-muted-foreground">已加载策略 v{draft.version}；仅新预算段采用新限制，已有模型不静默切换。</span>
                    </div>
                </>
            )}
            <section>
                <h2 className="mb-3 text-base font-semibold">平台文字模型与核验</h2>
                <Space wrap className="mb-4">
                    <Input aria-label="模型核验项目ID" className="!w-80" value={projectId} onChange={(e) => setProjectId(e.target.value)} placeholder="当前管理员有权限的项目ID" />
                    <InputNumber aria-label="模型核验积分预算" min={1} max={draft?.maxBudgetCents ?? 100} precision={0} suffix="积分" value={verifyBudget} onChange={(v) => setVerifyBudget(Number(v ?? 0))} />
                    <span className="text-xs text-muted-foreground">实际核验会消耗当前管理员积分；不会自动回退模型。</span>
                </Space>
                <Table
                    rowKey="id"
                    size="small"
                    pagination={{ pageSize: 10 }}
                    scroll={{ x: 1100 }}
                    dataSource={data?.models ?? []}
                    columns={[
                        {
                            title: "模型 / 供应商",
                            key: "model",
                            render: (_, m) => (
                                <>
                                    <b>{m.display_name}</b>
                                    <p className="text-xs text-muted-foreground">
                                        {m.id} · {m.provider_id}
                                    </p>
                                </>
                            ),
                        },
                        {
                            title: "平台状态",
                            key: "state",
                            render: (_, m) => (
                                <Space direction="vertical">
                                    <Tag color={m.enabled && m.healthy ? "green" : "default"}>{m.enabled && m.healthy ? "目录启用" : "目录停用/异常"}</Tag>
                                    <Tag>{m.credentialConfigured ? "服务器凭据已配置" : "凭据未配置或路由未核验"}</Tag>
                                </Space>
                            ),
                        },
                        {
                            title: "Tool Calling / 上下文",
                            key: "verified",
                            render: (_, m) => (
                                <>
                                    <Tag color={m.verified ? "green" : "default"}>{m.verified ? "实际工具与费用核验通过" : "未核验"}</Tag>
                                    <p className="max-w-xs text-xs text-muted-foreground">{m.verified ? `Runtime限制12k；${m.context_limit_tokens ? "目录声明" + m.context_limit_tokens + " Token（未实测全容量）" : "供应商容量未声明"}` : m.reason}</p>
                                </>
                            ),
                        },
                        {
                            title: "Agent开放",
                            key: "enabled",
                            render: (_, m) => (
                                <Switch
                                    aria-label={"Agent开放 " + m.id}
                                    checked={draft?.allowedModelIds.includes(m.id)}
                                    disabled={!draft?.allowedModelIds.includes(m.id) && (!m.verified || !m.enabled || !m.healthy)}
                                    onChange={(v) => {
                                        if (!draft) return;
                                        const ids = v ? [...draft.allowedModelIds, m.id] : draft.allowedModelIds.filter((id) => id !== m.id);
                                        setDraft({ ...draft, allowedModelIds: ids, defaultModelId: draft.defaultModelId === m.id && !v ? null : draft.defaultModelId });
                                    }}
                                />
                            ),
                        },
                        {
                            title: "验证",
                            key: "probe",
                            render: (_, m) => (
                                <Button disabled={!m.supported || !m.credentialConfigured || !m.enabled || !m.healthy || !draft?.enabled || busy || !projectId || verifyBudget <= 0} onClick={() => verify(m)}>
                                    实际核验
                                </Button>
                            ),
                        },
                    ]}
                />
            </section>
            <section>
                <h2 className="mb-3 text-base font-semibold">Token、积分消耗和运行状态</h2>
                <Table
                    size="small"
                    rowKey="model_id"
                    dataSource={data?.usage ?? []}
                    pagination={false}
                    scroll={{ x: 900 }}
                    columns={[
                        { title: "模型", dataIndex: "model_id" },
                        { title: "Run", dataIndex: "runs" },
                        { title: "暂停/失败（占Run）", render: (_, row) => `${row.failures} / ${row.runs} (${row.runs ? ((100 * row.failures) / row.runs).toFixed(1) : "0"}%)` },
                        { title: "输入 / 输出Token", render: (_, row) => `${row.input_tokens} / ${row.output_tokens}` },
                        { title: "供应商实际成本（元）", dataIndex: "supplier_cny" },
                        { title: "用户实际积分", dataIndex: "charged_points" },
                    ]}
                />
            </section>
            <section>
                <h2 className="mb-3 text-base font-semibold">最近执行与核验记录</h2>
                <Table
                    size="small"
                    rowKey="id"
                    dataSource={data?.runs ?? []}
                    scroll={{ x: 1100 }}
                    pagination={{ pageSize: 10 }}
                    columns={[
                        {
                            title: "运行",
                            render: (_, run) => (
                                <>
                                    <Link to={"/canvas/" + run.project_id}>{run.id}</Link>
                                    <p className="text-xs">{run.purpose === "model_probe" ? "只读模型核验" : "用户运行"}</p>
                                </>
                            ),
                        },
                        { title: "模型", dataIndex: "model_id" },
                        {
                            title: "状态",
                            render: (_, run) => (
                                <>
                                    {run.status}
                                    <p>{run.error_code}</p>
                                </>
                            ),
                        },
                        { title: "结算 / 预留积分", render: (_, run) => `${formatCreditPoints(run.spent_cents)} / ${formatCreditPoints(run.reserved_cents)}` },
                        {
                            title: "操作",
                            render: (_, run) =>
                                run.actor_id === user.id ? (
                                    <Space wrap>
                                        <Button
                                            onClick={() =>
                                                void getAgentTrace(run.session_id)
                                                    .then(setTrace)
                                                    .catch((e) => setError(e.message))
                                            }
                                        >
                                            技术追踪
                                        </Button>
                                        {!["completed", "failed", "cancelled"].includes(run.status) ? (
                                            <Button
                                                onClick={() =>
                                                    void cancelAgentRun(run.id)
                                                        .then(() => load())
                                                        .catch((e) => setError(e.message))
                                                }
                                            >
                                                停止此运行
                                            </Button>
                                        ) : null}
                                    </Space>
                                ) : null,
                        },
                    ]}
                />
                <p className="mt-3 text-xs text-muted-foreground">未知提交仍保持待核验预留；退款、供应商账单和人工审核继续使用既有任务与计费后台。</p>
                <details className="mt-3">
                    <summary>核验审计详情</summary>
                    <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(data?.verifications ?? [], null, 2)}</pre>
                </details>
                <Modal title="管理员技术追踪（已脱敏）" open={trace !== null} onCancel={() => setTrace(null)} footer={null}>
                    <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(trace, null, 2)}</pre>
                </Modal>
            </section>
        </section>
    );
}
