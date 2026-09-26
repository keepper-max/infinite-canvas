import { App, Button, Form, Input } from "antd";
import { ArrowRight, BadgeCheck, LockKeyhole, Mail } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { getAuthConfig, login, PlatformApiError, register, requestEmailVerification } from "@/services/api/platform";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";

export default function AuthPage({ mode }: { mode: "login" | "register" }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [submitting, setSubmitting] = useState(false);
    const [sendingCode, setSendingCode] = useState(false);
    const [countdown, setCountdown] = useState(0);
    const [verificationRequired, setVerificationRequired] = useState<boolean | null>(mode === "login" ? false : null);
    const [authenticatedProjectId, setAuthenticatedProjectId] = useState<string | null>(null);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const [form] = Form.useForm();

    useEffect(() => {
        if (countdown <= 0) return;
        const timer = window.setTimeout(() => setCountdown((value) => Math.max(0, value - 1)), 1_000);
        return () => window.clearTimeout(timer);
    }, [countdown]);

    useEffect(() => {
        if (mode !== "register") return;
        let active = true;
        void getAuthConfig()
            .then((result) => {
                if (active) setVerificationRequired(result.emailVerificationRequired);
            })
            .catch(() => {
                if (active) setVerificationRequired(true);
            });
        return () => {
            active = false;
        };
    }, [mode]);

    if (authenticatedProjectId) return <Navigate to={`/canvas/${authenticatedProjectId}`} replace />;

    const sendCode = async () => {
        try {
            const { email } = await form.validateFields(["email"]);
            setSendingCode(true);
            const result = await requestEmailVerification(email);
            setCountdown(result.retryAfterSeconds);
            message.success(t("auth.codeSent"));
        } catch (error) {
            if (error instanceof PlatformApiError) {
                const retryAfterSeconds = Number(error.details?.retryAfterSeconds || 0);
                if (retryAfterSeconds > 0) setCountdown(retryAfterSeconds);
                message.error(error.message);
            }
        } finally {
            setSendingCode(false);
        }
    };

    const submit = async (values: { email: string; password: string; verificationCode?: string }) => {
        setSubmitting(true);
        try {
            const session = await (mode === "register" ? register(values.email, values.password, values.verificationCode) : login(values.email, values.password));
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
                    <img src="/shoushou-logo.png" alt="" className="size-11 rounded-xl bg-black object-contain" />
                    <div>
                        <p className="text-xs tracking-[0.24em] text-stone-500">守守画布</p>
                        <p className="mt-1 text-sm text-stone-300">{t("auth.workspace")}</p>
                    </div>
                </div>
                <h1 className="mt-10 text-3xl font-semibold tracking-tight">{t(mode === "register" ? "auth.registerTitle" : "auth.loginTitle")}</h1>
                <p className="mt-3 text-sm leading-6 text-stone-400">{t("auth.directEntry")}</p>

                <Form form={form} layout="vertical" requiredMark={false} className="mt-8" onFinish={(values) => void submit(values as { email: string; password: string; verificationCode?: string })}>
                    <Form.Item name="email" label={<span className="text-stone-300">{t("auth.email")}</span>} rules={[{ required: true, type: "email", message: t("auth.emailInvalid") }]}>
                        <Input size="large" prefix={<Mail className="size-4 text-stone-500" />} placeholder="you@example.com" autoComplete="email" />
                    </Form.Item>
                    {mode === "register" && verificationRequired && (
                        <Form.Item
                            name="verificationCode"
                            label={<span className="text-stone-300">{t("auth.verificationCode")}</span>}
                            rules={[{ required: true, pattern: /^\d{6}$/, message: t("auth.codeInvalid") }]}
                        >
                            <Input
                                size="large"
                                prefix={<BadgeCheck className="size-4 text-stone-500" />}
                                placeholder={t("auth.codePlaceholder")}
                                inputMode="numeric"
                                autoComplete="one-time-code"
                                maxLength={6}
                                suffix={
                                    <Button
                                        type="text"
                                        size="small"
                                        loading={sendingCode}
                                        disabled={countdown > 0}
                                        onClick={() => void sendCode()}
                                    >
                                        {countdown > 0 ? t("auth.resendCountdown", { seconds: countdown }) : t("auth.sendCode")}
                                    </Button>
                                }
                            />
                        </Form.Item>
                    )}
                    <Form.Item name="password" label={<span className="text-stone-300">{t("auth.password")}</span>} rules={[{ required: true, min: mode === "register" ? 8 : 1, message: t("auth.passwordInvalid") }]}>
                        <Input.Password size="large" prefix={<LockKeyhole className="size-4 text-stone-500" />} placeholder={t("auth.passwordPlaceholder")} autoComplete={mode === "register" ? "new-password" : "current-password"} />
                    </Form.Item>
                    <Button htmlType="submit" type="primary" size="large" block loading={submitting} disabled={!hydrated || (mode === "register" && verificationRequired === null)} icon={<ArrowRight className="size-4" />} iconPlacement="end" className="mt-3">
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
            <a
                className="absolute bottom-4 text-xs text-stone-500 transition-colors hover:text-stone-300"
                href="https://beian.miit.gov.cn/"
                target="_blank"
                rel="noreferrer"
            >
                辽ICP备2026022425号-1
            </a>
        </main>
    );
}
