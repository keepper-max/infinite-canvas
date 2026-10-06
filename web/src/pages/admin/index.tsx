import { ArrowLeft, Boxes, CircleDollarSign, ClipboardList, CreditCard, LayoutDashboard, MessageSquareText, ReceiptText, Share2, ShieldCheck, Users } from "lucide-react";
import { Alert, Button, DatePicker, Drawer, Empty, Input, InputNumber, Modal, Radio, Select, Space, Spin, Switch, Table, Tag, Tooltip, message } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { useAuth } from "@/components/auth/auth-context";
import ChannelManagement from "./channels";
import { randomUuid } from "@/lib/utils";
import { getBatches, getCampaigns, getChannels, getInvites, updateUserAttribution, type Batch, type Campaign, type Channel, type InviteCode } from "@/services/api/channel-attribution";
import {
    getAdminAuditLogs,
    getAdminFeedback,
    getAdminAssetDownload,
    getAdminJobs,
    getAdminModels,
    getAdminDirectorSettings,
    getAdminProviders,
    getAdminPaymentOrders,
    getAdminPaymentPlans,
    getAdminPaymentSettings,
    getAdminBillingRules,
    getAdminOverview,
    getAdminProjectContent,
    getAdminCreditPricing,
    getAdminCreditGuard,
    getAdminActivationCodes,
    getAdminUsage,
    getAdminUser,
    getAdminUsers,
    grantAdminUserCredits,
    issueAdminActivationCode,
    reconcileAdminJob,
    resolveAdminJobBilling,
    replyAdminFeedback,
    revokeAdminUserSessions,
    setAdminUserRole,
    setAdminUserStatus,
    setAdminModelEnabled,
    setAdminDirectorSettings,
    setAdminFeedbackStatus,
    setAdminCreditPricing,
    setAdminCreditGuard,
    setActiveAdminProvider,
    syncAdminPaymentOrder,
    createAdminPaymentPlan,
    updateAdminPaymentPlan,
    setAdminPaymentSettings,
    createAdminBillingRule,
    updateAdminBillingRule,
    type AdminAuditLog,
    type UserFeedback,
    type AdminJob,
    type ManualBillingResolution,
    type AdminModel,
    type DirectorSettings,
    type AdminOverview,
    type PaymentOrder,
    type BillingPlan,
    type PaymentPlanInput,
    type AdminPaymentSettings,
    type ProviderBillingRule,
    type ProviderBillingRuleInput,
    type AdminProvider,
    type AdminProviders,
    type AdminUsage,
    type AdminUser,
    type AdminUserDetail,
    type CreditPricing,
    type CreditGuardSettings,
    type ActivationCodeRecord,
    type UsageBreakdown,
} from "@/services/api/operations";

const sections = [
    { key: "overview", label: "概览", icon: LayoutDashboard },
    { key: "users", label: "账号", icon: Users },
    { key: "channels", label: "渠道管理", icon: Share2 },
    { key: "usage", label: "消耗", icon: CircleDollarSign },
    { key: "jobs", label: "任务", icon: ClipboardList },
    { key: "billing", label: "计费规则", icon: ReceiptText },
    { key: "payments", label: "充值", icon: CreditCard },
    { key: "models", label: "模型", icon: Boxes },
    { key: "feedback", label: "反馈", icon: MessageSquareText },
    { key: "audit", label: "审计", icon: ShieldCheck },
] as const;

type Section = (typeof sections)[number]["key"];

export default function AdminPage() {
    const { user } = useAuth();
    const { section = "overview", subsection } = useParams();
    const active = sections.some((item) => item.key === section) ? (section as Section) : "overview";
    const modelProvider: AdminProvider["id"] = subsection === "runninghub-global" ? "runninghub_global" : subsection === "runninghub" ? "runninghub" : subsection === "volcengine-ark" ? "volcengine_ark" : "token360";
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
                        <small className="text-stone-500">管理工作台</small>
                    </span>
                </Link>
                <nav className="space-y-1">
                    {sections.map((item) => {
                        const Icon = item.icon;
                        return (
                            <div key={item.key}>
                                <Link
                                    to={item.key === "models" ? "/admin/models/token360" : `/admin/${item.key}`}
                                    className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${active === item.key ? "bg-white text-stone-950" : "text-stone-400 hover:bg-white/5 hover:text-white"}`}
                                >
                                    <Icon className="size-4" />
                                    {item.label}
                                </Link>
                                {item.key === "models" && active === "models" ? (
                                    <div className="ml-7 mt-1 space-y-1 border-l border-white/10 pl-3">
                                        {(
                                            [
                                                ["token360", "Token360"],
                                                ["runninghub", "海马云 · 中国区"],
                                                ["runninghub_global", "海马云 · 国际区"],
                                                ["volcengine_ark", "火山方舟"],
                                            ] as const
                                        ).map(([key, label]) => (
                                            <Link
                                                key={key}
                                                to={`/admin/models/${key.replaceAll("_", "-")}`}
                                                className={`block rounded-md px-3 py-2 text-xs transition ${modelProvider === key ? "bg-white/10 text-white" : "text-stone-500 hover:text-white"}`}
                                            >
                                                {label}
                                            </Link>
                                        ))}
                                    </div>
                                ) : null}
                            </div>
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
                            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">系统管理</p>
                            <h1 className="text-3xl font-semibold tracking-tight">{sections.find((item) => item.key === active)?.label}</h1>
                        </div>
                        <Tag bordered={false} color="green">
                            只读业务内容 · 操作留痕
                        </Tag>
                    </header>
                    <AdminSection section={active} modelProvider={modelProvider} />
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

function AdminSection({ section, modelProvider }: { section: Section; modelProvider: AdminProvider["id"] }) {
    if (section === "overview") return <Overview />;
    if (section === "users") return <UsersPanel />;
    if (section === "channels") return <ChannelManagement />;
    if (section === "usage") return <UsagePanel />;
    if (section === "jobs") return <JobsPanel />;
    if (section === "billing") return <BillingRulesPanel />;
    if (section === "payments") return <PaymentsPanel />;
    if (section === "models") return <ModelsPanel provider={modelProvider} />;
    if (section === "feedback") return <FeedbackPanel />;
    return <AuditPanel />;
}

type OverviewRangePreset = "today" | "yesterday" | "week" | "month" | "custom";
const overviewPresetLabel: Record<Exclude<OverviewRangePreset, "custom">, string> = {
    today: "今日",
    yesterday: "昨日",
    week: "本周",
    month: "本月",
};
function overviewPresetRange(preset: Exclude<OverviewRangePreset, "custom">): [Dayjs, Dayjs] {
    const today = dayjs().startOf("day");
    if (preset === "yesterday") return [today.subtract(1, "day"), today.subtract(1, "day")];
    if (preset === "week") return [today.subtract((today.day() + 6) % 7, "day"), today];
    if (preset === "month") return [today.startOf("month"), today];
    return [today, today];
}
function overviewTrendTicks<T>(items: T[]) {
    if (items.length <= 1) return items;
    const last = items.length - 1;
    return Array.from(new Set([0, Math.round(last * 0.25), Math.round(last * 0.5), Math.round(last * 0.75), last])).map((index) => items[index]!);
}

function Overview() {
    const [data, setData] = useState<AdminOverview>();
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);
    const [rangePreset, setRangePreset] = useState<OverviewRangePreset>("month");
    const [range, setRange] = useState<[Dayjs, Dayjs]>(() => overviewPresetRange("month"));
    const [rangeJobs, setRangeJobs] = useState<AdminJob[]>([]);
    const [rangeJobsTotal, setRangeJobsTotal] = useState(0);
    const [rangeJobsPage, setRangeJobsPage] = useState(1);
    const [rangeJobsLoading, setRangeJobsLoading] = useState(true);
    const dateFrom = range[0].format("YYYY-MM-DD");
    const dateTo = range[1].format("YYYY-MM-DD");
    useEffect(() => {
        const controller = new AbortController();
        let active = true;
        setLoading(true);
        setError("");
        getAdminOverview({ dateFrom, dateTo }, controller.signal)
            .then((value) => active && setData(value))
            .catch((value) => active && setError(value instanceof Error ? value.message : "加载失败"))
            .finally(() => active && setLoading(false));
        return () => {
            active = false;
            controller.abort();
        };
    }, [dateFrom, dateTo]);
    useEffect(() => {
        const controller = new AbortController();
        let active = true;
        setRangeJobsLoading(true);
        getAdminJobs({ page: rangeJobsPage, pageSize: 10, createdFrom: dateFrom, createdTo: dateTo }, controller.signal)
            .then((value) => {
                if (!active) return;
                setRangeJobs(value.items);
                setRangeJobsTotal(value.total);
            })
            .catch((value) => active && message.error(value instanceof Error ? value.message : "任务明细加载失败"))
            .finally(() => active && setRangeJobsLoading(false));
        return () => {
            active = false;
            controller.abort();
        };
    }, [dateFrom, dateTo, rangeJobsPage]);
    if (error && !data) return <Empty description={error} />;
    if (!data) return <Loading />;
    const rangeLabel = formatOverviewRangeLabel(data.range.from, data.range.to);
    const metrics = [
        { label: "用户总量", value: formatCount(data.users), note: `${rangeLabel}新增 ${data.userActivity.newInRange}` },
        { label: "区间活跃用户", value: formatCount(data.userActivity.activeInRange), note: `活跃率 ${formatPercent(data.users ? data.userActivity.activeInRange / data.users : 0)}` },
        { label: "区间新增用户", value: formatCount(data.userActivity.newInRange), note: `${rangeLabel}注册` },
        { label: "区间任务", value: formatCount(data.jobActivity.jobsInRange), note: `成功率 ${formatPercent(data.jobActivity.successRateInRange)}` },
        { label: "区间积分消耗", value: formatPoints(data.creditActivity.consumedInRange), note: rangeLabel },
        { label: "素材存储", value: formatBytes(data.assetBytes), note: `${formatCount(data.assets)} 个有效素材` },
    ];
    const peak = Math.max(1, ...data.trends.flatMap((item) => [item.jobs, item.activeUsers]));
    const trendTicks = overviewTrendTicks(data.trends);
    const usageCurrencies = Array.from(new Set([...data.usageRange, ...data.usage].map((item) => item.currency)));
    const applyPreset = (preset: Exclude<OverviewRangePreset, "custom">) => {
        setRangePreset(preset);
        setRangeJobsPage(1);
        setRange(overviewPresetRange(preset));
    };
    return (
        <Spin spinning={loading} tip="正在更新数据">
            <div className="space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-stone-200 bg-white px-5 py-4 shadow-sm shadow-stone-200/40 dark:border-white/10 dark:bg-stone-950 dark:shadow-none">
                    <div>
                        <p className="text-xs font-medium text-stone-500">数据周期</p>
                        <p className="mt-1 text-sm font-semibold">{rangeLabel}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        {(["today", "yesterday", "week", "month"] as const).map((preset) => (
                            <button
                                key={preset}
                                type="button"
                                aria-pressed={rangePreset === preset}
                                onClick={() => applyPreset(preset)}
                                style={rangePreset === preset ? { backgroundColor: "#f5f5f4", borderColor: "#f5f5f4", color: "#0c0a09" } : undefined}
                                className={`rounded-lg border px-3.5 py-2 text-sm font-medium transition ${rangePreset === preset ? "shadow-sm" : "border-stone-200 bg-transparent text-stone-600 hover:border-stone-400 hover:text-stone-950 dark:border-white/15 dark:text-stone-300 dark:hover:border-white/40 dark:hover:text-white"}`}
                            >
                                {overviewPresetLabel[preset]}
                            </button>
                        ))}
                        <DatePicker.RangePicker
                            value={range}
                            allowClear={false}
                            format="YYYY-MM-DD"
                            onChange={(values) => {
                                if (!values?.[0] || !values?.[1]) return;
                                if (values[1].diff(values[0], "day") > 365) {
                                    message.warning("自定义统计范围最多为 366 天");
                                    return;
                                }
                                setRangePreset("custom");
                                setRangeJobsPage(1);
                                setRange([values[0], values[1]]);
                            }}
                            className={`h-[38px] w-[250px] ${rangePreset === "custom" ? "ring-1 ring-stone-950 dark:ring-white" : ""}`}
                        />
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-4 xl:grid-cols-6">
                    {metrics.map((item) => (
                        <Metric key={item.label} label={item.label} value={item.value} note={item.note} />
                    ))}
                </div>
                <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
                    <Panel title={`${rangeLabel}活跃趋势`} note="活跃用户按登录或提交生成任务统计">
                        <div className="mb-5 flex items-center gap-5 text-xs text-stone-600 dark:text-stone-300">
                            <span className="flex items-center gap-2">
                                <i className="size-2 rounded-full bg-stone-200" />
                                任务
                            </span>
                            <span className="flex items-center gap-2">
                                <i className="size-2 rounded-full bg-emerald-400" />
                                活跃用户
                            </span>
                        </div>
                        <div className="flex h-52 items-end gap-1">
                            {data.trends.map((item) => (
                                <div key={item.day} className="group relative flex h-full min-w-0 flex-1 items-end justify-center gap-px">
                                    <div className="w-1/2 max-w-2 rounded-t-sm bg-stone-300 transition group-hover:bg-white dark:bg-stone-200" style={{ height: `${Math.max(2, (item.jobs / peak) * 100)}%` }} />
                                    <div className="w-1/2 max-w-2 rounded-t-sm bg-emerald-500/70 transition group-hover:bg-emerald-400" style={{ height: `${Math.max(2, (item.activeUsers / peak) * 100)}%` }} />
                                    <span className="pointer-events-none absolute bottom-full left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-lg border border-white/10 bg-black px-2.5 py-1.5 text-[10px] text-white shadow-xl group-hover:block">
                                        {item.day} · {item.jobs} 任务 · {item.activeUsers} 活跃 · +{item.newUsers} 用户
                                    </span>
                                </div>
                            ))}
                        </div>
                        <div className="mt-3 flex justify-between border-t border-stone-200 pt-2 font-mono text-[11px] text-stone-600 dark:border-white/10 dark:text-stone-400">
                            {trendTicks.map((item) => (
                                <span key={item.day}>{dayjs(item.day).format("M/D")}</span>
                            ))}
                        </div>
                    </Panel>
                    <Panel title="供应商原始费用" note={`${rangeLabel}与历史累计；优惠实付另见消耗流水`}>
                        {usageCurrencies.length ? (
                            <div className="space-y-3">
                                {usageCurrencies.map((currency) => {
                                    const recent = data.usageRange.find((item) => item.currency === currency);
                                    const total = data.usage.find((item) => item.currency === currency);
                                    return (
                                        <div key={currency} className="rounded-xl border border-stone-200 bg-stone-50/60 p-4 dark:border-white/10 dark:bg-white/[0.025]">
                                            <div className="flex items-center justify-between">
                                                <b>{usageAmountLabel(currency, recent?.totalAmount || total?.totalAmount, true)}</b>
                                                <span className="font-mono text-xl">{formatUsageAmount(currency, recent?.totalAmount || "0")}</span>
                                            </div>
                                            <div className="mt-3 flex items-center justify-between text-xs text-stone-600 dark:text-stone-400">
                                                <span>
                                                    {rangeLabel} {recent?.calls || 0} 笔
                                                </span>
                                                <span>累计 {formatUsageAmount(currency, total?.totalAmount || "0")}</span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <Empty description="暂无已对账账单" />
                        )}
                    </Panel>
                </div>
                <Panel title="运行监控" note="优先关注红色和黄色指标">
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
                        <OperationalSignal label="有效登录用户" value={formatCount(data.userActivity.activeSessionUsers)} note="当前未过期会话" />
                        <OperationalSignal label="运行中任务" value={formatCount(data.activeJobs)} note="生成队列实时值" tone={data.activeJobs > 10 ? "warning" : "normal"} />
                        <Link
                            to={`/admin/jobs?status=failed&createdFrom=${encodeURIComponent(dateFrom)}&createdTo=${encodeURIComponent(dateTo)}`}
                            className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                            title="查看所选周期的失败任务"
                        >
                            <OperationalSignal label="生成失败" value={formatCount(data.jobActivity.failedInRange)} note={`${rangeLabel}失败任务 · 点击查看`} tone={data.jobActivity.failedInRange ? "danger" : "normal"} interactive />
                        </Link>
                        <OperationalSignal label="待对账" value={formatCount(data.alerts.pendingBillingJobs)} note="成功任务账单处理中" tone={data.alerts.pendingBillingJobs ? "warning" : "normal"} />
                        <OperationalSignal label="待扣积分" value={formatCount(data.alerts.pendingCreditCharges)} note="计费尚未最终入账" tone={data.alerts.pendingCreditCharges ? "warning" : "normal"} />
                        <OperationalSignal label="平均生成耗时" value={formatDuration(data.jobActivity.avgCompletionSecondsInRange)} note={`${rangeLabel}成功任务`} />
                    </div>
                </Panel>
                <Panel title="所选周期任务明细" note={`${rangeLabel}共 ${formatCount(rangeJobsTotal)} 个任务，按提交时间倒序`}>
                    <Table
                        rowKey="id"
                        loading={rangeJobsLoading}
                        dataSource={rangeJobs}
                        scroll={{ x: 1080 }}
                        pagination={{ current: rangeJobsPage, pageSize: 10, total: rangeJobsTotal, showSizeChanger: false, onChange: setRangeJobsPage }}
                        columns={[
                            { title: "提交时间", dataIndex: "createdAt", width: 170, render: formatDate },
                            {
                                title: "用户 / 项目",
                                width: 230,
                                render: (_, item) => (
                                    <>
                                        <span className="block font-medium text-stone-900 dark:text-stone-100">{item.userEmail}</span>
                                        <small className="text-stone-600 dark:text-stone-400">{item.projectName}</small>
                                    </>
                                ),
                            },
                            {
                                title: "模型 / 能力",
                                width: 240,
                                render: (_, item) => (
                                    <>
                                        <span className="block">{item.modelId}</span>
                                        <small className="text-stone-600 dark:text-stone-400">{capabilityLabel(item.capability)}</small>
                                    </>
                                ),
                            },
                            { title: "任务状态", dataIndex: "status", width: 110, render: (value) => <StatusTag value={value} kind="job" /> },
                            { title: "对账状态", dataIndex: "billingStatus", width: 150, render: (value) => <StatusTag value={value} kind="billing" /> },
                            { title: "耗时", width: 100, render: (_, item) => formatJobDuration(item.createdAt, item.finishedAt) },
                            {
                                title: "任务 ID",
                                dataIndex: "id",
                                width: 150,
                                render: copyable,
                            },
                        ]}
                    />
                </Panel>
            </div>
        </Spin>
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
                        placeholder="搜索手机号或邮箱"
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
                                <b className="block">{record.phone || value || "—"}</b>
                                {record.phone && value ? <span className="block text-xs text-stone-400">{value}</span> : null}
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
                    { title: "注册 IP", dataIndex: "registrationIp", render: (value) => value || "—" },
                    { title: "来源渠道", dataIndex: "channelName", render: (value, record) => (value ? `${value}${record.inviteCode ? ` · ${record.inviteCode}` : ""}` : "—") },
                    { title: "积分", dataIndex: "creditBalance", render: (value) => <span className="font-mono">{formatPoints(value)}</span> },
                    { title: "存储", dataIndex: "storageBytes", render: formatBytes },
                    {
                        title: "实际消耗",
                        dataIndex: "usageAmounts",
                        render: (value: Record<string, string>) =>
                            Object.entries(value || {})
                                .map(([currency, amount]) => formatUsageAmount(currency, amount))
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
    const [grantOpen, setGrantOpen] = useState(false);
    const [grantCredits, setGrantCredits] = useState("");
    const [grantSource, setGrantSource] = useState<"purchase" | "promotion" | "compensation">("purchase");
    const [grantNote, setGrantNote] = useState("");
    const [grantKey, setGrantKey] = useState(randomUuid);
    const [granting, setGranting] = useState(false);
    const [attributionOpen, setAttributionOpen] = useState(false);
    const [attributionSaving, setAttributionSaving] = useState(false);
    const [channels, setChannels] = useState<Channel[]>([]);
    const [campaigns, setCampaigns] = useState<Campaign[]>([]);
    const [batches, setBatches] = useState<Batch[]>([]);
    const [invites, setInvites] = useState<InviteCode[]>([]);
    const [attributionChannelId, setAttributionChannelId] = useState<string>();
    const [attributionCampaignId, setAttributionCampaignId] = useState<string>();
    const [attributionBatchId, setAttributionBatchId] = useState<string>();
    const [attributionInviteId, setAttributionInviteId] = useState<string>();
    const [attributionReason, setAttributionReason] = useState("");
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
    const submitGrant = async () => {
        if (granting) return;
        const credits = Number(grantCredits);
        if (!Number.isSafeInteger(credits) || credits <= 0 || credits > 1_000_000_000 || !grantNote.trim()) {
            message.error("请输入正整数积分和发放说明");
            return;
        }
        setGranting(true);
        try {
            await grantAdminUserCredits(userId, { credits, source: grantSource, note: grantNote.trim(), idempotencyKey: grantKey });
            message.success("积分已发放并写入审计流水");
            setGrantOpen(false);
            setGrantCredits("");
            setGrantNote("");
            setGrantKey(randomUuid());
            onChanged();
            try {
                setDetail(await getAdminUser(userId));
            } catch {
                message.warning("积分已发放，但详情刷新失败，请重新打开用户详情");
            }
        } catch (error) {
            message.error(error instanceof Error ? error.message : "积分发放失败");
        } finally {
            setGranting(false);
        }
    };
    const openAttribution = async () => {
        if (!detail) return;
        try {
            const [channelData, campaignData, batchData, inviteData] = await Promise.all([getChannels({ pageSize: 100 }), getCampaigns({ pageSize: 100 }), getBatches({ pageSize: 100 }), getInvites({ pageSize: 100 })]);
            setChannels(channelData.items);
            setCampaigns(campaignData.items);
            setBatches(batchData.items);
            setInvites(inviteData.items);
            setAttributionChannelId(detail.user.channelId);
            setAttributionCampaignId(detail.user.campaignId);
            setAttributionBatchId(detail.user.batchId);
            setAttributionInviteId(detail.user.inviteCodeId);
            setAttributionReason("");
            setAttributionOpen(true);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "归因选项读取失败");
        }
    };
    const submitAttribution = async () => {
        if (!attributionChannelId || !attributionReason.trim()) {
            message.error("请选择渠道并填写修正原因");
            return;
        }
        setAttributionSaving(true);
        try {
            await updateUserAttribution(userId, {
                channelId: attributionChannelId,
                campaignId: attributionCampaignId || null,
                batchId: attributionBatchId || null,
                inviteCodeId: attributionInviteId || null,
                reason: attributionReason.trim(),
            });
            setDetail(await getAdminUser(userId));
            setAttributionOpen(false);
            onChanged();
            message.success("用户来源已修正并写入审计日志");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "来源修正失败");
        } finally {
            setAttributionSaving(false);
        }
    };
    return (
        <>
            <Drawer open width={720} onClose={onClose} title="用户详情" destroyOnHidden>
                {!detail ? (
                    <Loading />
                ) : (
                    <div className="space-y-6">
                        <div className="rounded-2xl bg-stone-950 p-5 text-white">
                            <p className="text-xl font-semibold">{detail.user.phone || detail.user.email || "未命名账号"}</p>
                            {detail.user.phone && detail.user.email ? <p className="mt-1 text-sm text-stone-300">{detail.user.email}</p> : null}
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
                        <Panel title="登录凭证">
                            <div className="grid gap-3 sm:grid-cols-2">
                                <Metric label="手机号" value={detail.user.phone ? `${detail.user.phone}${detail.user.phoneVerified ? " · 已验证" : " · 未验证"}` : "—"} />
                                <Metric label="邮箱" value={detail.user.email ? `${detail.user.email}${detail.user.emailVerified ? " · 已验证" : " · 未验证"}` : "—"} />
                            </div>
                        </Panel>
                        <Panel title="注册来源" actions={<Button onClick={() => void openAttribution()}>修正归因</Button>}>
                            <div className="grid gap-3 sm:grid-cols-3">
                                <Metric label="注册 IP" value={detail.user.registrationIp || "—"} />
                                <Metric label="渠道" value={detail.user.channelName || "—"} />
                                <Metric label="邀请码" value={detail.user.inviteCode || "自然注册"} />
                            </div>
                        </Panel>
                        <Panel
                            title="积分账户"
                            note="购买和管理员发放积分默认 12 个月有效"
                            actions={
                                <Button
                                    type="primary"
                                    onClick={() => {
                                        setGrantKey(randomUuid());
                                        setGrantOpen(true);
                                    }}
                                >
                                    发放积分
                                </Button>
                            }
                        >
                            <div className="grid gap-3 sm:grid-cols-3">
                                <Metric label="当前余额" value={formatPoints(detail.credits?.account.balance || "0")} />
                                <Metric label="待计费" value={String(detail.credits?.pendingCharges || 0)} />
                                <Metric label="有效批次" value={String(detail.credits?.lots.filter((lot) => BigInt(lot.remaining) > BigInt(0)).length || 0)} />
                            </div>
                        </Panel>
                        <Panel title="实际消耗">
                            {detail.usage.length ? (
                                detail.usage.map((item) => (
                                    <p key={item.currency} className="mb-2 font-mono">
                                        {formatUsageAmount(item.currency, item.totalAmount)} · {item.totalTokens} Token
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
                                    { title: "生成状态", dataIndex: "status", render: (value) => <StatusTag value={value} kind="job" /> },
                                    { title: "对账", dataIndex: "billingStatus", render: (value) => <StatusTag value={value} kind="billing" /> },
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
                                    { title: "金额", render: (_, item) => formatUsageAmount(item.currency, item.totalAmount) },
                                    {
                                        title: "积分",
                                        render: (_, item) =>
                                            item.creditStatus === "payment_required" ? `待支付 ${formatPoints(item.creditPoints || 0)} 分` : item.creditPoints ? `${formatPoints(item.creditPoints)} 分` : creditStatusLabel(item.creditStatus),
                                    },
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
            <Modal
                open={grantOpen}
                zIndex={1600}
                title="发放积分"
                okText="确认发放"
                cancelText="取消"
                confirmLoading={granting}
                cancelButtonProps={{ disabled: granting }}
                maskClosable={!granting}
                keyboard={!granting}
                onOk={() => void submitGrant()}
                onCancel={() => setGrantOpen(false)}
            >
                <div className="space-y-4">
                    <Input value={grantCredits} inputMode="numeric" placeholder="积分数量，例如 10000" onChange={(event) => setGrantCredits(event.target.value.replace(/\D/g, ""))} />
                    <Select
                        value={grantSource}
                        className="w-full"
                        onChange={setGrantSource}
                        options={[
                            { value: "purchase", label: "购买到账" },
                            { value: "promotion", label: "活动赠送" },
                            { value: "compensation", label: "人工补偿" },
                        ]}
                    />
                    <Input.TextArea value={grantNote} maxLength={500} showCount placeholder="发放原因或关联订单号" onChange={(event) => setGrantNote(event.target.value)} />
                    <p className="text-xs text-stone-500">积分仅通过新增批次和流水入账，不能直接覆盖余额。</p>
                </div>
            </Modal>
            <Modal open={attributionOpen} zIndex={1600} title="修正用户来源" okText="保存修正" confirmLoading={attributionSaving} onOk={() => void submitAttribution()} onCancel={() => setAttributionOpen(false)}>
                <div className="space-y-4">
                    <Select
                        className="w-full"
                        placeholder="渠道"
                        value={attributionChannelId}
                        options={channels.map((item) => ({ value: item.id, label: item.channelName }))}
                        onChange={(value) => {
                            setAttributionChannelId(value);
                            setAttributionCampaignId(undefined);
                            setAttributionBatchId(undefined);
                            setAttributionInviteId(undefined);
                        }}
                    />
                    <Select
                        allowClear
                        className="w-full"
                        placeholder="活动（可选）"
                        value={attributionCampaignId}
                        options={campaigns.filter((item) => !item.channelId || item.channelId === attributionChannelId).map((item) => ({ value: item.id, label: item.name }))}
                        onChange={(value) => {
                            setAttributionCampaignId(value);
                            setAttributionBatchId(undefined);
                            setAttributionInviteId(undefined);
                        }}
                    />
                    <Select
                        allowClear
                        className="w-full"
                        placeholder="批次（可选）"
                        value={attributionBatchId}
                        options={batches.filter((item) => item.campaignId === attributionCampaignId).map((item) => ({ value: item.id, label: item.name }))}
                        onChange={(value) => {
                            setAttributionBatchId(value);
                            setAttributionInviteId(undefined);
                        }}
                    />
                    <Select
                        allowClear
                        className="w-full"
                        placeholder="邀请码（可选）"
                        value={attributionInviteId}
                        options={invites
                            .filter((item) => item.channelId === attributionChannelId && (item.campaignId || undefined) === attributionCampaignId && (item.batchId || undefined) === attributionBatchId)
                            .map((item) => ({ value: item.id, label: `${item.code} · ${item.name}` }))}
                        onChange={setAttributionInviteId}
                    />
                    <Input.TextArea maxLength={500} showCount value={attributionReason} placeholder="必填：说明修正原因" onChange={(event) => setAttributionReason(event.target.value)} />
                </div>
            </Modal>
        </>
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
    const [pricing, setPricing] = useState<CreditPricing>();
    const [usdRate, setUsdRate] = useState("");
    const [guard, setGuard] = useState<CreditGuardSettings>();
    const [videoMinimumPoints, setVideoMinimumPoints] = useState<number | null>(null);
    const [codeCredits, setCodeCredits] = useState("");
    const [codeExpiry, setCodeExpiry] = useState("");
    const [issuedCode, setIssuedCode] = useState("");
    const [codes, setCodes] = useState<ActivationCodeRecord[]>([]);
    const [issuingCode, setIssuingCode] = useState(false);
    useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        getAdminUsage({ page, pageSize: 20 }, controller.signal)
            .then(setData)
            .catch((error) => message.error(error.message))
            .finally(() => setLoading(false));
        return () => controller.abort();
    }, [page]);
    useEffect(() => {
        const controller = new AbortController();
        getAdminCreditPricing(controller.signal)
            .then((value) => {
                setPricing(value);
                setUsdRate(value.usdCnyRate || "");
            })
            .catch((error) => message.error(error.message));
        return () => controller.abort();
    }, []);
    useEffect(() => {
        const controller = new AbortController();
        getAdminCreditGuard(controller.signal)
            .then((value) => {
                setGuard(value);
                setVideoMinimumPoints(value.videoMinimumPoints);
            })
            .catch((error) => message.error(error.message));
        return () => controller.abort();
    }, []);
    useEffect(() => {
        const controller = new AbortController();
        getAdminActivationCodes(controller.signal)
            .then(setCodes)
            .catch((error) => message.error(error.message));
        return () => controller.abort();
    }, []);
    const saveRate = async () => {
        const value = await setAdminCreditPricing(usdRate);
        setPricing(value);
        setUsdRate(value.usdCnyRate || "");
        message.success("USD/CNY 结算汇率已更新，待计费任务将自动重试");
    };
    const saveGuard = async () => {
        if (!Number.isSafeInteger(videoMinimumPoints) || !videoMinimumPoints || videoMinimumPoints <= 0) {
            message.error("请输入大于 0 的整数积分");
            return;
        }
        const value = await setAdminCreditGuard(videoMinimumPoints);
        setGuard(value);
        setVideoMinimumPoints(value.videoMinimumPoints);
        message.success("视频最低生成许可值已更新");
    };
    const issueCode = async () => {
        const credits = Number(codeCredits);
        if (!Number.isSafeInteger(credits) || credits <= 0 || credits > 1_000_000_000 || !codeExpiry) {
            message.error("请输入有效积分和兑换截止时间");
            return;
        }
        setIssuingCode(true);
        setIssuedCode("");
        try {
            const created = await issueAdminActivationCode(credits, new Date(codeExpiry).toISOString());
            setIssuedCode(created.code);
            setCodes(await getAdminActivationCodes());
            message.success("激活码已生成，完整码仅显示这一次");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "激活码生成失败");
        } finally {
            setIssuingCode(false);
        }
    };
    return (
        <div className="space-y-5">
            <Panel title="积分定价" note="固定 1 元 = 100 积分，原始费用加价 20%，不足 1 积分向上取整">
                <div className="flex flex-wrap items-end gap-3">
                    <label className="text-sm">
                        <span className="mb-1 block text-stone-500">USD/CNY 结算汇率</span>
                        <Input value={usdRate} className="w-52 font-mono" placeholder="例如 7.20000000" onChange={(event) => setUsdRate(event.target.value)} />
                    </label>
                    <Button type="primary" disabled={!usdRate || usdRate === pricing?.usdCnyRate} onClick={() => void saveRate()}>
                        保存汇率
                    </Button>
                    <span className="pb-2 text-xs text-stone-500">Token360 返回 USD 时按此汇率换算；CNY 账单不使用汇率。</span>
                </div>
            </Panel>
            <Panel title="生成积分保护" note="视频任务提交时先检查并冻结最低许可积分；实际费用不足时结果将等待充值后自动交付">
                <div className="flex flex-wrap items-end gap-3">
                    <label className="text-sm">
                        <span className="mb-1 block text-stone-500">视频最低生成许可值</span>
                        <InputNumber min={1} max={1_000_000_000} precision={0} value={videoMinimumPoints} className="w-52" onChange={setVideoMinimumPoints} addonAfter="积分" />
                    </label>
                    <Button type="primary" disabled={!videoMinimumPoints || videoMinimumPoints === guard?.videoMinimumPoints} onClick={() => void saveGuard()}>
                        保存许可值
                    </Button>
                    <span className="pb-2 text-xs text-stone-500">默认 3000；修改后仅影响新提交的视频任务。</span>
                </div>
            </Panel>
            <Panel title="积分激活码" note="与其他积分共用余额；完整激活码仅在生成时显示一次">
                <div className="flex flex-wrap items-end gap-3">
                    <label className="text-sm">
                        <span className="mb-1 block text-stone-500">积分数量</span>
                        <Input value={codeCredits} inputMode="numeric" className="w-40" onChange={(event) => setCodeCredits(event.target.value.replace(/\D/g, ""))} />
                    </label>
                    <label className="text-sm">
                        <span className="mb-1 block text-stone-500">兑换截止时间</span>
                        <Input type="datetime-local" value={codeExpiry} className="w-56" onChange={(event) => setCodeExpiry(event.target.value)} />
                    </label>
                    <Button type="primary" loading={issuingCode} onClick={() => void issueCode()}>
                        生成激活码
                    </Button>
                </div>
                {issuedCode && (
                    <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-emerald-500/10 p-3">
                        <code className="break-all font-mono">{issuedCode}</code>
                        <Button size="small" onClick={() => void navigator.clipboard.writeText(issuedCode)}>
                            复制
                        </Button>
                    </div>
                )}
                <div className="mt-4 space-y-1 text-xs text-stone-500">
                    {codes.map((item) => (
                        <div key={item.id} className="flex flex-wrap gap-3">
                            <span>尾号 {item.codeHint}</span>
                            <span>{formatPoints(item.credits)} 积分</span>
                            <span>{item.redeemedAt ? "已兑换" : new Date(item.expiresAt) <= new Date() ? "已过期" : "待兑换"}</span>
                        </div>
                    ))}
                </div>
            </Panel>
            <div className="grid gap-4 md:grid-cols-3">
                {data.summary.map((item) => (
                    <Metric key={item.currency} label={usageAmountLabel(item.currency, item.totalAmount)} value={formatUsageAmount(item.currency, item.totalAmount)} note={`${item.totalTokens} Token · ${item.videoDurationSeconds} 秒`} />
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
                        { title: "渠道", dataIndex: "provider", render: providerLabel },
                        { title: "计量", render: (_, item) => `${item.totalTokens || 0} Token · ${item.videoDurationSeconds || 0} 秒 · ${item.generatedImages || 0} 图` },
                        {
                            title: "原始费用",
                            render: (_, item) => <b className="font-mono">{formatUsageAmount(item.currency, item.totalAmount)}</b>,
                        },
                        {
                            title: "优惠实付",
                            render: (_, item) => (item.providerPaidAmount && item.providerPaidAmount !== item.totalAmount ? <span className="font-mono text-stone-500">{formatUsageAmount(item.currency, item.providerPaidAmount)}</span> : "—"),
                        },
                        {
                            title: "扣除积分",
                            render: (_, item) =>
                                item.creditStatus === "payment_required" ? (
                                    <b className="font-mono text-amber-600">待支付 {formatPoints(item.creditPoints || 0)}</b>
                                ) : item.creditPoints ? (
                                    <b className="font-mono">{formatPoints(item.creditPoints)}</b>
                                ) : (
                                    creditStatusLabel(item.creditStatus)
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
                                        {group.key === "capability" ? capabilityLabel(item.key) : item.key}
                                    </span>
                                    <span className="shrink-0 text-right font-mono">
                                        {formatUsageAmount(item.currency, item.totalAmount)}
                                        <small className="block text-stone-500">
                                            {item.calls} 次 · {item.totalTokens} Token
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
    const [searchParams, setSearchParams] = useSearchParams();
    const [items, setItems] = useState<AdminJob[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const status = searchParams.get("status") || undefined;
    const q = searchParams.get("q") || "";
    const createdFrom = searchParams.get("createdFrom") || undefined;
    const createdTo = searchParams.get("createdTo") || undefined;
    const [loading, setLoading] = useState(true);
    const [reconcilingId, setReconcilingId] = useState<string>();
    const [reviewingJob, setReviewingJob] = useState<AdminJob>();
    const [reviewResolution, setReviewResolution] = useState<ManualBillingResolution["resolution"]>("not_billed");
    const [reviewAmount, setReviewAmount] = useState("");
    const [reviewCurrency, setReviewCurrency] = useState<"CNY" | "USD">("CNY");
    const [reviewNote, setReviewNote] = useState("");
    const updateSearch = (key: string, value?: string) => {
        const next = new URLSearchParams(searchParams);
        if (value) next.set(key, value);
        else next.delete(key);
        setPage(1);
        setSearchParams(next, { replace: true });
    };
    const clearRange = () => {
        const next = new URLSearchParams(searchParams);
        next.delete("createdFrom");
        next.delete("createdTo");
        setPage(1);
        setSearchParams(next, { replace: true });
    };
    const load = useCallback(() => {
        setLoading(true);
        getAdminJobs({ page, pageSize: 20, status, q, createdFrom, createdTo })
            .then((data) => {
                setItems(data.items);
                setTotal(data.total);
            })
            .catch((error) => message.error(error.message))
            .finally(() => setLoading(false));
    }, [createdFrom, createdTo, page, q, status]);
    useEffect(load, [load]);
    const closeReview = () => {
        if (reconcilingId) return;
        setReviewingJob(undefined);
        setReviewResolution("not_billed");
        setReviewAmount("");
        setReviewCurrency("CNY");
        setReviewNote("");
    };
    const submitManualReview = () => {
        if (!reviewingJob || reconcilingId) return;
        const note = reviewNote.trim();
        if (note.length < 2) {
            message.warning("请填写至少 2 个字的核验备注");
            return;
        }
        if (reviewResolution === "billed" && (!reviewAmount || Number(reviewAmount) <= 0)) {
            message.warning("请输入大于 0 的供应商实际扣费金额");
            return;
        }
        const input: ManualBillingResolution = reviewResolution === "not_billed"
            ? { resolution: "not_billed", note }
            : { resolution: "billed", amount: reviewAmount, currency: reviewCurrency, note };
        Modal.confirm({
            title: reviewResolution === "not_billed" ? "确认供应商未扣费？" : "确认按实际金额结算？",
            content: reviewResolution === "not_billed"
                ? "确认后将解除该任务的冻结积分，并标记为未出账。此操作会写入审计日志。"
                : `确认后将按 ${reviewAmount} ${reviewCurrency} 换算并扣除积分，生成任务仍保持失败。此操作会写入审计日志。`,
            okText: reviewResolution === "not_billed" ? "确认未扣费并释放" : "确认扣费并结算",
            cancelText: "返回检查",
            okButtonProps: reviewResolution === "billed" ? { danger: true } : undefined,
            onOk: async () => {
                setReconcilingId(reviewingJob.id);
                try {
                    const result = await resolveAdminJobBilling(reviewingJob.id, input);
                    setItems((current) => current.map((job) => (job.id === reviewingJob.id
                        ? { ...job, billingStatus: result.status, billingError: undefined }
                        : job)));
                    setReviewingJob(undefined);
                    if (result.status === "not_billed") message.success("已确认未扣费，冻结积分已释放");
                    else message.success(`已完成结算${result.points ? `，扣除 ${result.points} 积分` : ""}`);
                    setReviewResolution("not_billed");
                    setReviewAmount("");
                    setReviewCurrency("CNY");
                    setReviewNote("");
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "人工核验处理失败");
                    throw error;
                } finally {
                    setReconcilingId(undefined);
                }
            },
        });
    };
    return (
        <>
        <Panel
            title="全局生成任务"
            note={createdFrom && createdTo ? `已筛选 ${createdFrom} 至 ${createdTo}；对账异常不会改写生成状态` : "对账异常不会改写生成状态"}
            actions={
                <Space>
                    <Input.Search
                        allowClear
                        placeholder="任务 / 对账标识 / 资源 ID"
                        defaultValue={q}
                        onSearch={(value) => {
                            updateSearch("q", value);
                        }}
                    />
                    <Select
                        allowClear
                        className="w-32"
                        placeholder="生成状态"
                        value={status}
                        options={["completed", "payment_required", "billing_pending", "failed", "cancelled", "running"].map((value) => ({ value, label: jobStatusLabel(value) }))}
                        onChange={(value) => {
                            updateSearch("status", value);
                        }}
                    />
                    {createdFrom && createdTo ? <Button onClick={clearRange}>清除周期</Button> : null}
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
                    { title: "生成", dataIndex: "status", render: (value) => <StatusTag value={value} kind="job" /> },
                    { title: "对账", dataIndex: "billingStatus", render: (value) => <StatusTag value={value} kind="billing" /> },
                    {
                        title: "供应商标识",
                        render: (_, item) => (
                            <div className="max-w-52 space-y-1 text-xs">
                                <p>对账标识：{copyable(item.billingTraceId)}</p>
                                <p>资源标识：{copyable(item.providerJobId)}</p>
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
                                disabled={item.billingStatus === "mismatch" ? !item.providerJobId : !item.billingTraceId}
                                loading={reconcilingId === item.id}
                                onClick={async () => {
                                    if (reconcilingId) return;
                                    if (item.billingStatus === "mismatch") {
                                        setReviewingJob(item);
                                        return;
                                    }
                                    setReconcilingId(item.id);
                                    try {
                                        const result = await reconcileAdminJob(item.id);
                                        setItems((current) => current.map((job) => (job.id === item.id ? { ...job, billingStatus: result.status } : job)));
                                        if (result.status === "mismatch") message.warning("供应商暂未返回账单，任务继续保留为待人工核验，冻结积分不变");
                                        else message.success(`对账状态：${billingStatusLabel(result.status)}`);
                                    } catch (error) {
                                        message.error(error instanceof Error ? error.message : "人工核验失败");
                                    } finally {
                                        setReconcilingId(undefined);
                                    }
                                }}
                            >
                                {reconcilingId === item.id ? "处理中" : item.billingStatus === "mismatch" ? "人工核验" : "重新对账"}
                            </Button>
                        ),
                    },
                ]}
            />
        </Panel>
        <Modal
            open={Boolean(reviewingJob)}
            title="人工核验供应商扣费"
            okText="继续确认"
            cancelText="暂不处理"
            confirmLoading={Boolean(reconcilingId)}
            maskClosable={!reconcilingId}
            closable={!reconcilingId}
            onCancel={closeReview}
            onOk={submitManualReview}
        >
            <div className="space-y-4 py-2">
                <Alert
                    type="warning"
                    showIcon
                    message="请先在供应商后台核对任务号与实际账单"
                    description={`任务 ${reviewingJob?.id || "—"}；供应商任务号 ${reviewingJob?.providerJobId || "—"}`}
                />
                <Radio.Group
                    className="flex flex-col gap-3"
                    value={reviewResolution}
                    onChange={(event) => setReviewResolution(event.target.value)}
                >
                    <Radio value="not_billed">确认未扣费，释放冻结积分</Radio>
                    <Radio value="billed">确认已扣费，按实际金额结算积分</Radio>
                </Radio.Group>
                {reviewResolution === "billed" ? (
                    <Space.Compact className="w-full">
                        <InputNumber
                            className="w-full"
                            stringMode
                            min="0.00000001"
                            precision={8}
                            placeholder="供应商实际扣费金额"
                            value={reviewAmount || null}
                            onChange={(value) => setReviewAmount(value === null ? "" : String(value))}
                        />
                        <Select
                            className="w-28"
                            value={reviewCurrency}
                            options={[{ value: "CNY", label: "CNY" }, { value: "USD", label: "USD" }]}
                            onChange={setReviewCurrency}
                        />
                    </Space.Compact>
                ) : null}
                <Input.TextArea
                    rows={3}
                    maxLength={500}
                    showCount
                    placeholder="必填：记录核验依据，例如供应商后台查询时间、账单结果"
                    value={reviewNote}
                    onChange={(event) => setReviewNote(event.target.value)}
                />
            </div>
        </Modal>
        </>
    );
}

type BillingRuleDraft = {
    provider: ProviderBillingRule["provider"];
    modelPattern: string;
    matchType: ProviderBillingRule["matchType"];
    discountPercent: number;
    priority: number;
    enabled: boolean;
    note: string;
};
const emptyBillingRuleDraft: BillingRuleDraft = {
    provider: "runninghub",
    modelPattern: "",
    matchType: "contains",
    discountPercent: 100,
    priority: 0,
    enabled: true,
    note: "",
};

function BillingRulesPanel() {
    const [items, setItems] = useState<ProviderBillingRule[]>();
    const [editing, setEditing] = useState<ProviderBillingRule>();
    const [draft, setDraft] = useState<BillingRuleDraft>(emptyBillingRuleDraft);
    const [editorOpen, setEditorOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const load = useCallback((signal?: AbortSignal) => {
        getAdminBillingRules(signal)
            .then(setItems)
            .catch((error) => {
                if (!(error instanceof DOMException && error.name === "AbortError")) message.error(error instanceof Error ? error.message : "计费规则加载失败");
            });
    }, []);
    useEffect(() => {
        const controller = new AbortController();
        load(controller.signal);
        return () => controller.abort();
    }, [load]);
    const openEditor = (rule?: ProviderBillingRule) => {
        setEditing(rule);
        setDraft(
            rule
                ? {
                      provider: rule.provider,
                      modelPattern: rule.modelPattern,
                      matchType: rule.matchType,
                      discountPercent: Number(rule.discountRate) * 100,
                      priority: rule.priority,
                      enabled: rule.enabled,
                      note: rule.note,
                  }
                : emptyBillingRuleDraft,
        );
        setEditorOpen(true);
    };
    const save = async () => {
        if (!draft.modelPattern.trim()) return void message.warning("请填写模型匹配内容");
        if (!(draft.discountPercent > 0 && draft.discountPercent <= 100)) return void message.warning("折扣率必须大于 0% 且不超过 100%");
        const input: ProviderBillingRuleInput = {
            provider: draft.provider,
            modelPattern: draft.modelPattern.trim(),
            matchType: draft.matchType,
            discountRate: (draft.discountPercent / 100).toFixed(8).replace(/0+$/, "").replace(/\.$/, ""),
            priority: draft.priority,
            enabled: draft.enabled,
            note: draft.note.trim(),
        };
        setSaving(true);
        try {
            const saved = editing ? await updateAdminBillingRule(editing.ruleKey, input) : await createAdminBillingRule(input);
            setItems((current) => (editing ? current?.map((item) => (item.ruleKey === saved.ruleKey ? saved : item)) : [...(current || []), saved]));
            setEditorOpen(false);
            message.success(editing ? `计费规则 v${saved.version} 已生效` : "计费规则已创建");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "计费规则保存失败");
        } finally {
            setSaving(false);
        }
    };
    if (!items) return <Loading />;
    return (
        <>
            <Panel
                title="供应商计费规则"
                note="任务创建时固化命中的规则版本；后续调整不会改变历史任务"
                actions={
                    <Button type="primary" onClick={() => openEditor()}>
                        新建规则
                    </Button>
                }
            >
                <div className="mb-5 grid gap-3 border-y border-stone-200 py-4 text-sm dark:border-white/10 lg:grid-cols-2">
                    <div>
                        <p className="text-xs font-medium text-stone-500">计费公式</p>
                        <p className="mt-1.5 font-mono font-semibold text-stone-900 dark:text-stone-100">用户扣除积分 = ⌈供应商实际扣费 ÷ 折扣率 × 1.2 × 100⌉</p>
                        <p className="mt-1 text-xs text-stone-500">1.2 为平台计费系数，100 为每元兑换的积分数，计算结果向上取整。</p>
                        <p className="mt-1 text-xs text-stone-500">不同模型分别匹配各自折扣率；调整时请在对应规则上新建版本，只影响后续新任务。</p>
                    </div>
                    <div>
                        <p className="text-xs font-medium text-stone-500">示例</p>
                        <p className="mt-1.5 text-stone-700 dark:text-stone-300">
                            实际扣费 8 元、折扣率 80%：原价为 8 ÷ 80% = 10 元，用户扣除 ⌈10 × 1.2 × 100⌉ = <b className="font-mono text-stone-950 dark:text-white">1,200 积分</b>。
                        </p>
                    </div>
                </div>
                <Table<ProviderBillingRule>
                    rowKey="ruleKey"
                    pagination={false}
                    dataSource={items}
                    columns={[
                        { title: "渠道", dataIndex: "provider", render: (value) => (value === "runninghub_global" ? "海马云 · 国际区" : "海马云 · 中国区") },
                        {
                            title: "模型匹配",
                            render: (_, item) => (
                                <div>
                                    <b className="font-mono text-xs">{item.modelPattern}</b>
                                    <p className="mt-1 text-xs text-stone-500">{item.matchType === "exact" ? "完全匹配" : "包含匹配"}</p>
                                </div>
                            ),
                        },
                        { title: "折扣率", dataIndex: "discountRate", render: (value) => <b className="font-mono">{formatDecimal(String(Number(value) * 100), 4)}%</b> },
                        { title: "优先级", dataIndex: "priority" },
                        { title: "版本", dataIndex: "version", render: (value) => <Tag bordered={false}>v{value}</Tag> },
                        {
                            title: "状态",
                            dataIndex: "enabled",
                            render: (value) => (
                                <Tag bordered={false} color={value ? "green" : "default"}>
                                    {value ? "已启用" : "已停用"}
                                </Tag>
                            ),
                        },
                        { title: "生效时间", dataIndex: "createdAt", render: formatDate },
                        {
                            title: "操作",
                            render: (_, item) => (
                                <Button size="small" onClick={() => openEditor(item)}>
                                    新建版本
                                </Button>
                            ),
                        },
                    ]}
                />
            </Panel>
            <Modal
                open={editorOpen}
                title={editing ? `新建规则版本 · 当前 v${editing.version}` : "新建计费规则"}
                okText={editing ? "保存并生效" : "创建规则"}
                cancelText="取消"
                confirmLoading={saving}
                onOk={() => void save()}
                onCancel={() => !saving && setEditorOpen(false)}
                destroyOnHidden
            >
                <div className="space-y-4 py-3">
                    <div className="grid grid-cols-2 gap-3">
                        <label className="block">
                            <span className="mb-1.5 block text-sm text-stone-500">供应商渠道</span>
                            <Select
                                className="w-full"
                                value={draft.provider}
                                options={[
                                    { value: "runninghub", label: "海马云 · 中国区" },
                                    { value: "runninghub_global", label: "海马云 · 国际区" },
                                ]}
                                onChange={(provider) => setDraft((current) => ({ ...current, provider }))}
                            />
                        </label>
                        <label className="block">
                            <span className="mb-1.5 block text-sm text-stone-500">匹配方式</span>
                            <Select
                                className="w-full"
                                value={draft.matchType}
                                options={[
                                    { value: "contains", label: "模型 ID 包含" },
                                    { value: "exact", label: "模型 ID 完全等于" },
                                ]}
                                onChange={(matchType) => setDraft((current) => ({ ...current, matchType }))}
                            />
                        </label>
                    </div>
                    <label className="block">
                        <span className="mb-1.5 block text-sm text-stone-500">模型匹配内容</span>
                        <Input maxLength={200} value={draft.modelPattern} placeholder="例如：seedance-2.5" onChange={(event) => setDraft((current) => ({ ...current, modelPattern: event.target.value }))} />
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                        <label className="block">
                            <span className="mb-1.5 block text-sm text-stone-500">供应商折扣率</span>
                            <InputNumber className="w-full" min={0.000001} max={100} precision={6} addonAfter="%" value={draft.discountPercent} onChange={(value) => setDraft((current) => ({ ...current, discountPercent: value || 0 }))} />
                        </label>
                        <label className="block">
                            <span className="mb-1.5 block text-sm text-stone-500">匹配优先级</span>
                            <InputNumber className="w-full" min={-10_000} max={10_000} precision={0} value={draft.priority} onChange={(value) => setDraft((current) => ({ ...current, priority: value || 0 }))} />
                        </label>
                    </div>
                    <label className="flex items-center justify-between rounded-lg border border-stone-200 px-3 py-2 dark:border-white/10">
                        <span>
                            <b className="block text-sm">启用此版本</b>
                            <small className="text-stone-500">停用后新任务不再匹配，历史任务不受影响</small>
                        </span>
                        <Switch checked={draft.enabled} onChange={(enabled) => setDraft((current) => ({ ...current, enabled }))} />
                    </label>
                    <label className="block">
                        <span className="mb-1.5 block text-sm text-stone-500">变更说明</span>
                        <Input maxLength={200} value={draft.note} placeholder="记录本次调整原因" onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))} />
                    </label>
                    <p className="rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 text-xs text-amber-600 dark:text-amber-400">保存后只影响新创建的任务；已创建任务继续使用原规则版本和折扣率。</p>
                </div>
            </Modal>
        </>
    );
}

function ModelsPanel({ provider }: { provider: AdminProvider["id"] }) {
    const [items, setItems] = useState<AdminModel[]>();
    const [allModels, setAllModels] = useState<AdminModel[]>();
    const [providers, setProviders] = useState<AdminProviders>();
    const [directorSettings, setDirectorSettings] = useState<DirectorSettings>();
    const [updatingModelId, setUpdatingModelId] = useState<string>();
    const [savingDirector, setSavingDirector] = useState(false);
    const load = useCallback(() => {
        const controller = new AbortController();
        Promise.all([getAdminModels(provider, controller.signal), getAdminModels(undefined, controller.signal), getAdminProviders(controller.signal), getAdminDirectorSettings(controller.signal)])
            .then(([models, modelsAcrossProviders, providerState, nextDirectorSettings]) => {
                setItems(models);
                setAllModels(modelsAcrossProviders);
                setProviders(providerState);
                setDirectorSettings(nextDirectorSettings);
            })
            .catch((error) => message.error(error.message));
        return controller;
    }, [provider]);
    useEffect(() => {
        setItems(undefined);
        const controller = load();
        return () => controller.abort();
    }, [load]);
    if (!items || !allModels || !providers || !directorSettings) return <Loading />;
    const current = providers.providers.find((item) => item.id === provider);
    const linkedToChina = provider === "runninghub_global" && current?.configured === true && providers.activeProviderId === "runninghub";
    const active = providers.activeProviderId === provider || linkedToChina;
    const directorModelOptions = allModels
        .filter((item) => item.capability === "text" && item.configurable && item.enabled && item.healthy && providers.providers.some((providerItem) => providerItem.id === item.providerId && providerItem.configured))
        .map((item) => ({ value: item.id, label: `${providers.providers.find((providerItem) => providerItem.id === item.providerId)?.displayName || item.providerId} · ${item.displayName}` }));
    const updateDirectorSettings = async (next: Pick<DirectorSettings, "enabled" | "modelId">) => {
        setSavingDirector(true);
        try {
            const saved = await setAdminDirectorSettings(next);
            setDirectorSettings(saved);
            message.success("导演台设置已更新，新任务立即生效");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "导演台设置更新失败");
        } finally {
            setSavingDirector(false);
        }
    };
    return (
        <Panel
            title={`${current?.displayName || provider} 模型`}
            note={`${items.filter((item) => item.healthy).length}/${items.length} 正常 · ${current?.configured ? "密钥已配置" : "密钥未配置"}`}
            actions={
                <Button
                    type={active ? "default" : "primary"}
                    disabled={active || !current?.configured}
                    onClick={async () => {
                        const next = await setActiveAdminProvider(provider);
                        setProviders(next);
                        message.success(`已切换到 ${current?.displayName || provider}，新任务立即生效`);
                    }}
                >
                    {linkedToChina ? "随中国区启用" : active ? "当前画布渠道" : current?.configured ? "设为画布渠道" : "请先配置 API Key"}
                </Button>
            }
        >
            <div className="mb-5 grid gap-4 rounded-xl border border-stone-200 bg-stone-50 p-4 dark:border-white/10 dark:bg-white/[0.03] lg:grid-cols-[1fr_minmax(280px,520px)] lg:items-center">
                <div>
                    <div className="flex items-center gap-3">
                        <b>AI 漫剧导演台</b>
                        <Switch size="small" checked={directorSettings.enabled} loading={savingDirector} onChange={(enabled) => void updateDirectorSettings({ enabled, modelId: directorSettings.modelId })} />
                    </div>
                    <p className="mt-1 text-xs text-stone-500">统一控制导演台是否开放以及规划工作流时使用的文字模型。</p>
                </div>
                <label>
                    <span className="mb-1.5 block text-xs text-stone-500">导演台文字模型</span>
                    <Select
                        className="w-full"
                        value={directorSettings.modelId || "__default__"}
                        disabled={savingDirector}
                        options={[{ value: "__default__", label: "跟随用户默认文字模型" }, ...directorModelOptions]}
                        onChange={(value) => void updateDirectorSettings({ enabled: directorSettings.enabled, modelId: value === "__default__" ? null : value })}
                    />
                </label>
            </div>
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
                    { title: "能力", dataIndex: "capability", render: capabilityLabel },
                    {
                        title: "启用",
                        render: (_, item) => {
                            if (!item.configurable)
                                return (
                                    <Tooltip title="该模型已从供应商同步，但画布还没有对应的生成节点和参数映射">
                                        <Tag bordered={false}>画布未接入</Tag>
                                    </Tooltip>
                                );
                            const unavailable = !item.healthy && !item.enabled;
                            const hint = unavailable ? "模型当前不健康，暂不能启用" : item.enabled ? "停用后新任务将不再显示此模型" : "启用此模型";
                            return (
                                <Tooltip title={hint}>
                                    <span>
                                        <Switch
                                            size="small"
                                            checked={item.enabled}
                                            disabled={unavailable}
                                            loading={updatingModelId === item.id}
                                            onChange={async (enabled) => {
                                                setUpdatingModelId(item.id);
                                                try {
                                                    await setAdminModelEnabled(item.id, enabled);
                                                    setItems((currentItems) => currentItems?.map((currentItem) => (currentItem.id === item.id ? { ...currentItem, enabled } : currentItem)));
                                                    message.success(`${item.displayName} 已${enabled ? "启用" : "停用"}`);
                                                } catch (error) {
                                                    message.error(error instanceof Error ? error.message : "模型状态更新失败");
                                                } finally {
                                                    setUpdatingModelId(undefined);
                                                }
                                            }}
                                        />
                                    </span>
                                </Tooltip>
                            );
                        },
                    },
                    { title: "健康", dataIndex: "healthy", render: (value) => <StatusTag value={value ? "healthy" : "unhealthy"} /> },
                    { title: "检查时间", dataIndex: "checkedAt", render: formatDate },
                ]}
            />
        </Panel>
    );
}

function PaymentsPanel() {
    const [items, setItems] = useState<PaymentOrder[]>([]);
    const [plans, setPlans] = useState<BillingPlan[]>([]);
    const [settings, setSettings] = useState<AdminPaymentSettings>();
    const [loading, setLoading] = useState(true);
    const [syncingId, setSyncingId] = useState<string>();
    const [updatingPlanId, setUpdatingPlanId] = useState<string>();
    const [editingPlan, setEditingPlan] = useState<BillingPlan>();
    const [planEditorOpen, setPlanEditorOpen] = useState(false);
    const [savingPlan, setSavingPlan] = useState(false);
    const [savingAccess, setSavingAccess] = useState(false);
    const [planDraft, setPlanDraft] = useState({ name: "", priceYuan: "", credits: 1000 });
    const load = useCallback(async (signal?: AbortSignal) => {
        setLoading(true);
        try {
            const [nextItems, nextPlans, nextSettings] = await Promise.all([getAdminPaymentOrders(signal), getAdminPaymentPlans(signal), getAdminPaymentSettings(signal)]);
            setItems(nextItems);
            setPlans(nextPlans);
            setSettings(nextSettings);
        } catch (error) {
            if (!(error instanceof DOMException && error.name === "AbortError")) message.error(error instanceof Error ? error.message : "充值数据加载失败");
        } finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => {
        const controller = new AbortController();
        void load(controller.signal);
        return () => controller.abort();
    }, [load]);
    const sync = async (orderId: string) => {
        setSyncingId(orderId);
        try {
            const order = await syncAdminPaymentOrder(orderId);
            setItems((current) => current.map((item) => (item.id === order.id ? { ...item, ...order } : item)));
            message.success(order.status === "paid" ? "订单已到账" : "订单状态已同步");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "订单同步失败");
        } finally {
            setSyncingId(undefined);
        }
    };
    const openPlanEditor = (plan?: BillingPlan) => {
        setEditingPlan(plan);
        setPlanDraft({
            name: plan?.name || "",
            priceYuan: plan ? formatPaymentAmount(plan.priceCents) : "",
            credits: plan?.credits || 1000,
        });
        setPlanEditorOpen(true);
    };
    const savePlan = async () => {
        const priceCents = parseYuanToCents(planDraft.priceYuan);
        if (!planDraft.name.trim()) return void message.warning("请填写套餐名称");
        if (!priceCents) return void message.warning("请输入大于 0、最多两位小数的价格");
        if (!Number.isInteger(planDraft.credits) || planDraft.credits <= 0) return void message.warning("请输入有效积分数量");
        const input: PaymentPlanInput = {
            name: planDraft.name.trim(),
            priceCents,
            credits: planDraft.credits,
            enabled: editingPlan?.enabled || false,
        };
        setSavingPlan(true);
        try {
            const saved = editingPlan ? await updateAdminPaymentPlan(editingPlan.id, input) : await createAdminPaymentPlan(input);
            setPlans((current) => (editingPlan ? current.map((item) => (item.id === saved.id ? saved : item)) : [...current, saved]));
            setPlanEditorOpen(false);
            message.success(editingPlan ? "套餐调整已保存" : "草稿套餐已创建");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "套餐保存失败");
        } finally {
            setSavingPlan(false);
        }
    };
    const setPlanPublished = (plan: BillingPlan, enabled: boolean) => {
        Modal.confirm({
            title: enabled ? "发布这个充值套餐？" : "下架这个充值套餐？",
            content: enabled ? "发布后普通用户可立即看到并购买，历史订单不会改变。" : "下架后不能创建新订单，已创建订单和历史到账记录不受影响。",
            okText: enabled ? "确认发布" : "确认下架",
            cancelText: "取消",
            onOk: async () => {
                setUpdatingPlanId(plan.id);
                try {
                    const saved = await updateAdminPaymentPlan(plan.id, {
                        name: plan.name,
                        credits: plan.credits,
                        priceCents: plan.priceCents,
                        enabled,
                    });
                    setPlans((current) => current.map((item) => (item.id === saved.id ? saved : item)));
                    message.success(enabled ? "套餐已发布" : "套餐已下架");
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "套餐状态更新失败");
                } finally {
                    setUpdatingPlanId(undefined);
                }
            },
        });
    };
    const paid = items.filter((item) => item.status === "paid");
    const paidCents = paid.reduce((total, item) => total + item.amountCents, 0);
    const changePublicRecharge = async (enabled: boolean) => {
        setSavingAccess(true);
        try {
            const next = await setAdminPaymentSettings(enabled);
            setSettings(next);
            message.success(enabled ? "普通用户充值已开放" : "普通用户充值已关闭");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "充值权限更新失败");
        } finally {
            setSavingAccess(false);
        }
    };
    return (
        <div className="space-y-5">
            <Panel
                title="普通用户充值"
                note="关闭后普通用户不能创建新订单；已有订单、到账回调和管理员验收不受影响"
                actions={
                    <div className="flex items-center gap-3">
                        <Tag bordered={false} color={settings?.publicRechargeEnabled ? "green" : "default"}>
                            {settings?.publicRechargeEnabled ? "已开放" : "已关闭"}
                        </Tag>
                        <Switch checked={Boolean(settings?.publicRechargeEnabled)} loading={savingAccess} disabled={!settings} onChange={(enabled) => void changePublicRecharge(enabled)} />
                    </div>
                }
            >
                <p className="text-xs text-stone-500">权限变更立即生效并写入管理员审计日志，无需重启服务。</p>
            </Panel>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                <Metric label="充值订单" value={formatCount(items.length)} note="最近 200 笔" />
                <Metric label="成功到账" value={formatCount(paid.length)} note={`人民币 ${formatPaymentAmount(paidCents)}`} />
                <Metric label="待确认" value={formatCount(items.filter((item) => item.status === "pending").length)} note="可手动向支付宝查单" />
                <Metric label="用户持有积分" value={formatPoints(settings?.totalUserCredits || "0")} note="仅累计正余额" />
                <Metric label="建议供应商准备金" value={`¥${formatDecimal(settings?.providerReserveCny || "0", 2)}`} note="原价口径：用户正积分总额 ÷ 120" />
            </div>
            <Panel
                title="充值套餐"
                note="调价仅影响新订单；历史订单保留创建时的金额与积分快照"
                actions={
                    <Button type="primary" onClick={() => openPlanEditor()}>
                        新建套餐
                    </Button>
                }
            >
                <Table<BillingPlan>
                    rowKey="id"
                    loading={loading}
                    dataSource={plans}
                    pagination={false}
                    columns={[
                        {
                            title: "套餐",
                            dataIndex: "name",
                            render: (value, plan) => (
                                <div>
                                    <b>{value}</b>
                                    <p className="mt-1 font-mono text-[11px] text-stone-500">{plan.id}</p>
                                </div>
                            ),
                        },
                        { title: "售价", dataIndex: "priceCents", render: (value) => <b className="font-mono">¥{formatPaymentAmount(value)}</b> },
                        { title: "到账积分", dataIndex: "credits", render: formatPoints },
                        {
                            title: "状态",
                            dataIndex: "enabled",
                            render: (value) => (
                                <Tag bordered={false} color={value ? "green" : "default"}>
                                    {value ? "已发布" : "草稿 / 已下架"}
                                </Tag>
                            ),
                        },
                        { title: "更新时间", dataIndex: "updatedAt", render: formatDate },
                        {
                            title: "操作",
                            render: (_, plan) => (
                                <Space>
                                    <Button size="small" onClick={() => openPlanEditor(plan)}>
                                        调价
                                    </Button>
                                    <Button size="small" loading={updatingPlanId === plan.id} danger={plan.enabled} type={plan.enabled ? "default" : "primary"} onClick={() => setPlanPublished(plan, !plan.enabled)}>
                                        {plan.enabled ? "下架" : "发布"}
                                    </Button>
                                </Space>
                            ),
                        },
                    ]}
                />
            </Panel>
            <Panel title="支付宝充值订单" note="异步通知和主动查单共用同一幂等入账链路">
                <Table<PaymentOrder>
                    rowKey="id"
                    loading={loading}
                    dataSource={items}
                    pagination={{ pageSize: 20, hideOnSinglePage: true }}
                    columns={[
                        { title: "创建时间", dataIndex: "createdAt", render: formatDate },
                        { title: "用户", dataIndex: "userEmail", ellipsis: true },
                        { title: "订单号", dataIndex: "id", render: copyable },
                        { title: "金额", dataIndex: "amountCents", render: (value) => <b className="font-mono">¥{formatPaymentAmount(value)}</b> },
                        { title: "积分", dataIndex: "credits", render: formatPoints },
                        { title: "状态", dataIndex: "status", render: (_, order) => <PaymentStatusTag order={order} /> },
                        { title: "到账时间", dataIndex: "paidAt", render: formatDate },
                        { title: "异常", dataIndex: "failureMessage", ellipsis: true, render: (value) => value || "—" },
                        {
                            title: "操作",
                            render: (_, item) =>
                                item.status === "pending" ? (
                                    <Button size="small" loading={syncingId === item.id} onClick={() => void sync(item.id)}>
                                        同步
                                    </Button>
                                ) : (
                                    "—"
                                ),
                        },
                    ]}
                />
            </Panel>
            <Modal
                open={planEditorOpen}
                title={editingPlan ? "调整充值套餐" : "新建充值套餐"}
                okText={editingPlan ? "保存调整" : "保存草稿"}
                cancelText="取消"
                confirmLoading={savingPlan}
                onOk={() => void savePlan()}
                onCancel={() => !savingPlan && setPlanEditorOpen(false)}
                destroyOnHidden
            >
                <div className="space-y-4 py-3">
                    <label className="block">
                        <span className="mb-1.5 block text-sm text-stone-500">套餐名称</span>
                        <Input maxLength={60} value={planDraft.name} placeholder="例如：1000 积分套餐" onChange={(event) => setPlanDraft((current) => ({ ...current, name: event.target.value }))} />
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                        <label className="block">
                            <span className="mb-1.5 block text-sm text-stone-500">售价</span>
                            <Input value={planDraft.priceYuan} prefix="¥" suffix="人民币" placeholder="9.90" onChange={(event) => setPlanDraft((current) => ({ ...current, priceYuan: event.target.value.trim() }))} />
                        </label>
                        <label className="block">
                            <span className="mb-1.5 block text-sm text-stone-500">到账积分</span>
                            <InputNumber className="w-full" min={1} max={1_000_000_000} precision={0} value={planDraft.credits} onChange={(value) => setPlanDraft((current) => ({ ...current, credits: value || 0 }))} />
                        </label>
                    </div>
                    <p className="rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                        {editingPlan?.enabled ? "该套餐已发布，保存后新订单立即使用新价格。" : "保存后仍是草稿，需要在列表中点击“发布”才会对用户显示。"}
                    </p>
                </div>
            </Modal>
        </div>
    );
}

function PaymentStatusTag({ order }: { order: PaymentOrder }) {
    const value = order.status;
    const labels = { pending: "待支付", paid: "已到账", closed: "已关闭" } as const;
    const label = value === "closed" && order.failureCode === "PAYMENT_EXPIRED" ? "未支付已过期" : labels[value];
    return (
        <Tag bordered={false} color={value === "paid" ? "green" : value === "pending" ? "gold" : "default"}>
            {label}
        </Tag>
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
                    { title: "操作 IP", dataIndex: "actorIp", render: (value) => value || "—" },
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

function FeedbackPanel() {
    const [items, setItems] = useState<UserFeedback[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [q, setQ] = useState("");
    const [category, setCategory] = useState("");
    const [status, setStatus] = useState("");
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState<UserFeedback>();
    const [reply, setReply] = useState("");
    const [saving, setSaving] = useState(false);
    const load = useCallback(
        (signal?: AbortSignal) => {
            const controller = new AbortController();
            setLoading(true);
            getAdminFeedback({ page, pageSize: 20, q, category, status }, signal || controller.signal)
                .then((data) => {
                    setItems(data.items);
                    setTotal(data.total);
                    setSelected((current) => (current ? data.items.find((item) => item.id === current.id) : undefined));
                })
                .catch((error) => {
                    if (error instanceof DOMException && error.name === "AbortError") return;
                    message.error(error.message);
                })
                .finally(() => setLoading(false));
            return controller;
        },
        [category, page, q, status],
    );
    useEffect(() => {
        const controller = load();
        return () => controller.abort();
    }, [load]);
    const submitReply = async () => {
        if (!selected || !reply.trim()) return;
        setSaving(true);
        try {
            const result = await replyAdminFeedback(selected.id, reply.trim());
            message.success("回复已保存，用户将在站内看到未读提醒");
            setReply("");
            load();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "回复失败");
        } finally {
            setSaving(false);
        }
    };
    const changeStatus = async (value: UserFeedback["status"]) => {
        if (!selected) return;
        setSaving(true);
        try {
            await setAdminFeedbackStatus(selected.id, value);
            message.success("工单状态已更新");
            load();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "状态更新失败");
        } finally {
            setSaving(false);
        }
    };
    return (
        <Panel
            title="用户反馈"
            note="用户从工作台提交的问题和建议；回复保存在站内，并向用户注册邮箱发送提醒"
            actions={
                <Space>
                    <Select
                        className="w-32"
                        value={category}
                        options={[
                            { value: "", label: "全部类型" },
                            { value: "problem", label: "问题" },
                            { value: "suggestion", label: "建议" },
                        ]}
                        onChange={(value) => {
                            setPage(1);
                            setCategory(value);
                        }}
                    />
                    <Select
                        className="w-32"
                        value={status}
                        options={[
                            { value: "", label: "全部状态" },
                            { value: "open", label: "待处理" },
                            { value: "replied", label: "已回复" },
                            { value: "closed", label: "已关闭" },
                        ]}
                        onChange={(value) => {
                            setPage(1);
                            setStatus(value);
                        }}
                    />
                    <Input.Search
                        allowClear
                        placeholder="账号 / 内容 / 联系方式"
                        onSearch={(value) => {
                            setPage(1);
                            setQ(value);
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
                    { title: "时间", dataIndex: "createdAt", width: 170, render: formatDate },
                    { title: "类型", dataIndex: "category", width: 90, render: (value) => <Tag color={value === "problem" ? "red" : "blue"}>{value === "problem" ? "问题" : "建议"}</Tag> },
                    { title: "状态", dataIndex: "status", width: 100, render: renderFeedbackStatus },
                    { title: "账号", dataIndex: "userEmail", width: 220 },
                    {
                        title: "内容",
                        dataIndex: "content",
                        render: (value) => <span className="block min-w-64 whitespace-pre-wrap break-words">{value}</span>,
                    },
                    { title: "联系方式", dataIndex: "contact", width: 180, render: (value) => value || "—" },
                    { title: "提交页面", dataIndex: "pagePath", width: 180, render: (value) => value || "—" },
                    {
                        title: "操作",
                        width: 90,
                        fixed: "right",
                        render: (_, record) => (
                            <Button type="link" onClick={() => setSelected(record)}>
                                查看 / 回复
                            </Button>
                        ),
                    },
                ]}
            />
            <Modal
                open={Boolean(selected)}
                title="反馈工单"
                width={680}
                footer={null}
                onCancel={() => {
                    setSelected(undefined);
                    setReply("");
                }}
            >
                {selected ? (
                    <div className="space-y-4">
                        <div className="flex flex-wrap items-center gap-2">
                            <Tag color={selected.category === "problem" ? "red" : "blue"}>{selected.category === "problem" ? "问题" : "建议"}</Tag>
                            {renderFeedbackStatus(selected.status)}
                            <span className="text-sm text-stone-500">{selected.userEmail}</span>
                        </div>
                        <div className="rounded-xl border border-stone-200 p-4 dark:border-white/10">
                            <p className="whitespace-pre-wrap break-words text-sm">{selected.content}</p>
                            <p className="mt-3 text-xs text-stone-500">
                                提交于 {formatDate(selected.createdAt)}
                                {selected.contact ? ` · 联系方式：${selected.contact}` : ""}
                            </p>
                        </div>
                        {selected.replies.map((item) => (
                            <div key={item.id} className="rounded-xl bg-stone-100 p-4 dark:bg-white/[0.06]">
                                <p className="text-xs text-stone-500">管理员回复 · {formatDate(item.createdAt)}</p>
                                <p className="mt-2 whitespace-pre-wrap break-words text-sm">{item.content}</p>
                            </div>
                        ))}
                        <Input.TextArea rows={5} maxLength={2000} showCount value={reply} placeholder="输入给用户的回复" onChange={(event) => setReply(event.target.value)} />
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <Select
                                className="w-36"
                                value={selected.status}
                                disabled={saving}
                                options={[
                                    { value: "open", label: "待处理" },
                                    { value: "replied", label: "已回复" },
                                    { value: "closed", label: "已关闭" },
                                ]}
                                onChange={(value) => void changeStatus(value)}
                            />
                            <Button type="primary" loading={saving} disabled={!reply.trim()} onClick={() => void submitReply()}>
                                发送回复
                            </Button>
                        </div>
                    </div>
                ) : null}
            </Modal>
        </Panel>
    );
}

function renderFeedbackStatus(status: UserFeedback["status"]) {
    const values = {
        open: { color: "gold", label: "待处理" },
        replied: { color: "green", label: "已回复" },
        closed: { color: "default", label: "已关闭" },
    } as const;
    const value = values[status];
    return <Tag color={value.color}>{value.label}</Tag>;
}

function Panel({ title, note, actions, children }: { title: string; note?: string; actions?: React.ReactNode; children: React.ReactNode }) {
    return (
        <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm shadow-stone-200/40 dark:border-white/10 dark:bg-stone-950 dark:shadow-none">
            <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 className="font-semibold">{title}</h2>
                    {note ? <p className="mt-0.5 text-xs text-stone-600 dark:text-stone-400">{note}</p> : null}
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
            <p className="text-xs font-medium text-stone-600 dark:text-stone-400">{label}</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight">{value}</p>
            {note ? <p className="mt-2 text-xs text-stone-600 dark:text-stone-400">{note}</p> : null}
        </div>
    );
}
function OperationalSignal({ label, value, note, tone = "normal", interactive = false }: { label: string; value: string; note: string; tone?: "normal" | "warning" | "danger"; interactive?: boolean }) {
    const toneClass =
        tone === "danger"
            ? "border-red-500/30 bg-red-500/[0.06] text-red-500"
            : tone === "warning"
              ? "border-amber-500/30 bg-amber-500/[0.06] text-amber-500"
              : "border-stone-200 bg-stone-50 text-stone-950 dark:border-white/10 dark:bg-white/[0.025] dark:text-stone-100";
    return (
        <div className={`rounded-xl border p-4 ${interactive ? "transition hover:-translate-y-0.5 hover:shadow-md" : ""} ${toneClass}`}>
            <p className="text-xs opacity-75">{label}</p>
            <p className="mt-2 font-mono text-2xl font-semibold tracking-tight">{value}</p>
            <p className="mt-2 text-[11px] opacity-70">{note}</p>
        </div>
    );
}
function formatCount(value: number) {
    return new Intl.NumberFormat("zh-CN").format(value || 0);
}
function formatPaymentAmount(cents: number) {
    return (Number(cents || 0) / 100).toFixed(2);
}
function formatDecimal(value: string, places: number) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toFixed(places) : "0.00";
}
function parseYuanToCents(value: string) {
    const normalized = value.trim();
    if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(normalized)) return 0;
    const [yuan, fraction = ""] = normalized.split(".");
    const cents = Number(yuan) * 100 + Number(fraction.padEnd(2, "0"));
    return cents <= 100_000_000 ? cents : 0;
}
function formatPercent(value: number) {
    return `${Math.max(0, value * 100).toFixed(1)}%`;
}
function formatDuration(value: number) {
    if (!value) return "—";
    if (value < 60) return `${Math.round(value)} 秒`;
    return `${(value / 60).toFixed(value < 600 ? 1 : 0)} 分钟`;
}
function formatJobDuration(createdAt: string, finishedAt?: string) {
    if (!finishedAt) return "—";
    return formatDuration(Math.max(0, dayjs(finishedAt).diff(dayjs(createdAt), "second", true)));
}
function providerLabel(value?: string) {
    if (value === "volcengine_ark") return "火山方舟";
    if (value === "runninghub_global") return "海马云 · 国际区";
    if (value === "runninghub") return "海马云 · 中国区";
    return value === "token360" ? "Token360" : value || "—";
}
function jobStatusLabel(value: string) {
    const labels: Record<string, string> = {
        pending: "等待处理",
        queued: "排队中",
        running: "生成中",
        completed: "已完成",
        failed: "生成失败",
        cancelled: "已取消",
        billing_pending: "等待计费",
        payment_required: "待补足积分",
    };
    return labels[value] || value;
}
function billingStatusLabel(value: string) {
    const labels: Record<string, string> = {
        pending: "待对账",
        reconciling: "对账中",
        settled: "已对账",
        mismatch: "待人工核验",
        not_billed: "未出账",
        failed: "对账失败",
        unavailable: "不可对账",
    };
    return labels[value] || value;
}
function statusLabel(value: string) {
    const labels: Record<string, string> = {
        active: "正常",
        disabled: "已停用",
        healthy: "正常",
        unhealthy: "异常",
        success: "成功",
        open: "待处理",
        replied: "已回复",
        closed: "已关闭",
    };
    return labels[value] || value;
}
function capabilityLabel(value?: string) {
    const labels: Record<string, string> = {
        text: "文本",
        image: "图片",
        video: "视频",
        audio: "音频",
        music: "音乐",
        tts: "语音合成",
    };
    return value ? labels[value] || value : "—";
}
function StatusTag({ value, kind = "general" }: { value: string; kind?: "general" | "job" | "billing" }) {
    const good = ["active", "completed", "settled", "healthy", "success"].includes(value);
    const pending = ["pending", "running", "queued", "reconciling", "mismatch"].includes(value);
    const label = kind === "job" ? jobStatusLabel(value) : kind === "billing" ? billingStatusLabel(value) : statusLabel(value);
    return (
        <Tag bordered={false} color={good ? "green" : pending ? "gold" : "red"}>
            {label}
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
function formatOverviewRangeLabel(from: string, to: string) {
    if (from === to) return dayjs(from).format("M月D日");
    if (dayjs(from).year() === dayjs(to).year()) return `${dayjs(from).format("M月D日")}–${dayjs(to).format("M月D日")}`;
    return `${dayjs(from).format("YYYY年M月D日")}–${dayjs(to).format("YYYY年M月D日")}`;
}
function formatPoints(value: string | number) {
    return new Intl.NumberFormat("zh-CN").format(BigInt(String(value || 0)));
}
function creditStatusLabel(value?: string) {
    const labels: Record<string, string> = {
        pending: "待计费",
        pending_rate: "待设置汇率",
        pending_currency: "待确认币种",
        payment_required: "待支付",
        unsupported_currency: "币种不支持",
        unavailable: "无实际金额",
        free: "0 分",
    };
    return labels[value || ""] || "—";
}
function formatBytes(value: number) {
    if (!value) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
    return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}
function isAmountMissing(amount?: string) {
    return amount === undefined || amount === null || amount === "";
}
function formatUsageAmount(currency?: string, amount?: string) {
    if (isAmountMissing(amount)) return "金额未返回";
    return !currency || currency === "UNKNOWN" ? `币种未确认 ${amount}` : `${currency === "CNY" ? "人民币" : currency} ${amount}`;
}
function usageAmountLabel(currency?: string, amount?: string, compact = false) {
    if (isAmountMissing(amount)) return compact ? "待计费" : "待计费金额";
    if (!currency || currency === "UNKNOWN") return compact ? "币种未确认" : "币种未确认的原始费用";
    const label = currency === "CNY" ? "人民币" : currency;
    return compact ? label : `${label}原始费用`;
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
            {compactId(value)}
        </button>
    );
}
function compactId(value: string) {
    return value.length > 20 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}
