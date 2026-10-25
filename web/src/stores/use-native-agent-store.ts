import { create } from "zustand";
export type AgentCanvasDiff={revision:number;hasDraft:boolean;localNodeCount:number;remoteNodeCount:number;addedNodes:{id:string;title:string;type:string}[];changedNodes:{id:string;title:string}[]};
type State = { open: boolean; width: number; bridge: null | { projectId: string; sync: () => Promise<{revision:number;nodeCount:number;edgeCount:number}>; focus: (ids: string|string[]) => void; compare:()=>Promise<AgentCanvasDiff>; keepDraft:()=>Promise<void> }; toggle: () => void; setWidth: (width: number) => void; setBridge: (bridge: State["bridge"]) => void };
export const useNativeAgentStore = create<State>((set) => ({
    open: false,
    width: Math.min(760,Math.max(360,Number(localStorage.getItem("native-agent-width")) || 440)),
    bridge: null,
    toggle: () => set((s) => ({ open: !s.open })),
    setWidth: (next) => {
        const width=Number.isFinite(next)?Math.min(760,Math.max(360,next)):440;
        localStorage.setItem("native-agent-width", String(width));
        set({ width });
    },
    setBridge: (bridge) => set({ bridge }),
}));
