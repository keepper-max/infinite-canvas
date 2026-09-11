import { useEffect, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { AuthProvider } from "@/components/auth/auth-context";
import { getCurrentSession, listProjects, logout as logoutRequest, PlatformApiError, type AuthSession } from "@/services/api/platform";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";

export function AuthGate({ children }: { children: ReactNode }) {
    const location = useLocation();
    const [session, setSession] = useState<AuthSession | null>(null);
    const [state, setState] = useState<"loading" | "ready" | "signed-out" | "error">("loading");
    const [shellReady, setShellReady] = useState(false);
    const hydrated = useCanvasStore((store) => store.hydrated);

    useEffect(() => {
        const controller = new AbortController();
        void getCurrentSession(controller.signal)
            .then((next) => {
                setSession(next);
                setState("ready");
            })
            .catch((error) => {
                if (controller.signal.aborted) return;
                setState(error instanceof PlatformApiError && error.status === 401 ? "signed-out" : "error");
            });
        return () => controller.abort();
    }, []);

    useEffect(() => {
        if (!hydrated || !session) return;
        const controller = new AbortController();
        void listProjects(controller.signal)
            .then((projects) => {
                const store = useCanvasStore.getState();
                const workspaces = projects.some((project) => project.projectId === session.workspace.projectId) ? projects : [{ ...session.workspace, role: "owner" }, ...projects];
                store.syncProjectShells(workspaces);
                setShellReady(true);
            })
            .catch((error) => {
                if (controller.signal.aborted) return;
                setState(error instanceof PlatformApiError && error.status === 401 ? "signed-out" : "error");
            });
        return () => controller.abort();
    }, [hydrated, session]);

    if (state === "loading" || (state === "ready" && (!hydrated || !shellReady))) return <FullScreenStatus text="正在进入工作台…" />;
    if (state === "signed-out") return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
    if (state === "error" || !session) return <FullScreenStatus text="账号服务暂时不可用，请稍后刷新页面。" />;

    const logout = async () => {
        await logoutRequest();
        setSession(null);
        setShellReady(false);
        setState("signed-out");
    };
    return <AuthProvider value={{ ...session, logout }}>{children}</AuthProvider>;
}

function FullScreenStatus({ text }: { text: string }) {
    return <main className="flex h-dvh items-center justify-center bg-background px-6 text-center text-sm text-stone-500 dark:text-stone-400">{text}</main>;
}
