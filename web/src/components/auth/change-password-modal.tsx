import { App, Form, Input, Modal } from "antd";
import { LockKeyhole } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { changePassword, PlatformApiError } from "@/services/api/platform";

export function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [form] = Form.useForm();
    const [submitting, setSubmitting] = useState(false);

    const submit = async () => {
        try {
            const values = await form.validateFields();
            setSubmitting(true);
            await changePassword(values.currentPassword, values.newPassword);
            message.success(t("auth.passwordChanged"));
            form.resetFields();
            onClose();
        } catch (error) {
            if (error instanceof PlatformApiError) message.error(error.message);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Modal
            title={t("auth.changePassword")}
            open={open}
            okText={t("common.save")}
            cancelText={t("common.cancel")}
            confirmLoading={submitting}
            destroyOnHidden
            onOk={() => void submit()}
            onCancel={onClose}
            afterClose={() => form.resetFields()}
        >
            <Form form={form} layout="vertical" requiredMark={false} className="pt-3">
                <Form.Item name="currentPassword" label={t("auth.currentPassword")} rules={[{ required: true, message: t("auth.currentPassword") }]}>
                    <Input.Password prefix={<LockKeyhole className="size-4 text-muted-foreground" />} autoComplete="current-password" />
                </Form.Item>
                <Form.Item name="newPassword" label={t("auth.newPassword")} rules={[{ required: true, min: 8, message: t("auth.passwordInvalid") }]}>
                    <Input.Password prefix={<LockKeyhole className="size-4 text-muted-foreground" />} autoComplete="new-password" />
                </Form.Item>
                <Form.Item name="confirmPassword" dependencies={["newPassword"]} label={t("auth.confirmPassword")} rules={[{ required: true, message: t("auth.passwordInvalid") }, ({ getFieldValue }) => ({ validator(_, value) { return !value || getFieldValue("newPassword") === value ? Promise.resolve() : Promise.reject(new Error(t("auth.passwordMismatch"))); } })]}>
                    <Input.Password prefix={<LockKeyhole className="size-4 text-muted-foreground" />} autoComplete="new-password" />
                </Form.Item>
            </Form>
        </Modal>
    );
}
