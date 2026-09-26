import { App, Button, Form, Input } from "antd";
import { ArrowRight, BadgeCheck, LockKeyhole, Mail } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { confirmPasswordReset, getAuthConfig, login, PlatformApiError, register, requestEmailVerification, requestPasswordReset } from "@/services/api/platform";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";

type AuthMode = "login" | "register" | "forgot-password";

export default function AuthPage({ mode }: { mode: AuthMode }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [submitting, setSubmitting] = useState(false);
    const [sendingCode, setSendingCode] = useState(false);
    const [countdown, setCountdown] = useState(0);
    const [verificationRequired, setVerificationRequired] = useState<boolean | null>(mode === "register" ? null : mode === "forgot-password");
    const [authenticatedProjectId, setAuthenticatedProjectId] = useState<string | null>(null);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const [form] = Form.useForm();

    useEffect(() => {
        if (countdown <= 0) return;
        const timer = window.setTimeout(() => setCountdown((value) => Math.max(0, value - 1)), 1_000);
        return () => window.clearTimeout(timer);
    }, [countdown]);

    useEffect(() => {
        setCountdown(0);
        form.resetFields();
        if (mode === "login") {
            setVerificationRequired(false);
            return;
        }
        if (mode === "forgot-password") {
            setVerificationRequired(true);
            return;
        }
        setVerificationRequired(null);
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
    }, [form, mode]);

    if (authenticatedProjectId) return <Navigate to={`/canvas/${authenticatedProjectId}`} replace />;

    const sendCode = async () => {
        try {
            const { email } = await form.validateFields(["email"]);
            setSendingCode(true);
            const result = await (mode === "forgot-password" ? requestPasswordReset(email) : requestEmailVerification(email));
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

    const submit = async (values: { email: string; password?: string; newPassword?: string; verificationCode?: string }) => {
        setSubmitting(true);
        try {
            if (mode === "forgot-password") {
                await confirmPasswordReset(values.email, values.verificationCode || "", values.newPassword || "");
                message.success(t("auth.passwordReset"));
                navigate("/login", { replace: true });
                return;
            }
            const session = await (mode === "register" ? register(values.email, values.password || "", values.verificationCode) : login(values.email, values.password || ""));
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
                <h1 className="mt-10 text-3xl font-semibold tracking-tight">{t(mode === "register" ? "auth.registerTitle" : mode === "forgot-password" ? "auth.forgotPasswordTitle" : "auth.loginTitle")}</h1>
                <p className="mt-3 text-sm leading-6 text-stone-400">{t(mode === "forgot-password" ? "auth.forgotPasswordHint" : "auth.directEntry")}</p>

                <Form form={form} layout="vertical" requiredMark={false} className="mt-8" onFinish={(values) => void submit(values as { email: string; password?: string; newPassword?: string; verificationCode?: string })}>
                    <Form.Item name="email" label={<span className="text-stone-300">{t("auth.email")}</span>} rules={[{ required: true, type: "email", message: t("auth.emailInvalid") }]}>
                        <Input size="large" prefix={<Mail className="size-4 text-stone-500" />} placeholder="you@example.com" autoComplete="email" />
                    </Form.Item>
                    {mode !== "login" && verificationRequired && (
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
                    {mode === "forgot-password" ? (
                        <>
                            <Form.Item name="newPassword" label={<span className="text-stone-300">{t("auth.newPassword")}</span>} rules={[{ required: true, min: 8, message: t("auth.passwordInvalid") }]}>
                                <Input.Password size="large" prefix={<LockKeyhole className="size-4 text-stone-500" />} placeholder={t("auth.passwordPlaceholder")} autoComplete="new-password" />
                            </Form.Item>
                            <Form.Item name="confirmPassword" dependencies={["newPassword"]} label={<span className="text-stone-300">{t("auth.confirmPassword")}</span>} rules={[{ required: true, message: t("auth.passwordInvalid") }, ({ getFieldValue }) => ({ validator(_, value) { return !value || getFieldValue("newPassword") === value ? Promise.resolve() : Promise.reject(new Error(t("auth.passwordMismatch"))); } })]}>
                                <Input.Password size="large" prefix={<LockKeyhole className="size-4 text-stone-500" />} placeholder={t("auth.passwordPlaceholder")} autoComplete="new-password" />
                            </Form.Item>
                        </>
                    ) : (
                        <Form.Item name="password" label={<span className="text-stone-300">{t("auth.password")}</span>} rules={[{ required: true, min: mode === "register" ? 8 : 1, message: t("auth.passwordInvalid") }]}>
                            <Input.Password size="large" prefix={<LockKeyhole className="size-4 text-stone-500" />} placeholder={t("auth.passwordPlaceholder")} autoComplete={mode === "register" ? "new-password" : "current-password"} />
                        </Form.Item>
                    )}
                    {mode === "login" ? (
                        <div className="-mt-3 mb-3 text-right text-sm">
                            <Link className="text-stone-300 underline underline-offset-4" to="/forgot-password">{t("auth.forgotPassword")}</Link>
                        </div>
                    ) : null}
                    <Button htmlType="submit" type="primary" size="large" block loading={submitting} disabled={!hydrated || (mode === "register" && verificationRequired === null)} icon={<ArrowRight className="size-4" />} iconPlacement="end" className="mt-3">
                        {t(mode === "register" ? "auth.registerAction" : mode === "forgot-password" ? "auth.resetPasswordAction" : "auth.loginAction")}
                    </Button>
                </Form>

                <p className="mt-6 text-center text-sm text-stone-400">
                    {t(mode === "register" ? "auth.hasAccount" : mode === "forgot-password" ? "auth.rememberPassword" : "auth.noAccount")} {" "}
                    <Link className="text-stone-100 underline underline-offset-4" to={mode === "login" ? "/register" : "/login"}>
                        {t(mode === "login" ? "auth.goRegister" : "auth.goLogin")}
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
