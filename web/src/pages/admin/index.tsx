import { ArrowLeft, Boxes, CircleDollarSign, ClipboardList, LayoutDashboard, ShieldCheck, Users } from "lucide-react";
import { Button, Drawer, Empty, Input, Modal, Select, Space, Spin, Switch, Table, Tag, message } from "antd";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { useAuth } from "@/components/auth/auth-context";
import {
    getAdminAuditLogs,
    getAdminAssetDownload,
    getAdminJobs,
    getAdminModels,
    getAdminOverview,
    getAdminProjectContent,
    getAdminUsage,
    getAdminUser,
    getAdminUsers,
    reconcileAdminJob,
    revokeAdminUserSessions,
    setAdminUserRole,
    setAdminUserStatus,
    type AdminAuditLog,
    type AdminJob,
    type AdminModel,
    type AdminOverview,
    type AdminUsage,
    type AdminUser,
    type AdminUserDetail,
    type UsageBreakdown,
} from "@/services/api/operations";

const sections = [
    { key: "overview", label: "概览", icon: LayoutDashboard },
    { key: "users", label: "账号", icon: Users },
    { key: "usage", label: "消耗", icon: CircleDollarSign },
    { key: "jobs", label: "任务", icon: ClipboardList },
    { key: "models", label: "模型", icon: Boxes },
    { key: "audit", label: "审计", icon: ShieldCheck },
] as const;

type Section = (typeof sections)[number]["key"];

export default function AdminPage() {
    const { user } = useAuth();
    const { section = "overview" } = useParams();
    const active = sections.some((item) => item.key === section) ? (section as Section) : "overview";
    if (!user.isAdmin) return <AdminForbidden />;
    return (
        <div className="flex h-dvh overflow-hidden bg-stone-950 text-stone-100">
            <aside className="flex w-60 shrink-0 flex-col border-r border-white/10 bg-stone-950 px-4 py-5">
                <Link to="/" className="mb-10 flex items-center gap-3 px-2 text-stone-100">
                    <span className="grid size-9 place-items-center rounded-xl border border-white/10 bg-white/5">
                        <ShieldCheck className="size-4" />
                    </span>
                    <span>
                        <b className="block text-sm">管理控制台</b>
                        <small className="text-stone-500">Admin workspace</small>
                    </span>
                </Link>
                <nav className="space-y-1">
                    {sections.map((item) => {
                        const Icon = item.icon;
                        return (
                            <Link
                                key={item.key}
                                to={`/admin/${item.key}`}
                                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${active === item.key ? "bg-white text-stone-950" : "text-stone-400 hover:bg-white/5 hover:text-white"}`}
                            >
                                <Icon className="size-4" />
                                {item.label}
                            </Link>
                        );
                    })}
                </nav>
                <div className="mt-auto border-t border-white/10 pt-4">
                    <Link to="/" className="flex items-center gap-2 px-3 py-2 text-sm text-stone-400 hover:text-white">
                        <ArrowLeft className="size-4" />
                        返回工作台
                    </Link>
                    <p className="mt-3 truncate px-3 text-xs text-stone-600">{user.email}</p>
                </div>
            </aside>
            <main className="min-w-0 flex-1 overflow-y-auto bg-stone-100 text-stone-950 dark:bg-stone-900 dark:text-stone-50">
                <div className="mx-auto max-w-[1500px] px-8 py-8">
                    <header className="mb-8 flex items-end justify-between">
                        <div>
                            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">System administration</p>
                            <h1 className="text-3xl font-semibold tracking-tight">{sections.find((item) => item.key === active)?.label}</h1>
                        </div>
                        <Tag bordered={false} color="green">
                            只读业务内容 · 操作留痕
                        </Tag>
                    </header>
                    <AdminSection section={active} />
                </div>
            </main>
        </div>
    );
}

function AdminForbidden() {
    return (
        <div className="grid h-dvh place-items-center bg-stone-950 text-stone-100">
            <div className="max-w-md text-center">
                <ShieldCheck className="mx-auto mb-5 size-10 text-stone-500" />
                <h1 className="text-2xl font-semibold">无权访问管理后台</h1>
                <p className="mt-2 text-sm text-stone-500">当前账号不是管理员，所有管理接口也会独立校验权限。</p>
                <Link to="/" className="mt-6 inline-block rounded-lg bg-white px-4 py-2 text-sm font-medium text-stone-950">
                    返回工作台
                </Link>
            </div>
        </div>
    );
}

function AdminSection({ section }: { section: Section }) {
    if (section === "overview") return <Overview />;
    if (section === "users") return <UsersPanel />;
    if (section === "usage") return <UsagePanel />;
    if (section === "jobs") return <JobsPanel />;
    if (section === "models") return <ModelsPanel />;
    return <AuditPanel />;
}

function Overview() {
    const [data, setData] = useState<AdminOverview>();
    const [error, setError] = useState("");
    useEffect(() => {
        const controller = new AbortController();
        getAdminOverview(controller.signal)
            .then(setData)
            .catch((value) => setError(value instanceof Error ? value.message : "加载失败"));
        return () => controller.abort();
    }, []);
    if (error) return <Empty description={error} />;
    if (!data) return <Loading />;
    const metrics = [
        ["用户", data.users],
        ["项目", data.projects],
        ["素材", data.assets],
        ["任务", data.totalJobs],
        ["运行中", data.activeJobs],
        ["失败", data.failedJobs],
    ];
    const peak = Math.max(1, ...data.trends.map((item) => item.jobs));
    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4 xl:grid-cols-6">
                {metrics.map(([label, value]) => (
                    <Metric key={String(label)} label={String(label)} value={String(value)} />
                ))}
            </div>
            <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
                <Panel title="近 30 天任务趋势" note={`成功率 ${(data.successRate * 100).toFixed(1)}%`}>
                    <div className="flex h-56 items-end gap-1">
                        {data.trends.map((item) => (
                            <div key={item.day} className="group relative flex h-full flex-1 items-end">
                                <div className="w-full rounded-t-sm bg-stone-900/80 transition group-hover:bg-blue-600 dark:bg-stone-200" style={{ height: `${Math.max(3, (item.jobs / peak) * 100)}%` }} />
                                <span className="pointer-events-none absolute bottom-full left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded bg-black px-2 py-1 text-[10px] text-white group-hover:block">
                                    {item.day} · {item.jobs} 个任务
                                </span>
                            </div>
                        ))}
                    </div>
                </Panel>
                <Panel title="实际结算消耗" note="按币种隔离汇总">
                    {data.usage.length ? (
                        <div className="space-y-3">
                            {data.usage.map((item) => (
                                <div key={item.currency} className="rounded-xl border border-stone-200 p-4 dark:border-white/10">
                                    <div className="flex items-center justify-between">
                                        <b>{item.currency}</b>
                                        <span className="font-mono text-xl">{item.totalAmount}</span>
                                    </div>
                                    <p className="mt-2 text-xs text-stone-500">
                                        {item.calls} 笔 · {item.totalTokens} Tokens · {item.videoDurationSeconds}s 视频
                                    </p>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <Empty description="暂无已对账账单" />
                    )}
                </Panel>
            </div>
        </div>
    );
}
function UsersPanel() {
    const [items, setItems] = useState<AdminUser[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [q, setQ] = useState("");
    const [status, setStatus] = useState<string>();
    const [isAdmin, setIsAdmin] = useState<boolean>();
    const [createdFrom, setCreatedFrom] = useState("");
    const [createdTo, setCreatedTo] = useState("");
    const [loading, setLoading] = useState(true);
    const [detailId, setDetailId] = useState<string>();
    const load = useCallback(() => {
        setLoading(true);
        getAdminUsers({ page, pageSize: 20, q, status, isAdmin, createdFrom, createdTo })
            .then((data) => {
                setItems(data.items);
                setTotal(data.total);
            })
            .catch((error) => message.error(error.message))
            .finally(() => setLoading(false));
    }, [createdFrom, createdTo, isAdmin, page, q, status]);
    useEffect(load, [load]);
    const updateStatus = (record: AdminUser) =>
        Modal.confirm({
            title: record.status === "active" ? "停用这个账号？" : "重新启用账号？",
            content: record.status === "active" ? "现有会话会立即撤销，但已提交任务仍会继续。" : "用户将可以重新登录和提交任务。",
            onOk: async () => {
                await setAdminUserStatus(record.id, record.status === "active" ? "disabled" : "active", record.status === "active" ? "管理员停用" : undefined);
                message.success("账号状态已更新");
                load();
            },
        });
    return (
        <Panel
            title="账号列表"
            note={`${total} 个账号`}
            actions={
                <Space>
                    <Input.Search
                        allowClear
                        placeholder="搜索邮箱"
                        onSearch={(value) => {
                            setPage(1);
                            setQ(value);
                        }}
                    />
                    <Select
                        allowClear
                        placeholder="账号状态"
                        className="w-32"
                        options={[
                            { value: "active", label: "正常" },
                            { value: "disabled", label: "已停用" },
                        ]}
                        onChange={(value) => {
                            setPage(1);
                            setStatus(value);
                        }}
                    />
                    <Select
                        allowClear
                        placeholder="身份"
                        className="w-28"
                        options={[
                            { value: true, label: "管理员" },
                            { value: false, label: "普通用户" },
                        ]}
                        onChange={(value) => {
                            setPage(1);
                            setIsAdmin(value);
                        }}
                    />
                    <Input
                        aria-label="注册开始日期"
                        type="date"
                        className="w-36"
                        value={createdFrom}
                        onChange={(event) => {
                            setPage(1);
                            setCreatedFrom(event.target.value);
                        }}
                    />
                    <Input
                        aria-label="注册结束日期"
                        type="date"
                        className="w-36"
                        value={createdTo}
                        onChange={(event) => {
                            setPage(1);
                            setCreatedTo(event.target.value);
                        }}
                    />
                </Space>
            }
        >
            <Table
                rowKey="id"
                loading={loading}
                dataSource={items}
                pagination={{ current: page, pageSize: 20, total, showSizeChanger: false, onChange: setPage }}
                columns={[
                    {
                        title: "账号",
                        dataIndex: "email",
                        render: (value, record) => (
                            <button className="text-left" onClick={() => setDetailId(record.id)}>
                                <b className="block">{value}</b>
                                <small className="font-mono text-stone-400">{record.id.slice(0, 8)}</small>
                            </button>
                        ),
                    },
                    {
                        title: "状态",
                        dataIndex: "status",
                        render: (value, record) => (
                            <Space>
                                <StatusTag value={value} />
                                {record.isAdmin ? <Tag>管理员</Tag> : null}
                            </Space>
                        ),
                    },
                    { title: "项目 / 任务", render: (_, record) => `${record.projectCount} / ${record.jobCount}` },
                    { title: "存储", dataIndex: "storageBytes", render: formatBytes },
                    {
                        title: "实际消耗",
                        dataIndex: "usageAmounts",
                        render: (value: Record<string, string>) =>
                            Object.entries(value || {})
                                .map(([currency, amount]) => `${currency} ${amount}`)
                                .join(" · ") || "—",
                    },
                    { title: "最近登录", dataIndex: "lastLoginAt", render: formatDate },
                    { title: "注册时间", dataIndex: "createdAt", render: formatDate },
                    {
                        title: "操作",
                        render: (_, record) => (
                            <Space>
                                <Button size="small" onClick={() => setDetailId(record.id)}>
                                    详情
                                </Button>
                                <Button size="small" danger={record.status === "active"} onClick={() => updateStatus(record)}>
                                    {record.status === "active" ? "停用" : "启用"}
                                </Button>
                            </Space>
                        ),
                    },
                ]}
            />
            <UserDrawer userId={detailId} onClose={() => setDetailId(undefined)} onChanged={load} />
        </Panel>
    );
}

function UserDrawer({ userId, onClose, onChanged }: { userId?: string; onClose: () => void; onChanged: () => void }) {
    const [detail, setDetail] = useState<AdminUserDetail>();
    const [content, setContent] = useState<Record<string, unknown>>();
    const [jobPage, setJobPage] = useState(1);
    const [usagePage, setUsagePage] = useState(1);
    const [jobs, setJobs] = useState<{ items: AdminJob[]; total: number }>({ items: [], total: 0 });
    const [usage, setUsage] = useState<{ items: AdminUsage[]; total: number }>({ items: [], total: 0 });
    useEffect(() => {
        setDetail(undefined);
        if (!userId) return;
        const controller = new AbortController();
        getAdminUser(userId, controller.signal)
            .then(setDetail)
            .catch((error) => message.error(error.message));
        return () => controller.abort();
    }, [userId]);
    useEffect(() => {
        if (!userId) return;
        const controller = new AbortController();
        getAdminJobs({ userId, page: jobPage, pageSize: 5 }, controller.signal)
            .then(setJobs)
            .catch((error) => message.error(error.message));
        return () => controller.abort();
    }, [jobPage, userId]);
    useEffect(() => {
        if (!userId) return;
        const controller = new AbortController();
        getAdminUsage({ userId, page: usagePage, pageSize: 5 }, controller.signal)
            .then(setUsage)
            .catch((error) => message.error(error.message));
        return () => controller.abort();
    }, [usagePage, userId]);
    useEffect(() => {
        setJobPage(1);
        setUsagePage(1);
    }, [userId]);
    if (!userId) return null;
    const mutate = async (kind: "sessions" | "admin") => {
        if (!detail) return;
        if (kind === "sessions") await revokeAdminUserSessions(userId);
        else await setAdminUserRole(userId, !detail.user.isAdmin);
        message.success("操作完成");
        setDetail(await getAdminUser(userId));
        onChanged();
    };
    return (
        <Drawer open width={720} onClose={onClose} title="用户详情" destroyOnHidden>
            {!detail ? (
                <Loading />
            ) : (
                <div className="space-y-6">
                    <div className="rounded-2xl bg-stone-950 p-5 text-white">
                        <p className="text-xl font-semibold">{detail.user.email}</p>
                        <p className="mt-1 font-mono text-xs text-stone-500">{detail.user.id}</p>
                        <div className="mt-5 flex flex-wrap gap-2">
                            <StatusTag value={detail.user.status} />
                            <Tag>{detail.user.projectCount} 项目</Tag>
                            <Tag>{detail.user.jobCount} 任务</Tag>
                        </div>
                    </div>
                    <Space wrap>
                        <Button onClick={() => void mutate("sessions")}>强制下线全部会话</Button>
                        <Button onClick={() => void mutate("admin")}>{detail.user.isAdmin ? "取消管理员" : "设为管理员"}</Button>
                    </Space>
                    <Panel title="实际消耗">
                        {detail.usage.length ? (
                            detail.usage.map((item) => (
                                <p key={item.currency} className="mb-2 font-mono">
                                    {item.currency} {item.totalAmount} · {item.totalTokens} Tokens
                                </p>
                            ))
                        ) : (
                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无账单" />
                        )}
                        <UsageBreakdownGrid breakdowns={detail.usageBreakdowns} compact />
                    </Panel>
                    <Panel title="任务记录">
                        <Table
                            rowKey="id"
                            size="small"
                            dataSource={jobs.items}
                            pagination={{ current: jobPage, pageSize: 5, total: jobs.total, showSizeChanger: false, onChange: setJobPage }}
                            columns={[
                                { title: "任务 ID", dataIndex: "id", render: copyable },
                                { title: "模型", dataIndex: "modelId" },
                                { title: "生成状态", dataIndex: "status", render: (value) => <StatusTag value={value} /> },
                                { title: "对账", dataIndex: "billingStatus", render: (value) => <StatusTag value={value} /> },
                            ]}
                        />
                    </Panel>
                    <Panel title="消耗流水">
                        <Table
                            rowKey="jobId"
                            size="small"
                            dataSource={usage.items}
                            pagination={{ current: usagePage, pageSize: 5, total: usage.total, showSizeChanger: false, onChange: setUsagePage }}
                            columns={[
                                { title: "任务 ID", dataIndex: "jobId", render: copyable },
                                { title: "项目", dataIndex: "projectName" },
                                { title: "模型", dataIndex: "modelId" },
                                { title: "金额", render: (_, item) => `${item.currency || "—"} ${item.totalAmount || "—"}` },
                            ]}
                        />
                    </Panel>
                    <Panel title="项目与业务内容" note="只读访问将写入审计日志">
                        <Table
                            rowKey="id"
                            size="small"
                            pagination={false}
                            dataSource={detail.projects}
                            columns={[
                                { title: "项目", dataIndex: "name" },
                                { title: "素材", dataIndex: "assetCount" },
                                { title: "任务", dataIndex: "jobCount" },
                                {
                                    title: "操作",
                                    render: (_, record) => (
                                        <Button size="small" onClick={async () => setContent(await getAdminProjectContent(record.id))}>
                                            查看内容
                                        </Button>
                                    ),
                                },
                            ]}
                        />
                    </Panel>
                </div>
            )}
            <Modal open={Boolean(content)} width={900} title="只读项目内容" footer={null} onCancel={() => setContent(undefined)}>
                {content ? <ProjectContent content={content} /> : null}
            </Modal>
        </Drawer>
    );
}

function ProjectContent({ content }: { content: Record<string, unknown> }) {
    const assets = Array.isArray(content.assets) ? (content.assets as Array<Record<string, unknown>>) : [];
    const canvases = Array.isArray(content.canvases) ? (content.canvases as Array<Record<string, unknown>>) : [];
    const conversations = Array.isArray(content.conversations) ? (content.conversations as Array<Record<string, unknown>>) : [];
    return (
        <div className="max-h-[65vh] space-y-5 overflow-auto">
            <Panel title="画布" note={`${canvases.length} 个`}>
                {canvases.map((canvas) => (
                    <div key={String(canvas.id)} className="mb-2 rounded-lg bg-stone-100 p-3 text-sm dark:bg-white/5">
                        Revision {String(canvas.revision)} · {Array.isArray(canvas.nodes) ? canvas.nodes.length : 0} 节点
                    </div>
                ))}
            </Panel>
            <Panel title="素材" note={`${assets.length} 个`}>
                <div className="grid gap-2 sm:grid-cols-2">
                    {assets.map((asset) => (
                        <div key={String(asset.id)} className="flex items-center justify-between rounded-lg border border-stone-200 p-3 dark:border-white/10">
                            <span className="min-w-0">
                                <b className="block truncate text-sm">{String(asset.name)}</b>
                                <small>
                                    {String(asset.kind)} · {formatBytes(Number(asset.bytes || 0))}
                                </small>
                            </span>
                            {asset.currentVersionId ? (
                                <Button
                                    size="small"
                                    onClick={async () => {
                                        const result = await getAdminAssetDownload(String(asset.currentVersionId));
                                        window.open(result.url, "_blank", "noopener,noreferrer");
                                    }}
                                >
                                    预览 / 下载
                                </Button>
                            ) : null}
                        </div>
                    ))}
                </div>
            </Panel>
            <Panel title="提示词对话" note={`${conversations.length} 个`}>
                <div className="space-y-2">
                    {conversations.map((item) => (
                        <div key={String(item.id)} className="rounded-lg border border-stone-200 p-3 text-sm dark:border-white/10">
                            <b>{String(item.title)}</b> · {String(item.messageCount)} 条消息
                            {Array.isArray(item.messages) ? (
                                <div className="mt-2 max-h-48 space-y-2 overflow-auto">
                                    {(item.messages as Array<Record<string, unknown>>).map((entry) => (
                                        <p key={String(entry.id)} className="whitespace-pre-wrap rounded-md bg-stone-100 p-2 text-xs dark:bg-white/5">
                                            <b>{String(entry.role)}</b>：{String(entry.content)}
                                        </p>
                                    ))}
                                </div>
                            ) : null}
                        </div>
                    ))}
                </div>
            </Panel>
        </div>
    );
}

function UsagePanel() {
    const [data, setData] = useState<{
        items: AdminUsage[];
        total: number;
        summary: Array<{ currency: string; totalAmount: string; totalTokens: string; videoDurationSeconds: string }>;
        breakdowns: UsageBreakdown;
    }>({ items: [], total: 0, summary: [], breakdowns: { model: [], project: [], capability: [], day: [] } });
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        getAdminUsage({ page, pageSize: 20 }, controller.signal)
            .then(setData)
            .catch((error) => message.error(error.message))
            .finally(() => setLoading(false));
        return () => controller.abort();
    }, [page]);
    return (
        <div className="space-y-5">
            <div className="grid gap-4 md:grid-cols-3">
                {data.summary.map((item) => (
                    <Metric key={item.currency} label={`${item.currency} 实际金额`} value={item.totalAmount} note={`${item.totalTokens} Tokens · ${item.videoDurationSeconds}s`} />
                ))}
            </div>
            <UsageBreakdownGrid breakdowns={data.breakdowns} />
            <Panel title="消耗流水" note="金额字段以字符串传输，避免浮点误差">
                <Table
                    rowKey="jobId"
                    loading={loading}
                    dataSource={data.items}
                    pagination={{ current: page, pageSize: 20, total: data.total, showSizeChanger: false, onChange: setPage }}
                    columns={[
                        {
                            title: "用户 / 项目",
                            render: (_, item) => (
                                <>
                                    <b className="block">{item.userEmail}</b>
                                    <small>{item.projectName}</small>
                                </>
                            ),
                        },
                        { title: "模型", dataIndex: "modelId" },
                        { title: "计量", render: (_, item) => `${item.totalTokens || 0} T · ${item.videoDurationSeconds || 0}s · ${item.generatedImages || 0} 图` },
                        {
                            title: "实际金额",
                            render: (_, item) => (
                                <b className="font-mono">
                                    {item.currency || "—"} {item.totalAmount || "—"}
                                </b>
                            ),
                        },
                        { title: "账单 ID", dataIndex: "billingRequestId", render: copyable },
                        { title: "对账时间", dataIndex: "reconciledAt", render: formatDate },
                    ]}
                />
            </Panel>
        </div>
    );
}

function UsageBreakdownGrid({ breakdowns, compact = false }: { breakdowns: UsageBreakdown; compact?: boolean }) {
    const groups: Array<{ key: keyof UsageBreakdown; title: string }> = [
        { key: "model", title: "按模型" },
        { key: "project", title: "按项目" },
        { key: "capability", title: "按能力" },
        { key: "day", title: "按日期" },
    ];
    const visible = compact ? groups.slice(0, 3) : groups;
    return (
        <div className={`mt-4 grid gap-4 ${compact ? "md:grid-cols-3" : "xl:grid-cols-4"}`}>
            {visible.map((group) => (
                <div key={group.key} className="rounded-xl border border-stone-200 p-3 dark:border-white/10">
                    <b className="text-sm">{group.title}</b>
                    <div className="mt-2 max-h-44 space-y-2 overflow-auto">
                        {breakdowns[group.key]?.length ? (
                            breakdowns[group.key].map((item) => (
                                <div key={`${item.key}-${item.currency}`} className="flex items-start justify-between gap-3 text-xs">
                                    <span className="min-w-0 truncate" title={item.key}>
                                        {item.key}
                                    </span>
                                    <span className="shrink-0 text-right font-mono">
                                        {item.currency} {item.totalAmount}
                                        <small className="block text-stone-500">
                                            {item.calls} 次 · {item.totalTokens} T
                                        </small>
                                    </span>
                                </div>
                            ))
                        ) : (
                            <span className="text-xs text-stone-500">暂无数据</span>
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
}

function JobsPanel() {
    const [items, setItems] = useState<AdminJob[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [status, setStatus] = useState<string>();
    const [q, setQ] = useState("");
    const [loading, setLoading] = useState(true);
    const load = useCallback(() => {
        setLoading(true);
        getAdminJobs({ page, pageSize: 20, status, q })
            .then((data) => {
                setItems(data.items);
                setTotal(data.total);
            })
            .catch((error) => message.error(error.message))
            .finally(() => setLoading(false));
    }, [page, q, status]);
    useEffect(load, [load]);
    return (
        <Panel
            title="全局生成任务"
            note="对账异常不会改写生成状态"
            actions={
                <Space>
                    <Input.Search
                        allowClear
                        placeholder="任务 / Trace / 资源 ID"
                        onSearch={(value) => {
                            setPage(1);
                            setQ(value);
                        }}
                    />
                    <Select
                        allowClear
                        className="w-32"
                        placeholder="生成状态"
                        options={["completed", "failed", "cancelled", "running"].map((value) => ({ value }))}
                        onChange={(value) => {
                            setPage(1);
                            setStatus(value);
                        }}
                    />
                </Space>
            }
        >
            <Table
                rowKey="id"
                loading={loading}
                dataSource={items}
                pagination={{ current: page, pageSize: 20, total, showSizeChanger: false, onChange: setPage }}
                columns={[
                    { title: "任务 ID", dataIndex: "id", render: copyable },
                    {
                        title: "用户 / 项目",
                        render: (_, item) => (
                            <>
                                <span className="block">{item.userEmail}</span>
                                <small>{item.projectName}</small>
                            </>
                        ),
                    },
                    { title: "模型", dataIndex: "modelId" },
                    { title: "生成", dataIndex: "status", render: (value) => <StatusTag value={value} /> },
                    { title: "对账", dataIndex: "billingStatus", render: (value) => <StatusTag value={value} /> },
                    {
                        title: "供应商标识",
                        render: (_, item) => (
                            <div className="max-w-52 space-y-1 text-xs">
                                <p>Trace: {copyable(item.billingTraceId)}</p>
                                <p>Resource: {copyable(item.providerJobId)}</p>
                            </div>
                        ),
                    },
                    {
                        title: "失败原因",
                        render: (_, item) => (
                            <span className="block max-w-64 truncate text-red-600" title={item.error?.message || item.billingError}>
                                {item.error?.message || item.billingError || "—"}
                            </span>
                        ),
                    },
                    {
                        title: "操作",
                        render: (_, item) => (
                            <Button
                                size="small"
                                disabled={!item.billingTraceId}
                                onClick={async () => {
                                    const result = await reconcileAdminJob(item.id);
                                    message.success(`对账状态：${result.status}`);
                                    load();
                                }}
                            >
                                重新对账
                            </Button>
                        ),
                    },
                ]}
            />
        </Panel>
    );
}

function ModelsPanel() {
    const [items, setItems] = useState<AdminModel[]>();
    useEffect(() => {
        const controller = new AbortController();
        getAdminModels(controller.signal)
            .then(setItems)
            .catch((error) => message.error(error.message));
        return () => controller.abort();
    }, []);
    if (!items) return <Loading />;
    return (
        <Panel title="模型健康状态" note={`${items.filter((item) => item.healthy).length}/${items.length} 正常`}>
            <Table
                rowKey="id"
                pagination={false}
                dataSource={items}
                columns={[
                    {
                        title: "模型",
                        render: (_, item) => (
                            <>
                                <b className="block">{item.displayName}</b>
                                <small className="font-mono">{item.id}</small>
                            </>
                        ),
                    },
                    { title: "能力", dataIndex: "capability" },
                    { title: "启用", dataIndex: "enabled", render: (value) => <Switch size="small" checked={value} disabled /> },
                    { title: "健康", dataIndex: "healthy", render: (value) => <StatusTag value={value ? "healthy" : "unhealthy"} /> },
                    { title: "检查时间", dataIndex: "checkedAt", render: formatDate },
                ]}
            />
        </Panel>
    );
}

function AuditPanel() {
    const [items, setItems] = useState<AdminAuditLog[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [q, setQ] = useState("");
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        getAdminAuditLogs({ page, pageSize: 20, q }, controller.signal)
            .then((data) => {
                setItems(data.items);
                setTotal(data.total);
            })
            .catch((error) => message.error(error.message))
            .finally(() => setLoading(false));
        return () => controller.abort();
    }, [page, q]);
    return (
        <Panel
            title="管理员审计日志"
            note="日志永久只读"
            actions={
                <Input.Search
                    allowClear
                    placeholder="管理员 / 动作 / 目标"
                    onSearch={(value) => {
                        setPage(1);
                        setQ(value);
                    }}
                />
            }
        >
            <Table
                rowKey="id"
                loading={loading}
                dataSource={items}
                pagination={{ current: page, pageSize: 20, total, showSizeChanger: false, onChange: setPage }}
                columns={[
                    { title: "时间", dataIndex: "createdAt", render: formatDate },
                    { title: "管理员", dataIndex: "actorEmail" },
                    { title: "动作", dataIndex: "action", render: (value) => <code>{value}</code> },
                    { title: "目标", render: (_, item) => `${item.targetType || "—"} · ${item.targetId || "—"}` },
                    { title: "Request ID", dataIndex: "requestId", render: copyable },
                    {
                        title: "详情",
                        dataIndex: "metadata",
                        render: (value) => (
                            <span className="block max-w-72 truncate font-mono text-xs" title={JSON.stringify(value)}>
                                {JSON.stringify(value)}
                            </span>
                        ),
                    },
                ]}
            />
        </Panel>
    );
}

function Panel({ title, note, actions, children }: { title: string; note?: string; actions?: React.ReactNode; children: React.ReactNode }) {
    return (
        <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm shadow-stone-200/40 dark:border-white/10 dark:bg-stone-950 dark:shadow-none">
            <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 className="font-semibold">{title}</h2>
                    {note ? <p className="mt-0.5 text-xs text-stone-500">{note}</p> : null}
                </div>
                {actions}
            </header>
            {children}
        </section>
    );
}
function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
    return (
        <div className="rounded-2xl border border-stone-200 bg-white p-5 dark:border-white/10 dark:bg-stone-950">
            <p className="text-xs font-medium text-stone-500">{label}</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight">{value}</p>
            {note ? <p className="mt-2 text-xs text-stone-500">{note}</p> : null}
        </div>
    );
}
function StatusTag({ value }: { value: string }) {
    const good = ["active", "completed", "settled", "healthy", "success"].includes(value);
    const pending = ["pending", "running", "queued", "reconciling", "mismatch"].includes(value);
    return (
        <Tag bordered={false} color={good ? "green" : pending ? "gold" : "red"}>
            {value}
        </Tag>
    );
}
function Loading() {
    return (
        <div className="grid min-h-64 place-items-center">
            <Spin />
        </div>
    );
}
function formatDate(value?: string) {
    return value ? new Date(value).toLocaleString("zh-CN") : "—";
}
function formatBytes(value: number) {
    if (!value) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
    return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}
function copyable(value?: string) {
    if (!value) return "—";
    return (
        <button
            className="max-w-40 truncate font-mono text-xs text-blue-600 hover:underline"
            title={value}
            onClick={() => {
                void navigator.clipboard.writeText(value);
                message.success("已复制");
            }}
        >
            {value}
        </button>
    );
}
