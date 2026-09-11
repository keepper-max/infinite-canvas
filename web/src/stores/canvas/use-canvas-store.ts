import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import i18n from "@/i18n";
import { localForageStorage } from "@/lib/localforage-storage";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";
import { createProject as createProjectRequest, deleteProject as deleteProjectRequest, listProjects, updateProject as updateProjectRequest, type ProjectSummary, type Workspace } from "@/services/api/platform";
import { createCanvasDraft, saveCanvas } from "@/services/api/canvas";

export type CanvasProject = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    viewport: ViewportTransform;
    role?: string;
    isDefault?: boolean;
};

export type CanvasDeletedProject = {
    id: string;
    deletedAt: string;
};

type CanvasStore = {
    hydrated: boolean;
    projects: CanvasProject[];
    legacyProjects: CanvasProject[];
    deletedProjects: CanvasDeletedProject[];
    createProject: (title?: string) => Promise<string>;
    ensureProjectShell: (workspace: Workspace) => string;
    syncProjectShells: (workspaces: ProjectSummary[]) => void;
    importProject: (project: Partial<CanvasProject>) => Promise<string>;
    openProject: (id: string) => CanvasProject | null;
    renameProject: (id: string, title: string) => Promise<void>;
    deleteProjects: (ids: string[]) => Promise<Workspace>;
    replaceProjects: (projects: CanvasProject[], deletedProjects?: CanvasDeletedProject[]) => void;
    updateProject: (id: string, patch: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport">>) => void;
};

const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 };
const CANVAS_STORE_KEY = "infinite-canvas:canvas_store";
type PersistedCanvasState = Pick<CanvasStore, "projects" | "legacyProjects" | "deletedProjects">;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let queuedPersistState: PersistedCanvasState | null = null;

const canvasStorage: PersistStorage<CanvasStore> = {
    getItem: async (name) => {
        const value = await localForageStorage.getItem(name);
        if (!value) return null;
        const parsed = JSON.parse(value) as StorageValue<CanvasStore>;
        queuedPersistState = parsed.state as PersistedCanvasState;
        return parsed;
    },
    setItem: (name, value) => {
        const nextState = value.state as PersistedCanvasState;
        if (queuedPersistState && queuedPersistState.projects === nextState.projects && queuedPersistState.deletedProjects === nextState.deletedProjects) return;
        queuedPersistState = nextState;
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            saveTimer = null;
            void localForageStorage.setItem(name, JSON.stringify(value));
        }, 400);
    },
    removeItem: (name) => localForageStorage.removeItem(name),
};

export const useCanvasStore = create<CanvasStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            projects: [],
            legacyProjects: [],
            deletedProjects: [],
            createProject: async (title = i18n.t("canvas.project.untitled")) => {
                const workspace = await createProjectRequest(title);
                return get().ensureProjectShell(workspace);
            },
            ensureProjectShell: (workspace) => {
                const existing = get().projects.find((project) => project.id === workspace.projectId);
                if (existing) {
                    set((state) => ({
                        projects: state.projects.map((project) =>
                            project.id === workspace.projectId
                                ? { ...project, title: workspace.projectTitle, updatedAt: workspace.updatedAt, role: "role" in workspace && typeof workspace.role === "string" ? workspace.role : project.role, isDefault: workspace.isDefault }
                                : project,
                        ),
                    }));
                    return existing.id;
                }
                const project: CanvasProject = {
                    id: workspace.projectId,
                    title: workspace.projectTitle,
                    createdAt: workspace.updatedAt,
                    updatedAt: workspace.updatedAt,
                    nodes: [],
                    connections: [],
                    chatSessions: [],
                    activeChatId: null,
                    backgroundMode: "lines",
                    showImageInfo: false,
                    viewport: initialViewport,
                    role: "role" in workspace && typeof workspace.role === "string" ? workspace.role : "owner",
                    isDefault: workspace.isDefault,
                };
                set((state) => ({ projects: [project, ...state.projects] }));
                return project.id;
            },
            syncProjectShells: (workspaces) =>
                set((state) => {
                    const serverIds = new Set(workspaces.map((workspace) => workspace.projectId));
                    const existing = new Map(state.projects.map((project) => [project.id, project]));
                    const projects = workspaces.map((workspace) => projectFromWorkspace(workspace, existing.get(workspace.projectId)));
                    const legacyProjects = [...(state.legacyProjects || []), ...state.projects.filter((project) => !serverIds.has(project.id))].filter((project, index, all) => all.findIndex((candidate) => candidate.id === project.id) === index);
                    return { projects, legacyProjects };
                }),
            importProject: async (source) => {
                const now = new Date().toISOString();
                const workspace = await createProjectRequest(source.title || i18n.t("canvas.project.imported"));
                const project: CanvasProject = {
                    id: workspace.projectId,
                    title: workspace.projectTitle,
                    createdAt: source.createdAt || now,
                    updatedAt: workspace.updatedAt,
                    nodes: source.nodes || [],
                    connections: source.connections || [],
                    chatSessions: source.chatSessions || [],
                    activeChatId: source.activeChatId || null,
                    backgroundMode: source.backgroundMode || "lines",
                    showImageInfo: source.showImageInfo || false,
                    viewport: source.viewport || initialViewport,
                    role: workspace.role,
                    isDefault: workspace.isDefault,
                };
                try {
                    await saveCanvas(project.id, createCanvasDraft(project.nodes, project.connections, project.viewport, { backgroundMode: project.backgroundMode, showImageInfo: project.showImageInfo }), 0);
                } catch (error) {
                    await deleteProjectRequest(project.id).catch(() => undefined);
                    throw error;
                }
                set((state) => ({ projects: [project, ...state.projects] }));
                return project.id;
            },
            openProject: (id) => {
                return get().projects.find((item) => item.id === id) || null;
            },
            renameProject: async (id, title) => {
                const workspace = await updateProjectRequest(id, { name: title });
                get().ensureProjectShell(workspace);
            },
            deleteProjects: async (ids) => {
                const owned = new Set(get().projects.filter((project) => project.role === "owner").map((project) => project.id));
                if (ids.some((id) => !owned.has(id))) throw new Error("只有项目所有者可以删除项目");
                let workspace: Workspace | null = null;
                for (const id of ids) workspace = (await deleteProjectRequest(id)).workspace;
                if (!workspace) throw new Error("没有可删除的项目");
                get().syncProjectShells(await listProjects());
                return workspace;
            },
            replaceProjects: (projects, deletedProjects = []) => set({ legacyProjects: projects, deletedProjects }),
            updateProject: (id, patch) =>
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id ? { ...project, ...patch, updatedAt: new Date().toISOString() } : project)),
                })),
        }),
        {
            name: CANVAS_STORE_KEY,
            storage: canvasStorage,
            partialize: (state) =>
                ({
                    projects: state.projects,
                    legacyProjects: state.legacyProjects,
                    deletedProjects: state.deletedProjects,
                }) as StorageValue<CanvasStore>["state"],
            onRehydrateStorage: () => () => {
                useCanvasStore.setState({ hydrated: true });
            },
        },
    ),
);

function projectFromWorkspace(workspace: ProjectSummary, existing?: CanvasProject): CanvasProject {
    return {
        id: workspace.projectId,
        title: workspace.projectTitle,
        createdAt: existing?.createdAt || workspace.updatedAt,
        updatedAt: workspace.updatedAt,
        nodes: existing?.nodes || [],
        connections: existing?.connections || [],
        chatSessions: existing?.chatSessions || [],
        activeChatId: existing?.activeChatId || null,
        backgroundMode: existing?.backgroundMode || "lines",
        showImageInfo: existing?.showImageInfo || false,
        viewport: existing?.viewport || initialViewport,
        role: workspace.role,
        isDefault: workspace.isDefault,
    };
}
