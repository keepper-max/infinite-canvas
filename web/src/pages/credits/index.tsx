import { App, Button, Empty, Input, Spin, Table, Tag } from "antd";
import { CalendarClock, Coins, RefreshCw, ReceiptText } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { getCreditAccount, redeemActivationCode, type CreditAccount, type CreditLedgerItem } from "@/services/api/operations";

const sourceNames: Record<string, string> = {
    purchase: "购买",
    promotion: "活动赠送",
    compensation: "人工补偿",
    activation: "激活码",
};

const ledgerNames: Record<string, string> = {
    grant: "积分到账",
    generation: "生成消费",
    expiry: "积分到期",
    reversal: "消费冲正",
};

export default function CreditsPage() {
    const { message } = App.useApp();
    const [data, setData] = useState<CreditAccount>();
    const [loading, setLoading] = useState(true);
    const [code, setCode] = useState("");
    const [redeeming, setRedeeming] = useState(false);
    const load = useCallback(async () => {
        setLoading(true);
        try {
            setData(await getCreditAccount());
        } catch (error) {
            message.error(error instanceof Error ? error.message : "积分信息加载失败");
        } finally {
            setLoading(false);
        }
    }, [message]);
    useEffect(() => void load(), [load]);
    const redeem = async () => {
        setRedeeming(true);
        try {
            const result = await redeemActivationCode(code.trim());
            setCode("");
            message.success(`已到账 ${formatPoints(result.credits)} 积分`);
            await load();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "激活码兑换失败");
        } finally {
            setRedeeming(false);
        }
    };
    if (loading && !data)
        return (
            <div className="grid h-full place-items-center">
                <Spin />
            </div>
        );
    if (!data) return null;
    const balance = BigInt(data.account.balance);
    return (
        <main className="h-full overflow-y-auto bg-[radial-gradient(circle_at_top_left,rgba(180,83,9,0.08),transparent_32%)] px-5 py-8 sm:px-8">
            <div className="mx-auto max-w-6xl space-y-6">
                <header className="flex flex-wrap items-end justify-between gap-4">
                    <div>
                        <p className="font-mono text-xs uppercase tracking-[0.22em] text-amber-700 dark:text-amber-400">Credit ledger</p>
                        <h1 className="mt-2 text-3xl font-semibold tracking-tight">积分账户</h1>
                        <p className="mt-2 text-sm text-stone-500">查看可用积分、待计费任务和积分流水。</p>
                    </div>
                    <Button type="text" icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void load()}>
                        刷新
                    </Button>
                </header>

                <section className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
                    <div className="relative overflow-hidden rounded-3xl bg-stone-950 p-7 text-white shadow-2xl shadow-stone-950/10">
                        <div className="absolute -right-14 -top-16 size-44 rounded-full border border-amber-300/20" />
                        <Coins className="size-5 text-amber-300" />
                        <p className="mt-8 text-sm text-stone-400">当前可用积分</p>
                        <p className={`mt-1 font-mono text-5xl font-semibold tracking-tight ${balance < BigInt(0) ? "text-red-400" : "text-white"}`}>{formatPoints(data.account.balance)}</p>
                        {balance < BigInt(0) ? <p className="mt-3 text-sm text-red-300">余额不足，补足积分后可继续提交托管生成任务。</p> : null}
                    </div>
                    <Metric icon={<ReceiptText className="size-4" />} label="待计费任务" value={String(data.pendingCharges)} note="完成结算后，积分流水会自动更新" />
                </section>

                <section className="rounded-3xl border border-stone-200/80 bg-white/70 p-5 dark:border-white/10 dark:bg-white/[0.03]">
                    <h2 className="font-semibold">兑换积分激活码</h2>
                    <p className="mt-1 text-xs text-stone-500">激活码积分与其他到账积分进入同一余额。支付宝充值尚未开放。</p>
                    <div className="mt-4 flex max-w-xl flex-wrap gap-2">
                        <Input value={code} onChange={(event) => setCode(event.target.value)} placeholder="JJ-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX" className="min-w-60 flex-1 font-mono" autoComplete="off" />
                        <Button type="primary" loading={redeeming} disabled={!code.trim()} onClick={() => void redeem()}>兑换</Button>
                    </div>
                </section>

                <section className="rounded-3xl border border-stone-200/80 bg-white/70 p-5 backdrop-blur dark:border-white/10 dark:bg-white/[0.03]">
                    <div className="mb-4 flex items-center gap-2">
                        <CalendarClock className="size-4 text-amber-700 dark:text-amber-400" />
                        <h2 className="font-semibold">积分批次</h2>
                    </div>
                    {data.lots.length ? (
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            {data.lots.map((lot) => (
                                <div key={lot.id} className="rounded-2xl border border-stone-200 p-4 dark:border-white/10">
                                    <div className="flex items-center justify-between">
                                        <Tag bordered={false}>{sourceNames[lot.source] || lot.source}</Tag>
                                        <span className="font-mono text-xs text-stone-500">剩余 {formatPoints(lot.remaining)}</span>
                                    </div>
                                    <p className="mt-4 font-mono text-xl">{formatPoints(lot.credits)} 积分</p>
                                    <p className="mt-1 text-xs text-stone-500">{lot.expiresAt ? `${formatDate(lot.expiresAt)} 到期` : "长期有效"}</p>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无积分批次" />
                    )}
                </section>

                <section className="rounded-3xl border border-stone-200/80 bg-white/70 p-5 backdrop-blur dark:border-white/10 dark:bg-white/[0.03]">
                    <h2 className="mb-4 font-semibold">积分流水</h2>
                    <Table<CreditLedgerItem>
                        rowKey="id"
                        size="middle"
                        dataSource={data.ledger}
                        pagination={{ pageSize: 20, hideOnSinglePage: true }}
                        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无积分流水" /> }}
                        columns={[
                            { title: "时间", dataIndex: "createdAt", render: formatDateTime },
                            { title: "类型", dataIndex: "type", render: (value) => ledgerNames[value] || value },
                            {
                                title: "积分",
                                dataIndex: "delta",
                                align: "right",
                                render: (value) => (
                                    <span className={`font-mono ${BigInt(value) < BigInt(0) ? "text-red-600" : "text-emerald-600"}`}>
                                        {BigInt(value) > BigInt(0) ? "+" : ""}
                                        {formatPoints(value)}
                                    </span>
                                ),
                            },
                            { title: "余额", dataIndex: "balanceAfter", align: "right", render: (value) => <span className="font-mono">{formatPoints(value)}</span> },
                            {
                                title: "关联任务",
                                dataIndex: "referenceId",
                                ellipsis: true,
                                render: (value) =>
                                    value ? (
                                        <span className="font-mono text-xs" title={value}>
                                            {shortId(value)}
                                        </span>
                                    ) : (
                                        "—"
                                    ),
                            },
                        ]}
                    />
                </section>
            </div>
        </main>
    );
}

function Metric({ icon, label, value, note }: { icon: ReactNode; label: string; value: string; note: string }) {
    return (
        <div className="rounded-3xl border border-stone-200/80 bg-white/70 p-6 backdrop-blur dark:border-white/10 dark:bg-white/[0.03]">
            <span className="grid size-8 place-items-center rounded-full bg-amber-100 text-amber-800 dark:bg-amber-400/10 dark:text-amber-300">{icon}</span>
            <p className="mt-7 text-sm text-stone-500">{label}</p>
            <p className="mt-1 font-mono text-2xl font-semibold">{value}</p>
            <p className="mt-2 text-xs leading-5 text-stone-500">{note}</p>
        </div>
    );
}

function formatPoints(value: string) {
    return new Intl.NumberFormat("zh-CN").format(BigInt(value));
}
function formatDate(value: string) {
    return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}
function formatDateTime(value: string) {
    return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
function shortId(value: string) {
    return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}
