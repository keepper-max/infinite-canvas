import { App, Button, Form, Input } from "antd";
import { ArrowRight, LockKeyhole, Mail } from "lucide-react";
import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { login, PlatformApiError, register } from "@/services/api/platform";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";

export default function AuthPage({ mode }: { mode: "login" | "register" }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [submitting, setSubmitting] = useState(false);
    const [authenticatedProjectId, setAuthenticatedProjectId] = useState<string | null>(null);
    const hydrated = useCanvasStore((state) => state.hydrated);

    if (authenticatedProjectId) return <Navigate to={`/canvas/${authenticatedProjectId}`} replace />;

    const submit = async (values: { email: string; password: string }) => {
        setSubmitting(true);
        try {
            const session = await (mode === "register" ? register(values.email, values.password) : login(values.email, values.password));
            useCanvasStore.getState().ensureProjectShell(session.workspace);
            setAuthenticatedProjectId(session.workspace.projectId);
            message.success(t(mode === "register" ? "auth.registered" : "auth.loggedIn"));
        } catch (error) {
            message.error(error instanceof PlatformApiError ? error.message : t("auth.failed"));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <main className="relative flex h-dvh items-center justify-center overflow-hidden bg-[#101010] px-5 py-8 text-stone-100">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_15%,rgba(139,92,246,0.2),transparent_32%),radial-gradient(circle_at_82%_78%,rgba(59,130,246,0.12),transparent_28%)]" />
            <section className="relative w-full max-w-md rounded-[28px] border border-white/10 bg-[#191817]/95 p-8 shadow-2xl shadow-black/40 backdrop-blur-xl sm:p-10">
                <div className="flex items-center gap-3">
                    <span className="flex size-11 items-center justify-center rounded-2xl bg-stone-100 text-xl font-semibold text-stone-950">镜</span>
                    <div>
                        <p className="text-xs tracking-[0.24em] text-stone-500">JINGJIE STUDIO</p>
                        <p className="mt-1 text-sm text-stone-300">{t("auth.workspace")}</p>
                    </div>
                </div>
                <h1 className="mt-10 text-3xl font-semibold tracking-tight">{t(mode === "register" ? "auth.registerTitle" : "auth.loginTitle")}</h1>
                <p className="mt-3 text-sm leading-6 text-stone-400">{t("auth.directEntry")}</p>

                <Form layout="vertical" requiredMark={false} className="mt-8" onFinish={(values) => void submit(values as { email: string; password: string })}>
                    <Form.Item name="email" label={<span className="text-stone-300">{t("auth.email")}</span>} rules={[{ required: true, type: "email", message: t("auth.emailInvalid") }]}>
                        <Input size="large" prefix={<Mail className="size-4 text-stone-500" />} placeholder="you@example.com" autoComplete="email" />
                    </Form.Item>
                    <Form.Item name="password" label={<span className="text-stone-300">{t("auth.password")}</span>} rules={[{ required: true, min: mode === "register" ? 8 : 1, message: t("auth.passwordInvalid") }]}>
                        <Input.Password size="large" prefix={<LockKeyhole className="size-4 text-stone-500" />} placeholder={t("auth.passwordPlaceholder")} autoComplete={mode === "register" ? "new-password" : "current-password"} />
                    </Form.Item>
                    <Button htmlType="submit" type="primary" size="large" block loading={submitting} disabled={!hydrated} icon={<ArrowRight className="size-4" />} iconPlacement="end" className="mt-3">
                        {t(mode === "register" ? "auth.registerAction" : "auth.loginAction")}
                    </Button>
                </Form>

                <p className="mt-6 text-center text-sm text-stone-400">
                    {t(mode === "register" ? "auth.hasAccount" : "auth.noAccount")} {" "}
                    <Link className="text-stone-100 underline underline-offset-4" to={mode === "register" ? "/login" : "/register"}>
                        {t(mode === "register" ? "auth.goLogin" : "auth.goRegister")}
                    </Link>
                </p>
            </section>
        </main>
    );
}
