import { App, Button, Checkbox, Empty, Input, Modal, Spin, Table, Tag } from "antd";
import { CalendarClock, Coins, CreditCard, RefreshCw, ReceiptText } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { useAuth } from "@/components/auth/auth-context";
import { randomUuid } from "@/lib/utils";
import {
    createPaymentOrder,
    getBillingPlans,
    getCreditAccount,
    getOperationsCapabilities,
    getPaymentOrders,
    redeemActivationCode,
    syncPaymentOrder,
    type BillingPlan,
    type CreditAccount,
    type CreditLedgerItem,
    type OperationsCapabilities,
    type PaymentOrder,
} from "@/services/api/operations";

const sourceNames: Record<string, string> = { purchase: "购买", promotion: "活动赠送", compensation: "人工补偿", activation: "激活码" };
const ledgerNames: Record<string, string> = { grant: "积分到账", generation: "生成消费", expiry: "积分到期", reversal: "消费冲正" };
const orderStatus: Record<PaymentOrder["status"], { label: string; color: string }> = {
    pending: { label: "待支付", color: "gold" },
    paid: { label: "已到账", color: "green" },
    closed: { label: "已关闭", color: "default" },
};

export default function CreditsPage() {
    const { message } = App.useApp();
    const { user } = useAuth();
    const acceptanceMode = user.isAdmin && new URLSearchParams(window.location.search).get("paymentTest") === "1";
    const [data, setData] = useState<CreditAccount>();
    const [capabilities, setCapabilities] = useState<OperationsCapabilities>();
    const [plans, setPlans] = useState<BillingPlan[]>([]);
    const [orders, setOrders] = useState<PaymentOrder[]>([]);
    const [loading, setLoading] = useState(true);
    const [code, setCode] = useState("");
    const [redeeming, setRedeeming] = useState(false);
    const [acceptedAgreement, setAcceptedAgreement] = useState(false);
    const [agreementOpen, setAgreementOpen] = useState(false);
    const [payingPlan, setPayingPlan] = useState<string>();
    const syncedReturnOrder = useRef(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [account, nextCapabilities, nextPlans, nextOrders] = await Promise.all([
                getCreditAccount(), getOperationsCapabilities(), getBillingPlans(), getPaymentOrders(),
            ]);
            setData(account);
            setCapabilities(nextCapabilities);
            setPlans(nextPlans.filter((plan) => {
                if (!plan.enabled || plan.currency !== "CNY" || plan.metadata.paymentProvider !== "alipay") return false;
                return acceptanceMode ? plan.metadata.experimental === true : plan.metadata.experimental !== true;
            }));
            setOrders(nextOrders);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "积分信息加载失败");
        } finally {
            setLoading(false);
        }
    }, [acceptanceMode, message]);

    useEffect(() => void load(), [load]);
    useEffect(() => {
        const orderId = new URLSearchParams(window.location.search).get("order");
        if (!orderId || syncedReturnOrder.current) return;
        syncedReturnOrder.current = true;
        syncPaymentOrder(orderId)
            .then(async (order) => {
                message[order.status === "paid" ? "success" : "info"](order.status === "paid" ? "支付成功，积分已到账" : "支付结果仍在确认，请稍后刷新");
                window.history.replaceState({}, "", window.location.pathname);
                await load();
            })
            .catch((error) => message.error(error instanceof Error ? error.message : "支付结果确认失败"));
    }, [load, message]);

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

    const purchase = async (plan: BillingPlan) => {
        if (!acceptedAgreement) {
            message.warning("请先阅读并同意积分充值与使用协议");
            return;
        }
        setPayingPlan(plan.id);
        try {
            const result = await createPaymentOrder(plan.id, randomUuid());
            if (!result.paymentUrl) {
                message.info(result.order.status === "paid" ? "该订单已到账" : "订单状态已更新");
                await load();
                return;
            }
            const destination = new URL(result.paymentUrl);
            if (destination.protocol !== "https:" || destination.hostname !== "openapi.alipay.com") throw new Error("支付地址校验失败");
            window.location.assign(destination.toString());
        } catch (error) {
            message.error(error instanceof Error ? error.message : "创建支付订单失败");
            setPayingPlan(undefined);
        }
    };

    if (loading && !data) return <div className="grid h-full place-items-center"><Spin /></div>;
    if (!data) return null;
    const balance = BigInt(data.account.balance);
    const paymentsEnabled = Boolean(capabilities?.payments);
    return (
        <main className="h-full overflow-y-auto bg-[radial-gradient(circle_at_top_left,rgba(180,83,9,0.08),transparent_32%)] px-5 py-8 sm:px-8">
            <div className="mx-auto max-w-6xl space-y-6">
                <header className="flex flex-wrap items-end justify-between gap-4">
                    <div>
                        <p className="font-mono text-xs uppercase tracking-[0.22em] text-amber-700 dark:text-amber-400">Credit ledger</p>
                        <h1 className="mt-2 text-3xl font-semibold tracking-tight">积分账户</h1>
                        <p className="mt-2 text-sm text-stone-500">查看余额、充值积分和账户流水。</p>
                    </div>
                    <Button type="text" icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void load()}>刷新</Button>
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

                <section className="overflow-hidden rounded-3xl border border-stone-200/80 bg-white/80 backdrop-blur dark:border-white/10 dark:bg-white/[0.03]">
                    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-stone-200/80 p-5 dark:border-white/10">
                        <div className="flex items-center gap-3">
                            <img src="/alipay-logo-official.png" alt="支付宝" className="size-10 rounded-xl" />
                            <div><h2 className="font-semibold">{acceptanceMode ? "支付宝验收订单" : "支付宝充值"}</h2><p className="mt-0.5 text-xs text-stone-500">{acceptanceMode ? "仅超级管理员可使用的 0.01 元真实支付验收。" : "按所选订单套餐充值，订单 10 分钟内有效，积分到账后有效 12 个月。"}</p></div>
                        </div>
                        {paymentsEnabled ? <Tag color="blue">安全支付</Tag> : <Tag>暂未开放</Tag>}
                    </div>
                    {paymentsEnabled ? (
                        <div className="p-5">
                            <div className="grid gap-3 sm:grid-cols-2">
                                {plans.map((plan, index) => (
                                    <button key={plan.id} type="button" disabled={Boolean(payingPlan)} onClick={() => void purchase(plan)} className="group relative rounded-2xl border border-stone-200 bg-stone-50 p-5 text-left transition hover:-translate-y-0.5 hover:border-[#1677ff] hover:shadow-lg hover:shadow-blue-500/10 disabled:cursor-wait disabled:opacity-60 dark:border-white/10 dark:bg-white/[0.025]">
                                        {!acceptanceMode && index === 1 ? <img src="/alipay-recommended-official.png" alt="推荐" className="absolute right-3 top-3 h-6 w-auto" /> : null}
                                        <p className="text-xs text-stone-500">{plan.name}</p>
                                        <p className="mt-4 font-mono text-3xl font-semibold">¥{formatCny(plan.priceCents)}</p>
                                        <p className="mt-2 text-sm text-stone-500">{formatPoints(String(plan.credits))} 积分</p>
                                        <span className="mt-5 inline-flex items-center gap-1.5 text-xs font-medium text-[#1677ff]"><CreditCard className="size-3.5" />{payingPlan === plan.id ? "正在前往收银台" : "选择并支付"}</span>
                                    </button>
                                ))}
                            </div>
                            <div className="mt-4 flex items-start gap-2 text-xs text-stone-500">
                                <Checkbox checked={acceptedAgreement} onChange={(event) => setAcceptedAgreement(event.target.checked)} />
                                <span>我已阅读并同意<button type="button" className="mx-1 text-[#1677ff] hover:underline" onClick={() => setAgreementOpen(true)}>《积分充值与使用协议》</button>，付款将在支付宝官方收银台完成。</span>
                            </div>
                        </div>
                    ) : <div className="p-5 text-sm text-stone-500">充值功能正在进行上线验收，当前仍可使用积分激活码。</div>}
                </section>

                <section className="rounded-3xl border border-stone-200/80 bg-white/70 p-5 dark:border-white/10 dark:bg-white/[0.03]">
                    <h2 className="font-semibold">兑换积分激活码</h2>
                    <p className="mt-1 text-xs text-stone-500">激活码积分与充值积分进入同一余额。</p>
                    <div className="mt-4 flex max-w-xl flex-wrap gap-2">
                        <Input value={code} onChange={(event) => setCode(event.target.value)} placeholder="JJ-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX" className="min-w-60 flex-1 font-mono" autoComplete="off" />
                        <Button type="primary" loading={redeeming} disabled={!code.trim()} onClick={() => void redeem()}>兑换</Button>
                    </div>
                </section>

                {orders.length ? <PaymentOrders orders={orders} /> : null}
                <CreditLots data={data} />
                <CreditLedger data={data} />
            </div>

            <Modal open={agreementOpen} onCancel={() => setAgreementOpen(false)} footer={<Button type="primary" onClick={() => { setAcceptedAgreement(true); setAgreementOpen(false); }}>同意并关闭</Button>} title="积分充值与使用协议（简明版）" width={680}>
                <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-2 text-sm leading-7 text-stone-600 dark:text-stone-300">
                    <AgreementSection title="一、适用与生效">本协议由守密人（大连）科技有限公司向守守画布用户提供，适用于积分充值与使用。请在充值前阅读；您勾选同意并完成充值后，本协议生效。</AgreementSection>
                    <AgreementSection title="二、充值与使用">积分数量及订单金额以您下单时所选套餐为准。积分仅用于本平台服务，不是现金，不可转让或提现；依法应退款的情形不受此限制。服务消耗以相关页面提示和账户流水为准。</AgreementSection>
                    <AgreementSection title="三、有效期与余额">购买积分自到账起有效 12 个月，赠送积分以活动说明为准，并优先使用较早到期的积分。余额不足时不能提交新的生成任务。</AgreementSection>
                    <AgreementSection title="四、退款与异常">未使用的付费积分可通过客服渠道申请退款；已实际使用部分按消费记录核算。重复扣分、计费错误或未按约提供服务的，经核实后依法退还相应积分或款项。退款原则上退回原支付渠道，赠送积分不折算现金。</AgreementSection>
                    <AgreementSection title="五、争议与联系">如对充值、扣分或退款有疑问，请联系微信 JPdai8888，并提交订单或任务编号。协议或价格规则调整将提前显著告知，原则上不影响调整前已提交的任务。</AgreementSection>
                </div>
            </Modal>
        </main>
    );
}

function PaymentOrders({ orders }: { orders: PaymentOrder[] }) {
    return (
        <section className="rounded-3xl border border-stone-200/80 bg-white/70 p-5 backdrop-blur dark:border-white/10 dark:bg-white/[0.03]">
            <h2 className="mb-4 font-semibold">充值记录</h2>
            <Table<PaymentOrder> rowKey="id" size="middle" dataSource={orders} pagination={{ pageSize: 10, hideOnSinglePage: true }} columns={[
                { title: "时间", dataIndex: "createdAt", render: formatDateTime },
                { title: "金额", dataIndex: "amountCents", render: (value) => `¥${formatCny(value)}` },
                { title: "积分", dataIndex: "credits", render: (value) => formatPoints(value) },
                { title: "状态", dataIndex: "status", render: (value: PaymentOrder["status"]) => <Tag color={orderStatus[value].color}>{orderStatus[value].label}</Tag> },
                { title: "订单号", dataIndex: "id", ellipsis: true, render: (value) => <span className="font-mono text-xs" title={value}>{shortId(value)}</span> },
            ]} />
        </section>
    );
}

function CreditLots({ data }: { data: CreditAccount }) {
    return (
        <section className="rounded-3xl border border-stone-200/80 bg-white/70 p-5 backdrop-blur dark:border-white/10 dark:bg-white/[0.03]">
            <div className="mb-4 flex items-center gap-2"><CalendarClock className="size-4 text-amber-700 dark:text-amber-400" /><h2 className="font-semibold">积分批次</h2></div>
            {data.lots.length ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{data.lots.map((lot) => (
                <div key={lot.id} className="rounded-2xl border border-stone-200 p-4 dark:border-white/10">
                    <div className="flex items-center justify-between"><Tag bordered={false}>{sourceNames[lot.source] || lot.source}</Tag><span className="font-mono text-xs text-stone-500">剩余 {formatPoints(lot.remaining)}</span></div>
                    <p className="mt-4 font-mono text-xl">{formatPoints(lot.credits)} 积分</p><p className="mt-1 text-xs text-stone-500">{lot.expiresAt ? `${formatDate(lot.expiresAt)} 到期` : "长期有效"}</p>
                </div>
            ))}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无积分批次" />}
        </section>
    );
}

function CreditLedger({ data }: { data: CreditAccount }) {
    return (
        <section className="rounded-3xl border border-stone-200/80 bg-white/70 p-5 backdrop-blur dark:border-white/10 dark:bg-white/[0.03]">
            <h2 className="mb-4 font-semibold">积分流水</h2>
            <Table<CreditLedgerItem> rowKey="id" size="middle" dataSource={data.ledger} pagination={{ pageSize: 20, hideOnSinglePage: true }} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无积分流水" /> }} columns={[
                { title: "时间", dataIndex: "createdAt", render: formatDateTime },
                { title: "类型", dataIndex: "type", render: (value) => ledgerNames[value] || value },
                { title: "积分", dataIndex: "delta", align: "right", render: (value) => <span className={`font-mono ${BigInt(value) < BigInt(0) ? "text-red-600" : "text-emerald-600"}`}>{BigInt(value) > BigInt(0) ? "+" : ""}{formatPoints(value)}</span> },
                { title: "余额", dataIndex: "balanceAfter", align: "right", render: (value) => <span className="font-mono">{formatPoints(value)}</span> },
                { title: "关联任务", dataIndex: "referenceId", ellipsis: true, render: (value) => value ? <span className="font-mono text-xs" title={value}>{shortId(value)}</span> : "—" },
            ]} />
        </section>
    );
}

function AgreementSection({ title, children }: { title: string; children: ReactNode }) {
    return <section><h3 className="font-semibold text-stone-950 dark:text-white">{title}</h3><p className="mt-1">{children}</p></section>;
}
function Metric({ icon, label, value, note }: { icon: ReactNode; label: string; value: string; note: string }) {
    return <div className="rounded-3xl border border-stone-200/80 bg-white/70 p-6 backdrop-blur dark:border-white/10 dark:bg-white/[0.03]"><span className="grid size-8 place-items-center rounded-full bg-amber-100 text-amber-800 dark:bg-amber-400/10 dark:text-amber-300">{icon}</span><p className="mt-7 text-sm text-stone-500">{label}</p><p className="mt-1 font-mono text-2xl font-semibold">{value}</p><p className="mt-2 text-xs leading-5 text-stone-500">{note}</p></div>;
}
function formatPoints(value: string) { return new Intl.NumberFormat("zh-CN").format(BigInt(value)); }
function formatCny(value: number) { return (value / 100).toFixed(2); }
function formatDate(value: string) { return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value)); }
function formatDateTime(value: string) { return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function shortId(value: string) { return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value; }
