import { Input, Modal, Segmented, message } from "antd";
import { Mail, MessageSquareText } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { createFeedback, type UserFeedback } from "@/services/api/operations";

const SUPPORT_EMAIL = "shoushouhuabu@126.com";

type FeedbackModalProps = {
    open: boolean;
    onClose: () => void;
};

export function FeedbackModal({ open, onClose }: FeedbackModalProps) {
    const { t } = useTranslation();
    const [category, setCategory] = useState<UserFeedback["category"]>("problem");
    const [content, setContent] = useState("");
    const [contact, setContact] = useState("");
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (!open) return;
        setCategory("problem");
        setContent("");
        setContact("");
    }, [open]);

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
            onClose();
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
            destroyOnHidden
        >
            <div className="space-y-4 py-2">
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
                <div className="flex items-start gap-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2.5 text-xs text-stone-600 dark:border-white/10 dark:bg-white/5 dark:text-stone-300">
                    <Mail className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                        {t("feedback.emailFallback")} <a className="font-medium text-stone-950 underline underline-offset-2 dark:text-white" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
                    </span>
                </div>
            </div>
        </Modal>
    );
}
