import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";

import { AgentPanel } from "@/components/agent/agent-panel";
import { AppTopNav } from "@/components/layout/app-top-nav";
import { CODEX_AGENT_ENABLED } from "@/constant/env";
import { cn } from "@/lib/utils";

const CANVAS_NAV_IDLE_MS = 4_000;

export default function UserLayout({ children }: { children: ReactNode }) {
    const { pathname } = useLocation();
    const canvasProject = /^\/canvas\/[^/]+/.test(pathname);
    const [canvasNavVisible, setCanvasNavVisible] = useState(canvasProject);
    const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const cancelHide = useCallback(() => {
        if (!hideTimerRef.current) return;
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
    }, []);

    const scheduleHide = useCallback(() => {
        cancelHide();
        if (!canvasProject) return;
        hideTimerRef.current = setTimeout(() => setCanvasNavVisible(false), CANVAS_NAV_IDLE_MS);
    }, [cancelHide, canvasProject]);

    const revealCanvasNav = useCallback(() => {
        if (!canvasProject) return;
        setCanvasNavVisible(true);
        scheduleHide();
    }, [canvasProject, scheduleHide]);

    useEffect(() => {
        cancelHide();
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
                    onCanvasPointerEnter={cancelHide}
                    onCanvasPointerLeave={scheduleHide}
                    onRevealCanvasNav={revealCanvasNav}
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
        </div>
    );
}
