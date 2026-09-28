import { App, Button, DatePicker, Drawer, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Tabs, Tag } from "antd";
import dayjs from "dayjs";
import { Copy, Download, Eye, Plus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
    createBatch,
    createCampaign,
    createChannel,
    createInvite,
    createInviteBatch,
    deleteAttribution,
    exportAttributionUsers,
    getAttributionDashboard,
    getAttributionDetail,
    getAttributionSettings,
    getAttributionUsers,
    getBatches,
    getCampaigns,
    getChannels,
    getInvites,
    setAttributionSettings,
    setAttributionStatus,
    updateBatch,
    updateCampaign,
    updateChannel,
    updateInvite,
    type AttributedUser,
    type AttributionDetail,
    type AttributionKind,
    type Batch,
    type Campaign,
    type Channel,
    type InviteCode,
} from "@/services/api/channel-attribution";

const channelTypes = [
    ["school", "高校"],
    ["enterprise", "企业"],
    ["agent", "代理商"],
    ["douyin", "抖音"],
    ["xiaohongshu", "小红书"],
    ["kol", "达人推广"],
    ["offline", "线下活动"],
    ["organic", "自然流量"],
    ["public", "社会公开"],
    ["legacy", "历史用户"],
    ["other", "其他"],
] as const;

export default function ChannelManagement() {
    const [tab, setTab] = useState("dashboard");
    return (
        <Tabs
            activeKey={tab}
            onChange={setTab}
            items={[
                { key: "dashboard", label: "渠道数据", children: <Dashboard /> },
                { key: "channels", label: "渠道列表", children: <Channels /> },
                { key: "invites", label: "邀请码管理", children: <Invites /> },
                { key: "campaigns", label: "项目 / 活动", children: <Campaigns /> },
                { key: "batches", label: "批次管理", children: <Batches /> },
            ]}
        />
    );
}

function Dashboard() {
    const { message } = App.useApp();
    const [data, setData] = useState<any>();
    const [mode, setMode] = useState<"required" | "optional" | "disabled">("optional");
    const load = useCallback(async () => {
        try {
            const [dashboard, settings] = await Promise.all([getAttributionDashboard(), getAttributionSettings()]);
            setData(dashboard);
            setMode(settings.inviteMode);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取渠道数据失败");
        }
    }, [message]);
    useEffect(() => {
        void load();
    }, [load]);
    const metrics = data?.metrics || {};
    return (
        <div className="space-y-5">
            <Panel
                title="注册设置"
                actions={
                    <Select
                        value={mode}
                        className="w-44"
                        options={[
                            { value: "required", label: "必须邀请码" },
                            { value: "optional", label: "邀请码可选" },
                            { value: "disabled", label: "不使用邀请码" },
                        ]}
                        onChange={async (value) => {
                            await setAttributionSettings(value);
                            setMode(value);
                            message.success("注册模式已更新");
                        }}
                    />
                }
            >
                <p className="text-sm text-stone-500">当前未接入人机验证；注册与邀请码失败均为 10 分钟最多 5 次，同 IP 每日最多成功注册 50 个账号。</p>
            </Panel>
            <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-5">
                <Metric label="注册用户" value={metrics.registered_users} />
                <Metric label="今日新增" value={metrics.today_users} />
                <Metric label="30日活跃" value={metrics.active_users} />
                <Metric label="付费用户" value={metrics.paid_users} />
                <Metric label="渠道数量" value={metrics.channels || 0} />
                <Metric label="邀请码注册" value={metrics.invite_users || 0} />
                <Metric label="自然注册" value={metrics.organic_users || 0} />
                <Metric label="累计充值" value={`¥${yuan(metrics.recharge_cents)}`} />
                <Metric label="累计消耗" value={`${metrics.consumed_points || 0} 积分`} />
                <Metric label="用户余额" value={`${metrics.current_balance || 0} 积分`} />
            </div>
            <Panel
                title="渠道排行"
                actions={
                    <Button icon={<RefreshCw className="size-4" />} onClick={() => void load()}>
                        刷新
                    </Button>
                }
            >
                <Tabs
                    items={[
                        { key: "registrations", label: "注册排行", children: <RankingTable items={data?.registrationRankings || []} /> },
                        { key: "recharge", label: "充值排行", children: <RankingTable items={data?.rechargeRankings || []} /> },
                        { key: "consumption", label: "消费排行", children: <RankingTable items={data?.consumptionRankings || []} /> },
                    ]}
                />
            </Panel>
        </div>
    );
}

function RankingTable({ items }: { items: Array<Record<string, unknown>> }) {
    return (
        <Table
            rowKey="id"
            pagination={false}
            dataSource={items}
            columns={[
                { title: "渠道", dataIndex: "channel_name" },
                { title: "注册人数", dataIndex: "registered_users" },
                { title: "充值", dataIndex: "recharge_cents", render: yuan },
                { title: "积分消耗", dataIndex: "consumed_points" },
            ]}
        />
    );
}

function Channels() {
    const { message } = App.useApp();
    const [items, setItems] = useState<Channel[]>([]);
    const [editing, setEditing] = useState<Channel>();
    const [open, setOpen] = useState(false);
    const [detail, setDetail] = useState<{ kind: AttributionKind; id: string; title: string }>();
    const load = useCallback(async () => {
        try {
            setItems((await getChannels({ pageSize: 100 })).items);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取失败");
        }
    }, [message]);
    useEffect(() => {
        void load();
    }, [load]);
    return (
        <Panel
            title="渠道列表"
            actions={
                <Button
                    type="primary"
                    icon={<Plus className="size-4" />}
                    onClick={() => {
                        setEditing(undefined);
                        setOpen(true);
                    }}
                >
                    新增渠道
                </Button>
            }
        >
            <Table
                rowKey="id"
                dataSource={items}
                columns={[
                    { title: "渠道名称", dataIndex: "channelName" },
                    { title: "类型", dataIndex: "channelType", render: typeLabel },
                    { title: "邀请码", dataIndex: "inviteCount" },
                    { title: "注册", dataIndex: "registeredUsers" },
                    { title: "活跃", dataIndex: "activeUsers" },
                    { title: "付费", dataIndex: "paidUsers" },
                    { title: "充值", dataIndex: "rechargeCents", render: yuan },
                    { title: "消耗", dataIndex: "consumedPoints" },
                    { title: "状态", dataIndex: "status", render: statusTag },
                    {
                        title: "操作",
                        render: (_, row) => (
                            <Actions
                                protectedRecord={Boolean(row.systemKey)}
                                status={row.status}
                                onView={() => setDetail({ kind: "channel", id: row.id, title: row.channelName })}
                                onEdit={() => {
                                    setEditing(row);
                                    setOpen(true);
                                }}
                                onStatus={async (status) => {
                                    await setAttributionStatus("channel", row.id, status);
                                    void load();
                                }}
                                onDelete={async () => {
                                    await deleteAttribution("channel", row.id);
                                    void load();
                                }}
                            />
                        ),
                    },
                ]}
            />
            <ChannelModal
                open={open}
                item={editing}
                onClose={() => setOpen(false)}
                onSaved={() => {
                    setOpen(false);
                    void load();
                }}
            />
            <DetailDrawer target={detail} onClose={() => setDetail(undefined)} />
        </Panel>
    );
}

function Campaigns() {
    const { message } = App.useApp();
    const [items, setItems] = useState<Campaign[]>([]);
    const [channels, setChannels] = useState<Channel[]>([]);
    const [editing, setEditing] = useState<Campaign>();
    const [open, setOpen] = useState(false);
    const [detail, setDetail] = useState<any>();
    const load = useCallback(async () => {
        try {
            const [a, b] = await Promise.all([getCampaigns({ pageSize: 100 }), getChannels({ pageSize: 100 })]);
            setItems(a.items);
            setChannels(b.items);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取失败");
        }
    }, [message]);
    useEffect(() => {
        void load();
    }, [load]);
    return (
        <Panel
            title="项目 / 活动"
            actions={
                <Button
                    type="primary"
                    icon={<Plus className="size-4" />}
                    onClick={() => {
                        setEditing(undefined);
                        setOpen(true);
                    }}
                >
                    新增活动
                </Button>
            }
        >
            <Table
                rowKey="id"
                dataSource={items}
                columns={[
                    { title: "名称", dataIndex: "name" },
                    { title: "渠道", dataIndex: "channelName", render: (v) => v || "跨渠道" },
                    { title: "开始", dataIndex: "startAt", render: date },
                    { title: "结束", dataIndex: "endAt", render: date },
                    { title: "状态", dataIndex: "status", render: statusTag },
                    {
                        title: "操作",
                        render: (_, row) => (
                            <Actions
                                status={row.status}
                                onView={() => setDetail({ kind: "campaign", id: row.id, title: row.name })}
                                onEdit={() => {
                                    setEditing(row);
                                    setOpen(true);
                                }}
                                onStatus={async (status) => {
                                    await setAttributionStatus("campaign", row.id, status);
                                    void load();
                                }}
                                onDelete={async () => {
                                    await deleteAttribution("campaign", row.id);
                                    void load();
                                }}
                            />
                        ),
                    },
                ]}
            />
            <CampaignModal
                open={open}
                item={editing}
                channels={channels}
                onClose={() => setOpen(false)}
                onSaved={() => {
                    setOpen(false);
                    void load();
                }}
            />
            <DetailDrawer target={detail} onClose={() => setDetail(undefined)} />
        </Panel>
    );
}

function Batches() {
    const { message } = App.useApp();
    const [items, setItems] = useState<Batch[]>([]);
    const [campaigns, setCampaigns] = useState<Campaign[]>([]);
    const [editing, setEditing] = useState<Batch>();
    const [open, setOpen] = useState(false);
    const [detail, setDetail] = useState<any>();
    const load = useCallback(async () => {
        try {
            const [a, b] = await Promise.all([getBatches({ pageSize: 100 }), getCampaigns({ pageSize: 100 })]);
            setItems(a.items);
            setCampaigns(b.items);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取失败");
        }
    }, [message]);
    useEffect(() => {
        void load();
    }, [load]);
    return (
        <Panel
            title="批次管理"
            actions={
                <Button
                    type="primary"
                    icon={<Plus className="size-4" />}
                    onClick={() => {
                        setEditing(undefined);
                        setOpen(true);
                    }}
                >
                    新增批次
                </Button>
            }
        >
            <Table
                rowKey="id"
                dataSource={items}
                columns={[
                    { title: "批次", dataIndex: "name" },
                    { title: "活动", dataIndex: "campaignName" },
                    { title: "开始", dataIndex: "startAt", render: date },
                    { title: "结束", dataIndex: "endAt", render: date },
                    { title: "状态", dataIndex: "status", render: statusTag },
                    {
                        title: "操作",
                        render: (_, row) => (
                            <Actions
                                status={row.status}
                                onView={() => setDetail({ kind: "batch", id: row.id, title: row.name })}
                                onEdit={() => {
                                    setEditing(row);
                                    setOpen(true);
                                }}
                                onStatus={async (status) => {
                                    await setAttributionStatus("batch", row.id, status);
                                    void load();
                                }}
                                onDelete={async () => {
                                    await deleteAttribution("batch", row.id);
                                    void load();
                                }}
                            />
                        ),
                    },
                ]}
            />
            <BatchModal
                open={open}
                item={editing}
                campaigns={campaigns}
                onClose={() => setOpen(false)}
                onSaved={() => {
                    setOpen(false);
                    void load();
                }}
            />
            <DetailDrawer target={detail} onClose={() => setDetail(undefined)} />
        </Panel>
    );
}

function Invites() {
    const { message } = App.useApp();
    const [items, setItems] = useState<InviteCode[]>([]);
    const [channels, setChannels] = useState<Channel[]>([]);
    const [campaigns, setCampaigns] = useState<Campaign[]>([]);
    const [batches, setBatches] = useState<Batch[]>([]);
    const [editing, setEditing] = useState<InviteCode>();
    const [open, setOpen] = useState(false);
    const [batchOpen, setBatchOpen] = useState(false);
    const [detail, setDetail] = useState<any>();
    const load = useCallback(async () => {
        try {
            const [a, b, c, d] = await Promise.all([getInvites({ pageSize: 100 }), getChannels({ pageSize: 100 }), getCampaigns({ pageSize: 100 }), getBatches({ pageSize: 100 })]);
            setItems(a.items);
            setChannels(b.items);
            setCampaigns(c.items);
            setBatches(d.items);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取失败");
        }
    }, [message]);
    useEffect(() => {
        void load();
    }, [load]);
    return (
        <Panel
            title="邀请码管理"
            actions={
                <Space>
                    <Button onClick={() => setBatchOpen(true)}>批量生成</Button>
                    <Button
                        type="primary"
                        icon={<Plus className="size-4" />}
                        onClick={() => {
                            setEditing(undefined);
                            setOpen(true);
                        }}
                    >
                        新增邀请码
                    </Button>
                </Space>
            }
        >
            <Table
                rowKey="id"
                dataSource={items}
                scroll={{ x: 1300 }}
                columns={[
                    {
                        title: "邀请码",
                        dataIndex: "code",
                        render: (value) => (
                            <Space>
                                <b>{value}</b>
                                <Button
                                    type="text"
                                    size="small"
                                    icon={<Copy className="size-3" />}
                                    onClick={() => {
                                        void navigator.clipboard.writeText(value);
                                        message.success("已复制");
                                    }}
                                />
                            </Space>
                        ),
                    },
                    { title: "名称", dataIndex: "name" },
                    { title: "渠道", dataIndex: "channelName" },
                    { title: "活动", dataIndex: "campaignName", render: (v) => v || "-" },
                    { title: "批次", dataIndex: "batchName", render: (v) => v || "-" },
                    { title: "使用", render: (_, r) => `${r.usedCount}/${r.maxUses ?? "不限"}` },
                    { title: "真实注册", dataIndex: "registeredUsers" },
                    { title: "状态", dataIndex: "effectiveStatus", render: statusTag },
                    { title: "过期时间", dataIndex: "expireAt", render: date },
                    {
                        title: "操作",
                        fixed: "right",
                        render: (_, row) => (
                            <Actions
                                status={row.status}
                                onView={() => setDetail({ kind: "invite", id: row.id, title: row.code })}
                                onEdit={() => {
                                    setEditing(row);
                                    setOpen(true);
                                }}
                                onStatus={async (status) => {
                                    await setAttributionStatus("invite", row.id, status);
                                    void load();
                                }}
                                onDelete={async () => {
                                    await deleteAttribution("invite", row.id);
                                    void load();
                                }}
                            />
                        ),
                    },
                ]}
            />
            <InviteModal
                open={open}
                item={editing}
                channels={channels}
                campaigns={campaigns}
                batches={batches}
                onClose={() => setOpen(false)}
                onSaved={() => {
                    setOpen(false);
                    void load();
                }}
            />
            <InviteBatchModal
                open={batchOpen}
                channels={channels}
                campaigns={campaigns}
                batches={batches}
                onClose={() => setBatchOpen(false)}
                onSaved={() => {
                    setBatchOpen(false);
                    void load();
                }}
            />
            <DetailDrawer target={detail} onClose={() => setDetail(undefined)} />
        </Panel>
    );
}

function DetailDrawer({ target, onClose }: { target?: { kind: AttributionKind; id: string; title: string }; onClose: () => void }) {
    const { message } = App.useApp();
    const [detail, setDetail] = useState<AttributionDetail>();
    const [users, setUsers] = useState<AttributedUser[]>([]);
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);
    const [q, setQ] = useState("");
    const [status, setStatus] = useState<string>();
    const [dateFrom, setDateFrom] = useState(() => dayjs().subtract(29, "day").format("YYYY-MM-DD"));
    const [dateTo, setDateTo] = useState(() => dayjs().format("YYYY-MM-DD"));
    useEffect(() => {
        if (!target) {
            setDetail(undefined);
            return;
        }
        let cancelled = false;
        void getAttributionDetail(target.kind, target.id, { dateFrom, dateTo })
            .then((nextDetail) => {
                if (!cancelled) setDetail(nextDetail);
            })
            .catch((error) => {
                if (!cancelled) message.error(error instanceof Error ? error.message : "读取统计失败");
            });
        return () => {
            cancelled = true;
        };
    }, [dateFrom, dateTo, message, target]);
    useEffect(() => {
        if (!target) {
            setUsers([]);
            setTotal(0);
            return;
        }
        let cancelled = false;
        void getAttributionUsers(target.kind, target.id, { page, pageSize: 20, q, status })
            .then((result) => {
                if (cancelled) return;
                setUsers(result.items);
                setTotal(result.total);
            })
            .catch((error) => {
                if (!cancelled) message.error(error instanceof Error ? error.message : "读取用户失败");
            });
        return () => {
            cancelled = true;
        };
    }, [message, page, q, status, target]);
    useEffect(() => {
        setPage(1);
        setQ("");
        setStatus(undefined);
    }, [target]);
    const setPreset = (days: number) => {
        setDateFrom(
            dayjs()
                .subtract(days - 1, "day")
                .format("YYYY-MM-DD"),
        );
        setDateTo(dayjs().format("YYYY-MM-DD"));
    };
    const m = detail?.metrics;
    return (
        <Drawer
            open={Boolean(target)}
            onClose={onClose}
            width={900}
            title={target?.title}
            extra={
                target ? (
                    <Button icon={<Download className="size-4" />} onClick={() => exportAttributionUsers(target.kind, target.id, { q, status })}>
                        导出 Excel 兼容 CSV
                    </Button>
                ) : null
            }
        >
            {m ? (
                <>
                    <div className="grid grid-cols-3 gap-3">
                        <Metric label="注册用户" value={m.registered_users} />
                        <Metric label="今日新增" value={m.today_users} />
                        <Metric label="30日活跃" value={m.active_users} />
                        <Metric label="付费用户" value={m.paid_users} />
                        <Metric label="累计充值" value={`¥${yuan(m.recharge_cents)}`} />
                        <Metric label="积分消耗" value={m.consumed_points} />
                        <Metric label="当前余额" value={m.current_balance} />
                        <Metric label="人均充值" value={`¥${yuan(m.averageRechargeCents)}`} />
                        <Metric label="人均消耗" value={m.averageConsumedPoints} />
                    </div>
                    <Space wrap className="mt-5">
                        <Button size="small" onClick={() => setPreset(1)}>
                            今日
                        </Button>
                        <Button size="small" onClick={() => setPreset(7)}>
                            7 天
                        </Button>
                        <Button size="small" onClick={() => setPreset(30)}>
                            30 天
                        </Button>
                        <DatePicker.RangePicker
                            value={[dayjs(dateFrom), dayjs(dateTo)]}
                            onChange={(dates) => {
                                if (!dates?.[0] || !dates[1]) return;
                                setDateFrom(dates[0].format("YYYY-MM-DD"));
                                setDateTo(dates[1].format("YYYY-MM-DD"));
                            }}
                        />
                    </Space>
                    <Trend items={detail.trends} />
                </>
            ) : null}
            {detail ? (
                <div className="mt-5 rounded-xl border border-stone-200 p-4 text-sm dark:border-white/10">
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                        <span>状态：{statusTag(String(detail.entity.status || "active"))}</span>
                        <span>创建时间：{date(detail.entity.created_at as string | undefined)}</span>
                        <span>开始时间：{date(detail.entity.start_at as string | undefined)}</span>
                        <span>结束 / 过期：{date((detail.entity.end_at || detail.entity.expire_at) as string | undefined)}</span>
                    </div>
                </div>
            ) : null}
            {detail?.inviteCodes?.length ? (
                <Table
                    className="mt-5"
                    rowKey="id"
                    size="small"
                    pagination={false}
                    dataSource={detail.inviteCodes}
                    columns={[
                        { title: "邀请码", dataIndex: "code" },
                        { title: "名称", dataIndex: "name" },
                        { title: "使用次数", dataIndex: "used_count" },
                        { title: "最大次数", dataIndex: "max_uses", render: (value) => value ?? "不限" },
                        { title: "状态", dataIndex: "status", render: statusTag },
                        { title: "过期时间", dataIndex: "expire_at", render: date },
                    ]}
                />
            ) : null}
            <Space wrap className="mt-5">
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
                    className="w-32"
                    placeholder="账号状态"
                    value={status}
                    options={[
                        { value: "active", label: "正常" },
                        { value: "disabled", label: "已停用" },
                    ]}
                    onChange={(value) => {
                        setPage(1);
                        setStatus(value);
                    }}
                />
            </Space>
            <Table
                className="mt-5"
                rowKey="id"
                size="small"
                dataSource={users}
                scroll={{ x: 1200 }}
                pagination={{ current: page, pageSize: 20, total, showSizeChanger: false, onChange: setPage }}
                columns={[
                    { title: "邮箱", dataIndex: "email" },
                    { title: "注册IP", dataIndex: "registrationIp", render: (v) => v || "-" },
                    { title: "注册时间", dataIndex: "createdAt", render: date },
                    { title: "最后登录", dataIndex: "lastLoginAt", render: date },
                    { title: "充值(分)", dataIndex: "rechargeCents" },
                    { title: "余额", dataIndex: "creditBalance" },
                    { title: "总消耗", dataIndex: "consumedPoints" },
                    { title: "图片", dataIndex: "imagePoints" },
                    { title: "视频", dataIndex: "videoPoints" },
                    { title: "其他", dataIndex: "otherPoints" },
                    { title: "Token", dataIndex: "totalTokens" },
                    { title: "状态", dataIndex: "status", render: statusTag },
                ]}
            />
        </Drawer>
    );
}

function ChannelModal({ open, item, onClose, onSaved }: { open: boolean; item?: Channel; onClose: () => void; onSaved: () => void }) {
    const [form] = Form.useForm();
    useEffect(() => {
        if (open) form.setFieldsValue(item || { channelType: "other", status: "active", remark: "" });
    }, [form, item, open]);
    return (
        <EditorModal
            title={item ? "编辑渠道" : "新增渠道"}
            open={open}
            form={form}
            onClose={onClose}
            onSave={async (values) => {
                item ? await updateChannel(item.id, values) : await createChannel(values);
                onSaved();
            }}
        >
            <Form.Item name="channelName" label="渠道名称" rules={[{ required: true }]}>
                <Input />
            </Form.Item>
            <Form.Item name="channelType" label="渠道类型" rules={[{ required: true }]}>
                <Select options={channelTypes.map(([value, label]) => ({ value, label }))} />
            </Form.Item>
            <Form.Item name="codePrefix" label="邀请码前缀">
                <Input placeholder="例如 DLUT" />
            </Form.Item>
            <Form.Item name="contactName" label="联系人">
                <Input />
            </Form.Item>
            <Form.Item name="contactPhone" label="联系电话">
                <Input />
            </Form.Item>
            <Form.Item name="remark" label="备注">
                <Input.TextArea />
            </Form.Item>
            <StatusField />
        </EditorModal>
    );
}
function CampaignModal({ open, item, channels, onClose, onSaved }: { open: boolean; item?: Campaign; channels: Channel[]; onClose: () => void; onSaved: () => void }) {
    const [form] = Form.useForm();
    useEffect(() => {
        if (open) form.setFieldsValue({ ...item, startAt: item?.startAt ? dayjs(item.startAt) : null, endAt: item?.endAt ? dayjs(item.endAt) : null, status: item?.status || "active", description: item?.description || "" });
    }, [form, item, open]);
    return (
        <EditorModal
            title={item ? "编辑活动" : "新增活动"}
            open={open}
            form={form}
            onClose={onClose}
            onSave={async (values) => {
                const input = { ...values, startAt: values.startAt?.toISOString() || null, endAt: values.endAt?.toISOString() || null };
                item ? await updateCampaign(item.id, input) : await createCampaign(input);
                onSaved();
            }}
        >
            <Form.Item name="name" label="活动名称" rules={[{ required: true }]}>
                <Input />
            </Form.Item>
            <Form.Item name="channelId" label="所属渠道">
                <Select allowClear options={channels.map((c) => ({ value: c.id, label: c.channelName }))} />
            </Form.Item>
            <Form.Item name="description" label="说明">
                <Input.TextArea />
            </Form.Item>
            <TimeFields />
            <StatusField />
        </EditorModal>
    );
}
function BatchModal({ open, item, campaigns, onClose, onSaved }: { open: boolean; item?: Batch; campaigns: Campaign[]; onClose: () => void; onSaved: () => void }) {
    const [form] = Form.useForm();
    useEffect(() => {
        if (open) form.setFieldsValue({ ...item, startAt: item?.startAt ? dayjs(item.startAt) : null, endAt: item?.endAt ? dayjs(item.endAt) : null, status: item?.status || "active", description: item?.description || "" });
    }, [form, item, open]);
    return (
        <EditorModal
            title={item ? "编辑批次" : "新增批次"}
            open={open}
            form={form}
            onClose={onClose}
            onSave={async (values) => {
                const input = { ...values, startAt: values.startAt?.toISOString() || null, endAt: values.endAt?.toISOString() || null };
                item ? await updateBatch(item.id, input) : await createBatch(input);
                onSaved();
            }}
        >
            <Form.Item name="name" label="批次名称" rules={[{ required: true }]}>
                <Input />
            </Form.Item>
            <Form.Item name="campaignId" label="所属活动" rules={[{ required: true }]}>
                <Select options={campaigns.map((c) => ({ value: c.id, label: c.name }))} />
            </Form.Item>
            <Form.Item name="description" label="说明">
                <Input.TextArea />
            </Form.Item>
            <TimeFields />
            <StatusField />
        </EditorModal>
    );
}
function InviteModal({ open, item, channels, campaigns, batches, onClose, onSaved }: { open: boolean; item?: InviteCode; channels: Channel[]; campaigns: Campaign[]; batches: Batch[]; onClose: () => void; onSaved: () => void }) {
    const [form] = Form.useForm();
    const channelId = Form.useWatch("channelId", form);
    const campaignId = Form.useWatch("campaignId", form);
    const shownCampaigns = useMemo(() => campaigns.filter((c) => !c.channelId || c.channelId === channelId), [campaigns, channelId]);
    const shownBatches = useMemo(() => batches.filter((b) => b.campaignId === campaignId), [batches, campaignId]);
    useEffect(() => {
        if (open) form.setFieldsValue({ ...item, startAt: item?.startAt ? dayjs(item.startAt) : null, expireAt: item?.expireAt ? dayjs(item.expireAt) : null, status: item?.status || "active", description: item?.description || "" });
    }, [form, item, open]);
    return (
        <EditorModal
            title={item ? "编辑邀请码" : "新增邀请码"}
            open={open}
            form={form}
            onClose={onClose}
            onSave={async (values) => {
                const input = { ...values, startAt: values.startAt?.toISOString() || null, expireAt: values.expireAt?.toISOString() || null };
                item ? await updateInvite(item.id, input) : await createInvite(input);
                onSaved();
            }}
        >
            <Form.Item name="code" label="邀请码">
                <Input placeholder="留空自动生成" disabled={Boolean(item?.usedCount)} />
            </Form.Item>
            <Form.Item name="name" label="名称" rules={[{ required: true }]}>
                <Input />
            </Form.Item>
            <Form.Item name="channelId" label="渠道" rules={[{ required: true }]}>
                <Select options={channels.filter((c) => c.status === "active").map((c) => ({ value: c.id, label: c.channelName }))} />
            </Form.Item>
            <Form.Item name="campaignId" label="活动">
                <Select allowClear options={shownCampaigns.map((c) => ({ value: c.id, label: c.name }))} />
            </Form.Item>
            <Form.Item name="batchId" label="批次">
                <Select allowClear options={shownBatches.map((b) => ({ value: b.id, label: b.name }))} />
            </Form.Item>
            <Form.Item name="maxUses" label="最大使用次数">
                <InputNumber min={1} className="w-full" placeholder="留空不限" />
            </Form.Item>
            <Form.Item name="description" label="说明">
                <Input.TextArea />
            </Form.Item>
            <Form.Item name="startAt" label="生效时间">
                <DatePicker showTime className="w-full" />
            </Form.Item>
            <Form.Item name="expireAt" label="过期时间">
                <DatePicker showTime className="w-full" />
            </Form.Item>
            <StatusField />
        </EditorModal>
    );
}
function InviteBatchModal({ open, channels, campaigns, batches, onClose, onSaved }: { open: boolean; channels: Channel[]; campaigns: Campaign[]; batches: Batch[]; onClose: () => void; onSaved: () => void }) {
    const [form] = Form.useForm();
    const channelId = Form.useWatch("channelId", form);
    const campaignId = Form.useWatch("campaignId", form);
    useEffect(() => {
        if (open) form.setFieldsValue({ count: 10, status: "active", description: "" });
    }, [form, open]);
    return (
        <EditorModal
            title="批量生成邀请码"
            open={open}
            form={form}
            onClose={onClose}
            onSave={async (values) => {
                await createInviteBatch({ ...values, startAt: values.startAt?.toISOString() || null, expireAt: values.expireAt?.toISOString() || null });
                onSaved();
            }}
        >
            <Form.Item name="namePrefix" label="名称前缀" rules={[{ required: true }]}>
                <Input />
            </Form.Item>
            <Form.Item name="channelId" label="渠道" rules={[{ required: true }]}>
                <Select options={channels.filter((c) => c.status === "active").map((c) => ({ value: c.id, label: c.channelName }))} />
            </Form.Item>
            <Form.Item name="campaignId" label="活动">
                <Select allowClear options={campaigns.filter((c) => !c.channelId || c.channelId === channelId).map((c) => ({ value: c.id, label: c.name }))} />
            </Form.Item>
            <Form.Item name="batchId" label="批次">
                <Select allowClear options={batches.filter((b) => b.campaignId === campaignId).map((b) => ({ value: b.id, label: b.name }))} />
            </Form.Item>
            <Form.Item name="count" label="生成数量" rules={[{ required: true }]}>
                <Select options={[1, 5, 10, 20, 50, 100].map((value) => ({ value, label: `${value} 个` }))} />
            </Form.Item>
            <Form.Item name="maxUses" label="每个邀请码最大次数">
                <InputNumber min={1} className="w-full" />
            </Form.Item>
            <Form.Item name="description" label="说明">
                <Input.TextArea />
            </Form.Item>
            <Form.Item name="startAt" label="生效时间">
                <DatePicker showTime className="w-full" />
            </Form.Item>
            <Form.Item name="expireAt" label="过期时间">
                <DatePicker showTime className="w-full" />
            </Form.Item>
            <StatusField />
        </EditorModal>
    );
}

function EditorModal({ title, open, form, onClose, onSave, children }: { title: string; open: boolean; form: any; onClose: () => void; onSave: (values: any) => Promise<void>; children: React.ReactNode }) {
    const { message } = App.useApp();
    const [saving, setSaving] = useState(false);
    return (
        <Modal
            title={title}
            open={open}
            onCancel={onClose}
            confirmLoading={saving}
            onOk={() =>
                void form.validateFields().then(async (values: any) => {
                    setSaving(true);
                    try {
                        await onSave(values);
                        message.success("已保存");
                    } catch (error) {
                        message.error(error instanceof Error ? error.message : "保存失败");
                    } finally {
                        setSaving(false);
                    }
                })
            }
        >
            <Form form={form} layout="vertical" preserve={false}>
                {children}
            </Form>
        </Modal>
    );
}
function TimeFields() {
    return (
        <div className="grid grid-cols-2 gap-3">
            <Form.Item name="startAt" label="开始时间">
                <DatePicker showTime className="w-full" />
            </Form.Item>
            <Form.Item name="endAt" label="结束时间">
                <DatePicker showTime className="w-full" />
            </Form.Item>
        </div>
    );
}
function StatusField() {
    return (
        <Form.Item name="status" label="状态" valuePropName="checked" getValueFromEvent={(checked: boolean) => (checked ? "active" : "disabled")} getValueProps={(value: string) => ({ checked: value !== "disabled" })}>
            <Switch checkedChildren="启用" unCheckedChildren="停用" />
        </Form.Item>
    );
}
function Actions({
    status,
    protectedRecord,
    onView,
    onEdit,
    onStatus,
    onDelete,
}: {
    status: string;
    protectedRecord?: boolean;
    onView: () => void;
    onEdit: () => void;
    onStatus: (status: "active" | "disabled") => Promise<void>;
    onDelete: () => Promise<void>;
}) {
    const { modal, message } = App.useApp();
    return (
        <Space>
            <Button type="text" size="small" icon={<Eye className="size-3" />} onClick={onView}>
                数据
            </Button>
            <Button type="text" size="small" onClick={onEdit}>
                编辑
            </Button>
            <Button type="text" size="small" onClick={() => void onStatus(status === "active" ? "disabled" : "active").catch((e) => message.error(e.message))}>
                {status === "active" ? "停用" : "启用"}
            </Button>
            {!protectedRecord ? (
                <Button
                    danger
                    type="text"
                    size="small"
                    onClick={() => modal.confirm({ title: "确认删除？", content: "已有历史数据的记录不能删除，只能停用。", okButtonProps: { danger: true }, onOk: () => onDelete().catch((e) => message.error(e.message)) })}
                >
                    删除
                </Button>
            ) : null}
        </Space>
    );
}
function Trend({ items }: { items: AttributionDetail["trends"] }) {
    return (
        <div className="mt-5 grid gap-3 lg:grid-cols-3">
            <TrendSeries title="用户增长" color="bg-violet-500/70" items={items} value={(item) => Number(item.registrations)} />
            <TrendSeries title="充值趋势" color="bg-emerald-500/70" items={items} value={(item) => Number(item.recharge_cents)} />
            <TrendSeries title="积分消耗趋势" color="bg-amber-500/70" items={items} value={(item) => Number(item.consumed_points)} />
        </div>
    );
}
function TrendSeries({ title, color, items, value }: { title: string; color: string; items: AttributionDetail["trends"]; value: (item: AttributionDetail["trends"][number]) => number }) {
    const max = Math.max(1, ...items.map(value));
    return (
        <div className="rounded-xl border border-stone-200 p-4 dark:border-white/10">
            <b className="text-sm">{title}</b>
            <div className="mt-4 flex h-24 items-end gap-1">
                {items.map((item) => {
                    const amount = value(item);
                    return <div key={item.day} title={`${item.day}：${amount}`} className={`min-w-1 flex-1 rounded-t ${color}`} style={{ height: `${Math.max(3, (amount / max) * 100)}%` }} />;
                })}
            </div>
        </div>
    );
}
function Panel({ title, actions, children }: { title: string; actions?: React.ReactNode; children: React.ReactNode }) {
    return (
        <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm shadow-stone-200/40 dark:border-white/10 dark:bg-stone-950 dark:shadow-none">
            <div className="mb-4 flex items-center justify-between">
                <h2 className="text-base font-semibold">{title}</h2>
                {actions}
            </div>
            {children}
        </section>
    );
}
function Metric({ label, value }: { label: string; value: unknown }) {
    return (
        <div className="rounded-xl border border-stone-200 bg-white p-4 dark:border-white/10 dark:bg-stone-950">
            <p className="text-xs text-stone-500">{label}</p>
            <b className="mt-2 block text-xl">{String(value ?? 0)}</b>
        </div>
    );
}
function typeLabel(value: string) {
    return channelTypes.find(([key]) => key === value)?.[1] || value;
}
function statusTag(value: string) {
    const labels: Record<string, string> = { active: "启用", disabled: "停用", expired: "已过期", pending: "未生效", full: "名额已满", open: "正常" };
    return <Tag color={value === "active" ? "green" : value === "disabled" ? "default" : "orange"}>{labels[value] || value}</Tag>;
}
function date(value?: string) {
    return value ? dayjs(value).format("YYYY-MM-DD HH:mm") : "-";
}
function yuan(value: unknown) {
    return (Number(value || 0) / 100).toFixed(2);
}
