import { useEffect, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { AuthProvider } from "@/components/auth/auth-context";
import { clearCloudAssetDownloadUrlCache } from "@/services/api/assets";
import { getCurrentSession, listProjects, logout as logoutRequest, PlatformApiError, type AuthSession } from "@/services/api/platform";

export function AuthGate({ children }: { children: ReactNode }) {
    const location = useLocation();
    const [session, setSession] = useState<AuthSession | null>(null);
    const [state, setState] = useState<"loading" | "ready" | "signed-out" | "error">("loading");
    const [shellReady, setShellReady] = useState(false);

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
        if (!session) return;
        const controller = new AbortController();
        let unsubscribe: (() => void) | undefined;
        void Promise.all([import("@/stores/canvas/use-canvas-store"), listProjects(controller.signal)])
            .then(([{ useCanvasStore }, projects]) => {
                if (controller.signal.aborted) return;
                const sync = () => {
                    const store = useCanvasStore.getState();
                    if (!store.hydrated) return false;
                    const workspaces = projects.some((project) => project.projectId === session.workspace.projectId) ? projects : [{ ...session.workspace, role: "owner" }, ...projects];
                    store.syncProjectShells(workspaces);
                    setShellReady(true);
                    return true;
                };
                if (sync()) return;
                unsubscribe = useCanvasStore.subscribe((store) => {
                    if (!store.hydrated) return;
                    const stop = unsubscribe;
                    unsubscribe = undefined;
                    stop?.();
                    sync();
                });
            })
            .catch((error) => {
                if (controller.signal.aborted) return;
                setState(error instanceof PlatformApiError && error.status === 401 ? "signed-out" : "error");
            });
        return () => {
            controller.abort();
            unsubscribe?.();
        };
    }, [session]);

    useEffect(() => {
        if (!session) return;
        const controller = new AbortController();
        void Promise.all([import("@/services/api/image"), import("@/stores/use-config-store")])
            .then(async ([{ fetchManagedModelCatalog }, configModule]) => {
                const { encodeChannelModel, modelMatchesCapability, modelOptionsFromChannels, useConfigStore } = configModule;
                const current = useConfigStore.getState().config;
                const managed = current.channels.find((channel) => channel.managed);
                if (!managed) return;
                const models = await fetchManagedModelCatalog(managed, controller.signal);
                if (controller.signal.aborted || !models.length) return;
                const latest = useConfigStore.getState().config;
                const channels = latest.channels.map((channel) => (channel.managed ? { ...channel, models } : channel));
                const next = { ...latest, channels, models: modelOptionsFromChannels(channels) };
                const managedChannel = channels.find((channel) => channel.managed);
                const modelFor = (capability: "image" | "video" | "text" | "audio", currentModel: string) => {
                    if (modelMatchesCapability(next, currentModel, capability)) return currentModel;
                    const first = managedChannel?.models.find((model) => model.capability === capability);
                    return first && managedChannel ? encodeChannelModel(managedChannel.id, first.name) : currentModel;
                };
                useConfigStore.setState({
                    config: {
                        ...next,
                        imageModel: modelFor("image", latest.imageModel),
                        videoModel: modelFor("video", latest.videoModel),
                        textModel: modelFor("text", latest.textModel),
                        audioModel: modelFor("audio", latest.audioModel),
                    },
                });
            })
            .catch((error) => {
                if (!controller.signal.aborted) console.warn("Managed model catalog sync failed", error);
            });
        return () => controller.abort();
    }, [session]);

    if (state === "loading" || (state === "ready" && !shellReady)) return <FullScreenStatus text="正在进入工作台…" />;
    if (state === "signed-out") return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
    if (state === "error" || !session) return <FullScreenStatus text="账号服务暂时不可用，请稍后刷新页面。" />;

    const logout = async () => {
        await logoutRequest();
        clearCloudAssetDownloadUrlCache();
        setSession(null);
        setShellReady(false);
        setState("signed-out");
    };
    return <AuthProvider value={{ ...session, logout }}>{children}</AuthProvider>;
}

function FullScreenStatus({ text }: { text: string }) {
    return <main className="flex h-dvh items-center justify-center bg-background px-6 text-center text-sm text-stone-500 dark:text-stone-400">{text}</main>;
}
