import { Alert, Button, Card, Input, Modal, Select, Space, Table, Tag, message } from "antd";
import { useCallback, useEffect, useState } from "react";
import { getWebsiteInquiries, updateWebsiteInquiry, type WebsiteInquiry } from "@/services/api/website-inquiries";

export default function WebsiteInquiries() {
    const [items, setItems] = useState<WebsiteInquiry[]>([]);
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [revision, setRevision] = useState(0);
    const [selected, setSelected] = useState<WebsiteInquiry>();
    const [saving, setSaving] = useState(false);
    const refresh = useCallback(() => setRevision(value => value + 1), []);
    useEffect(() => {
        const controller = new AbortController();
        setLoading(true); setError("");
        getWebsiteInquiries(page, controller.signal).then(data => {
            if (controller.signal.aborted) return;
            setItems(data.items); setTotal(data.total);
        }).catch(error => {
            if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "加载失败，请重试");
        }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
        return () => controller.abort();
    }, [page, revision]);
    const save = async () => {
        if (!selected || saving) return;
        setSaving(true);
        try {
            await updateWebsiteInquiry(selected.id, { status: selected.status, note: selected.note.trim() });
            message.success("处理记录已保存"); setSelected(undefined); refresh();
        } catch (error) { message.error(error instanceof Error ? error.message : "保存失败，请重试"); }
        finally { setSaving(false); }
    };
    return <Card title="官网咨询" extra={<Button loading={loading} onClick={refresh}>刷新</Button>}>
        <p className="mb-4">官网访客提交的需求。处理备注仅管理员可见；请通过访客留下的联系方式回复，不会发送站内或邮件通知。</p>
        {error && <Alert type="error" showIcon message={error} className="mb-4" />}
        <Table<WebsiteInquiry> rowKey="id" dataSource={items} loading={loading} scroll={{ x: 900 }}
            pagination={{ current: page, pageSize: 20, total, showSizeChanger: false, onChange: setPage }}
            columns={[
                { title: "提交时间", dataIndex: "createdAt", width: 180, render: value => new Date(value).toLocaleString("zh-CN") },
                { title: "状态", dataIndex: "status", width: 100, render: value => <Tag color={value === "open" ? "orange" : "green"}>{value === "open" ? "待处理" : "已完成"}</Tag> },
                { title: "联系方式", dataIndex: "contact", width: 220, render: value => <span className="break-all">{value}</span> },
                { title: "需求", dataIndex: "content", render: value => <p className="whitespace-pre-wrap break-words">{value}</p> },
                { title: "操作", width: 100, render: (_, item) => <Button type="link" onClick={() => setSelected({ ...item })}>查看 / 处理</Button> },
            ]} />
        <Modal open={Boolean(selected)} title="咨询处理" confirmLoading={saving} onOk={save} okText="保存处理记录"
            cancelButtonProps={{ disabled: saving }} closable={!saving} maskClosable={!saving} keyboard={!saving}
            onCancel={() => { if (!saving) setSelected(undefined); }}>
            {selected && <Space direction="vertical" className="w-full" size="middle">
                <p className="whitespace-pre-wrap break-words">{selected.content}</p>
                <p className="break-all">联系方式：{selected.contact}</p>
                <label htmlFor="inquiry-status">处理状态</label>
                <Select id="inquiry-status" className="w-full" value={selected.status} disabled={saving}
                    options={[{ value: "open", label: "待处理" }, { value: "closed", label: "已完成" }]}
                    onChange={status => setSelected({ ...selected, status })} />
                <label htmlFor="inquiry-note">内部备注（不会发送给访客）</label>
                <Input.TextArea id="inquiry-note" rows={5} maxLength={2000} showCount disabled={saving} value={selected.note}
                    onChange={event => setSelected({ ...selected, note: event.target.value })} />
            </Space>}
        </Modal>
    </Card>;
}
