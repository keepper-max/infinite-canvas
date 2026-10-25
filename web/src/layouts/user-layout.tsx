import { lazy,Suspense,useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";

import { AgentPanel } from "@/components/agent/agent-panel";
import { AppTopNav } from "@/components/layout/app-top-nav";
import { CODEX_AGENT_ENABLED } from "@/constant/env";
import { cn } from "@/lib/utils";
import { useNativeAgentStore } from "@/stores/use-native-agent-store";
import { useAuth } from "@/components/auth/auth-context";
const NativeAgentPanel=lazy(()=>import("@/components/native-agent/native-agent-panel"));

const CANVAS_NAV_IDLE_MS = 4_000;

export default function UserLayout({ children }: { children: ReactNode }) {
    const {user}=useAuth();
    const nativeAgentOpen=useNativeAgentStore(s=>s.open);
    const { pathname } = useLocation();
    const canvasProject = /^\/canvas\/[^/]+/.test(pathname);
    const [canvasNavVisible, setCanvasNavVisible] = useState(canvasProject);
    const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const navFocusedRef = useRef(false);
    const navHoveredRef = useRef(false);

    const cancelHide = useCallback(() => {
        if (!hideTimerRef.current) return;
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
    }, []);

    const scheduleHide = useCallback(() => {
        cancelHide();
        if (!canvasProject || navFocusedRef.current || navHoveredRef.current) return;
        hideTimerRef.current = setTimeout(() => {
            if (!navFocusedRef.current && !navHoveredRef.current) setCanvasNavVisible(false);
        }, CANVAS_NAV_IDLE_MS);
    }, [cancelHide, canvasProject]);

    const revealCanvasNav = useCallback(() => {
        if (!canvasProject) return;
        setCanvasNavVisible(true);
        scheduleHide();
    }, [canvasProject, scheduleHide]);

    const focusCanvasNav = useCallback(() => {
        navFocusedRef.current = true;
        cancelHide();
        setCanvasNavVisible(true);
    }, [cancelHide]);

    const blurCanvasNav = useCallback(() => {
        navFocusedRef.current = false;
        scheduleHide();
    }, [scheduleHide]);

    useEffect(() => {
        cancelHide();
        navHoveredRef.current = false;
        setCanvasNavVisible(canvasProject);
        if (canvasProject) scheduleHide();
        return cancelHide;
    }, [cancelHide, canvasProject, scheduleHide]);

    return (
        <div className="flex h-dvh overflow-hidden bg-background text-foreground">
            <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
                <AppTopNav
                    canvasProject={canvasProject}
                    canvasVisible={canvasNavVisible}
                    onCanvasPointerEnter={() => { navHoveredRef.current = true; cancelHide(); }}
                    onCanvasPointerLeave={() => { navHoveredRef.current = false; scheduleHide(); }}
                    onRevealCanvasNav={revealCanvasNav}
                    onCanvasFocus={focusCanvasNav}
                    onCanvasBlur={blurCanvasNav}
                />
                <div
                    className={cn(
                        "min-h-0 flex-1 overflow-hidden transition-[padding] duration-300 ease-out motion-reduce:transition-none",
                        canvasProject && canvasNavVisible ? "pt-14" : "pt-0",
                    )}
                >
                    {children}
                </div>
            </div>
            {CODEX_AGENT_ENABLED ? <AgentPanel /> : null}
            {nativeAgentOpen ? <Suspense fallback={<aside className="w-80 p-5" role="status">正在载入创作助手…</aside>}><NativeAgentPanel key={user.id}/></Suspense> : null}
        </div>
    );
}
