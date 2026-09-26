import type { NavigationToolSlug } from "@/constant/navigation-tools";

function cached<T>(loader: () => Promise<T>) {
    let request: Promise<T> | undefined;
    return () => {
        request ??= loader().catch((error) => {
            request = undefined;
            throw error;
        });
        return request;
    };
}

export const routeModules = {
    assets: cached(() => import("@/pages/assets")),
    auth: cached(() => import("@/pages/auth")),
    canvas: cached(() => import("@/pages/canvas")),
    canvasProject: cached(() => import("@/pages/canvas/project")),
    config: cached(() => import("@/pages/config")),
    credits: cached(() => import("@/pages/credits")),
    home: cached(() => import("@/pages/home")),
    image: cached(() => import("@/pages/image")),
    notFound: cached(() => import("@/pages/not-found")),
    operations: cached(() => import("@/pages/operations")),
    prompts: cached(() => import("@/pages/prompts")),
    text: cached(() => import("@/pages/text")),
    video: cached(() => import("@/pages/video")),
    workspaceEntry: cached(() => import("@/pages/workspace-entry")),
    admin: cached(() => import("@/pages/admin")),
};

export function preloadNavigationRoute(slug: NavigationToolSlug) {
    return routeModules[slug]();
}
