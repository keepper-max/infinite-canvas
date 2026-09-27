import { Empty, Input, Modal, Segmented, Spin, Tag, message } from "antd";
import { MessageSquareText } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { createFeedback, getMyFeedback, markFeedbackRead, type UserFeedback } from "@/services/api/operations";

type FeedbackModalProps = {
    open: boolean;
    onClose: () => void;
    onUnreadChange: (hasUnread: boolean) => void;
};

export function FeedbackModal({ open, onClose, onUnreadChange }: FeedbackModalProps) {
    const { t } = useTranslation();
    const [tab, setTab] = useState<"submit" | "mine">("submit");
    const [category, setCategory] = useState<UserFeedback["category"]>("problem");
    const [content, setContent] = useState("");
    const [contact, setContact] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [tickets, setTickets] = useState<UserFeedback[]>([]);
    const [loadingTickets, setLoadingTickets] = useState(false);

    const loadTickets = useCallback(async () => {
        setLoadingTickets(true);
        try {
            const nextTickets = await getMyFeedback();
            setTickets(nextTickets);
            const latestUnreadReply = nextTickets
                .filter((ticket) => ticket.hasUnreadReply)
                .flatMap((ticket) => ticket.replies)
                .filter((reply) => reply.authorRole === "admin")
                .map((reply) => reply.createdAt)
                .sort()
                .at(-1);
            if (latestUnreadReply) {
                try {
                    const result = await markFeedbackRead(latestUnreadReply);
                    onUnreadChange(result.unreadCount > 0);
                } catch {
                    onUnreadChange(true);
                }
            } else onUnreadChange(false);
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("feedback.loadFailed"));
        } finally {
            setLoadingTickets(false);
        }
    }, [onUnreadChange, t]);

    useEffect(() => {
        if (!open) return;
        setTab("submit");
        setCategory("problem");
        setContent("");
        setContact("");
    }, [open]);

    useEffect(() => {
        if (open && tab === "mine") void loadTickets();
    }, [loadTickets, open, tab]);

    const submit = async () => {
        const value = content.trim();
        if (value.length < 2) {
            message.warning(t("feedback.contentRequired"));
            return;
        }
        setSubmitting(true);
        try {
            await createFeedback({
                category,
                content: value,
                ...(contact.trim() ? { contact: contact.trim() } : {}),
                pagePath: window.location.pathname,
            });
            message.success(t("feedback.submitted"));
            setContent("");
            setContact("");
            setTab("mine");
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("feedback.submitFailed"));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Modal
            open={open}
            title={
                <span className="inline-flex items-center gap-2">
                    <MessageSquareText className="size-4" />
                    {t("feedback.title")}
                </span>
            }
            okText={t("feedback.submit")}
            cancelText={t("feedback.cancel")}
            confirmLoading={submitting}
            onOk={() => void submit()}
            onCancel={onClose}
            okButtonProps={{ disabled: content.trim().length < 2 }}
            footer={tab === "submit" ? undefined : null}
            width={620}
            destroyOnHidden
        >
            <div className="space-y-4 py-2">
                <Segmented
                    block
                    value={tab}
                    options={[
                        { label: t("feedback.submitTab"), value: "submit" },
                        { label: t("feedback.myFeedback"), value: "mine" },
                    ]}
                    onChange={(value) => setTab(value as "submit" | "mine")}
                />
                {tab === "submit" ? (
                    <>
                        <Segmented
                            block
                            value={category}
                            options={[
                                { label: t("feedback.problem"), value: "problem" },
                                { label: t("feedback.suggestion"), value: "suggestion" },
                            ]}
                            onChange={(value) => setCategory(value as UserFeedback["category"])}
                        />
                        <Input.TextArea
                            autoFocus
                            showCount
                            maxLength={2000}
                            rows={7}
                            value={content}
                            placeholder={t(category === "problem" ? "feedback.problemPlaceholder" : "feedback.suggestionPlaceholder")}
                            onChange={(event) => setContent(event.target.value)}
                        />
                        <Input value={contact} maxLength={200} placeholder={t("feedback.contactPlaceholder")} onChange={(event) => setContact(event.target.value)} />
                    </>
                ) : (
                    <div className="max-h-[480px] min-h-48 space-y-3 overflow-y-auto pr-1">
                        {loadingTickets ? <div className="flex min-h-48 items-center justify-center"><Spin /></div> : null}
                        {!loadingTickets && tickets.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("feedback.empty")} /> : null}
                        {!loadingTickets ? tickets.map((ticket) => (
                            <article key={ticket.id} className="rounded-xl border border-stone-200 p-4 dark:border-white/10">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex items-center gap-2">
                                        <Tag color={ticket.category === "problem" ? "red" : "blue"}>{t(`feedback.${ticket.category}`)}</Tag>
                                        <FeedbackStatusTag status={ticket.status} />
                                    </div>
                                    <time className="text-xs text-stone-500">{new Date(ticket.createdAt).toLocaleString()}</time>
                                </div>
                                <p className="mt-3 whitespace-pre-wrap break-words text-sm">{ticket.content}</p>
                                {ticket.replies.map((reply) => (
                                    <div key={reply.id} className="mt-3 rounded-lg bg-stone-100 px-3 py-2.5 dark:bg-white/[0.06]">
                                        <div className="flex items-center justify-between gap-2 text-xs text-stone-500">
                                            <span>{t("feedback.adminReply")}</span>
                                            <time>{new Date(reply.createdAt).toLocaleString()}</time>
                                        </div>
                                        <p className="mt-1.5 whitespace-pre-wrap break-words text-sm">{reply.content}</p>
                                    </div>
                                ))}
                            </article>
                        )) : null}
                    </div>
                )}
            </div>
        </Modal>
    );
}

function FeedbackStatusTag({ status }: { status: UserFeedback["status"] }) {
    const { t } = useTranslation();
    const color = status === "closed" ? "default" : status === "replied" ? "green" : "gold";
    return <Tag color={color}>{t(`feedback.status.${status}`)}</Tag>;
}
