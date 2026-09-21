import { createBrowserRouter, Outlet } from "react-router-dom";

import { AnalyticsTracker } from "@/components/layout/analytics-tracker";
import { AuthGate } from "@/components/auth/auth-gate";
import UserLayout from "@/layouts/user-layout";
import AssetsPage from "@/pages/assets";
import AuthPage from "@/pages/auth";
import CanvasPage from "@/pages/canvas";
import CanvasProjectPage from "@/pages/canvas/project";
import ConfigPage from "@/pages/config";
import HomePage from "@/pages/home";
import ImagePage from "@/pages/image";
import NotFound from "@/pages/not-found";
import PromptsPage from "@/pages/prompts";
import VideoPage from "@/pages/video";
import TextWorkbenchPage from "@/pages/text";
import WorkspaceEntryPage from "@/pages/workspace-entry";
import OperationsPage from "@/pages/operations";
import AdminPage from "@/pages/admin";

export const router = createBrowserRouter([
    { path: "/login", element: <AuthPage mode="login" /> },
    { path: "/register", element: <AuthPage mode="register" /> },
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
            { path: "/", element: <WorkspaceEntryPage /> },
            { path: "/home", element: <HomePage /> },
            { path: "/image", element: <ImagePage /> },
            { path: "/video", element: <VideoPage /> },
            { path: "/text", element: <TextWorkbenchPage /> },
            { path: "/assets", element: <AssetsPage /> },
            { path: "/prompts", element: <PromptsPage /> },
            { path: "/canvas", element: <CanvasPage /> },
            { path: "/canvas/:id", element: <CanvasProjectPage /> },
            { path: "/config", element: <ConfigPage /> },
            { path: "/operations", element: <OperationsPage /> },
        ],
    },
    {
        path: "/admin/:section?/:subsection?",
        element: (
            <AuthGate>
                <AdminPage />
            </AuthGate>
        ),
    },
    { path: "*", element: <NotFound /> },
]);
