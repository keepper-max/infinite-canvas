import { Bot, Menu, ShieldCheck } from "lucide-react";
import { Button, Tooltip } from "antd";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { navigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { AppConfigModal } from "@/components/layout/app-config-modal";
import { MobileNavDrawer } from "@/components/layout/mobile-nav-drawer";
import { UserStatusActions } from "@/components/layout/user-status-actions";
import { CODEX_AGENT_ENABLED } from "@/constant/env";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import { useAgentStore } from "@/stores/use-agent-store";
import { useAuth } from "@/components/auth/auth-context";

type AppTopNavProps = {
    canvasProject: boolean;
    canvasVisible: boolean;
    onCanvasPointerEnter: () => void;
    onCanvasPointerLeave: () => void;
    onRevealCanvasNav: () => void;
};

export function AppTopNav({ canvasProject, canvasVisible, onCanvasPointerEnter, onCanvasPointerLeave, onRevealCanvasNav }: AppTopNavProps) {
    const { t } = useTranslation();
    const { user } = useAuth();
    const { pathname } = useLocation();
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const autoConnectRef = useRef(false);
    const agentToken = useAgentStore((state) => state.token);
    const agentEnabled = useAgentStore((state) => state.enabled);
    const agentConnected = useAgentStore((state) => state.connected);
    const connectAgent = useAgentStore((state) => state.connectAgent);
    const togglePanel = useAgentStore((state) => state.togglePanel);
    const panelOpen = useAgentStore((state) => state.panelOpen);
    const visibleNavigationTools = navigationTools.filter((tool) => tool.slug !== "operations" || user.isAdmin);
    const slug = pathname.split("/").filter(Boolean)[0];
    const activeToolSlug = visibleNavigationTools.some((tool) => tool.slug === slug) ? (slug as NavigationToolSlug) : undefined;

    useEffect(() => {
        if (!CODEX_AGENT_ENABLED || autoConnectRef.current || agentEnabled || agentConnected || !agentToken.trim()) return;
        autoConnectRef.current = true;
        connectAgent({ silent: true });
    }, [agentConnected, agentEnabled, agentToken, connectAgent]);

    return (
        <>
            {canvasProject ? <button type="button" className="absolute inset-x-0 top-0 z-[79] h-2 cursor-default bg-transparent outline-none" onPointerEnter={onRevealCanvasNav} onFocus={onRevealCanvasNav} aria-label={t("topNav.showNavigation")} /> : null}
            <header
                className={cn(
                    "z-20 h-14 shrink-0 border-b border-stone-200 bg-background/90 backdrop-blur-xl dark:border-stone-800",
                    canvasProject ? "absolute inset-x-0 top-0 z-[80] transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none" : "sticky top-0",
                )}
                style={canvasProject ? { transform: canvasVisible ? "translateY(0)" : "translateY(-100%)", opacity: canvasVisible ? 1 : 0, pointerEvents: canvasVisible ? "auto" : "none" } : undefined}
                onPointerEnter={canvasProject ? onCanvasPointerEnter : undefined}
                onPointerLeave={canvasProject ? onCanvasPointerLeave : undefined}
            >
                <div className="mx-auto flex h-full max-w-7xl items-stretch justify-between gap-5 px-6">
                    <div className="flex min-w-0 items-center">
                        <Link to="/" className="flex h-full shrink-0 items-center gap-2 text-sm font-semibold leading-none tracking-tight text-stone-950 transition hover:text-stone-600 dark:text-stone-100 dark:hover:text-stone-300">
                            <img src="/shoushou-logo.png" alt="" className="size-7 shrink-0 rounded-md bg-black object-contain" />
                            <span className="text-base font-medium">{t("meta.title")}</span>
                        </Link>

                        <button
                            type="button"
                            className="ml-3 inline-flex size-8 shrink-0 items-center justify-center text-stone-600 transition hover:text-stone-950 md:hidden dark:text-stone-300 dark:hover:text-white"
                            onClick={() => setMobileNavOpen(true)}
                            aria-label={t("topNav.openMenu")}
                            title={t("topNav.menu")}
                        >
                            <Menu className="size-5" />
                        </button>

                        <nav className="hide-scrollbar ml-8 hidden h-14 min-w-0 items-center gap-7 overflow-x-auto md:flex">
                            {visibleNavigationTools.map((tool) => {
                                const Icon = tool.icon;
                                const active = tool.slug === activeToolSlug;
                                return (
                                    <Link
                                        key={tool.slug}
                                        to={`/${tool.slug}`}
                                        className={cn(
                                            "relative flex h-14 shrink-0 items-center gap-2 text-sm leading-6 transition after:absolute after:inset-x-0 after:bottom-0 after:h-px",
                                            active ? "font-medium text-stone-950 after:bg-stone-950 dark:text-stone-100 dark:after:bg-stone-100" : "text-stone-500 after:bg-transparent hover:text-stone-950 dark:text-stone-400 dark:hover:text-stone-100",
                                        )}
                                    >
                                        <Icon className="size-4" />
                                        <span className="truncate">{t(`navigation.${tool.slug}`)}</span>
                                    </Link>
                                );
                            })}
                        </nav>
                    </div>

                    <div className="my-auto flex h-9 min-w-0 items-center justify-end gap-2 justify-self-end whitespace-nowrap">
                        {user.isAdmin ? (
                            <Tooltip title="管理后台">
                                <Link to="/admin" className="inline-flex size-8 items-center justify-center rounded-full text-stone-500 transition hover:bg-stone-100 hover:text-stone-950 dark:hover:bg-white/10 dark:hover:text-white" aria-label="管理后台">
                                    <ShieldCheck className="size-4" />
                                </Link>
                            </Tooltip>
                        ) : null}
                        {CODEX_AGENT_ENABLED ? (
                            <Tooltip title={t(panelOpen ? "topNav.closeAgent" : "topNav.openAgent")}>
                                <Button type="text" shape="circle" className="!h-8 !w-8 !min-w-8" icon={<Bot className="size-4" />} onClick={togglePanel} aria-label={t(panelOpen ? "topNav.closeAgent" : "topNav.openAgent")} />
                            </Tooltip>
                        ) : null}
                        <UserStatusActions />
                    </div>
                </div>
            </header>

            <MobileNavDrawer open={mobileNavOpen} activeToolSlug={activeToolSlug} showOperations={user.isAdmin} onClose={() => setMobileNavOpen(false)} />
            <AppConfigModal />
        </>
    );
}
