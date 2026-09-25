import { createBrowserRouter, Outlet } from "react-router-dom";
import { lazy, Suspense, type ReactNode } from "react";

import { AnalyticsTracker } from "@/components/layout/analytics-tracker";
import { AuthGate } from "@/components/auth/auth-gate";
import UserLayout from "@/layouts/user-layout";
const AssetsPage = lazy(() => import("@/pages/assets"));
const AuthPage = lazy(() => import("@/pages/auth"));
const CanvasPage = lazy(() => import("@/pages/canvas"));
const CanvasProjectPage = lazy(() => import("@/pages/canvas/project"));
const ConfigPage = lazy(() => import("@/pages/config"));
const HomePage = lazy(() => import("@/pages/home"));
const ImagePage = lazy(() => import("@/pages/image"));
const NotFound = lazy(() => import("@/pages/not-found"));
const PromptsPage = lazy(() => import("@/pages/prompts"));
const VideoPage = lazy(() => import("@/pages/video"));
const TextWorkbenchPage = lazy(() => import("@/pages/text"));
const WorkspaceEntryPage = lazy(() => import("@/pages/workspace-entry"));
const OperationsPage = lazy(() => import("@/pages/operations"));
const AdminPage = lazy(() => import("@/pages/admin"));
const CreditsPage = lazy(() => import("@/pages/credits"));

function deferred(element: ReactNode) {
    return <Suspense fallback={<div className="grid min-h-dvh place-items-center text-sm text-muted-foreground">正在加载</div>}>{element}</Suspense>;
}

export const router = createBrowserRouter([
    { path: "/login", element: deferred(<AuthPage mode="login" />) },
    { path: "/register", element: deferred(<AuthPage mode="register" />) },
    {
        element: (
            <AuthGate>
                <UserLayout>
                    <AnalyticsTracker />
                    <Outlet />
                </UserLayout>
            </AuthGate>
        ),
        children: [
            { path: "/", element: deferred(<WorkspaceEntryPage />) },
            { path: "/home", element: deferred(<HomePage />) },
            { path: "/image", element: deferred(<ImagePage />) },
            { path: "/video", element: deferred(<VideoPage />) },
            { path: "/text", element: deferred(<TextWorkbenchPage />) },
            { path: "/assets", element: deferred(<AssetsPage />) },
            { path: "/prompts", element: deferred(<PromptsPage />) },
            { path: "/canvas", element: deferred(<CanvasPage />) },
            { path: "/canvas/:id", element: deferred(<CanvasProjectPage />) },
            { path: "/config", element: deferred(<ConfigPage />) },
            { path: "/operations", element: deferred(<OperationsPage />) },
            { path: "/credits", element: deferred(<CreditsPage />) },
        ],
    },
    {
        path: "/admin/:section?/:subsection?",
        element: (
            <AuthGate>
                {deferred(<AdminPage />)}
            </AuthGate>
        ),
    },
    { path: "*", element: deferred(<NotFound />) },
]);
