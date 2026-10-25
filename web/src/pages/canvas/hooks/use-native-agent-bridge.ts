import { useEffect, useRef } from "react";
import { useNativeAgentStore, type AgentCanvasDiff } from "@/stores/use-native-agent-store";
export function useNativeAgentBridge(projectId: string, refresh: () => Promise<{ revision: number; nodeCount: number; edgeCount: number }>, focus: (ids: string[]) => void, compare: () => Promise<AgentCanvasDiff>, keepDraft: () => Promise<void>) {
    const current = useRef({ refresh, focus, compare, keepDraft });
    current.current = { refresh, focus, compare, keepDraft };
    useEffect(() => {
        const bridge = {
            projectId,
            sync: () => current.current.refresh(),
            focus: (ids: string | string[]) => current.current.focus(Array.isArray(ids) ? ids : [ids]),
            compare: () => current.current.compare(),
            keepDraft: () => current.current.keepDraft(),
        };
        useNativeAgentStore.getState().setBridge(bridge);
        return () => {
            if (useNativeAgentStore.getState().bridge === bridge) useNativeAgentStore.getState().setBridge(null);
        };
    }, [projectId]);
}
