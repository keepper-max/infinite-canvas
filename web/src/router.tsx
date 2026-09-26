import { createBrowserRouter, Navigate, Outlet } from "react-router-dom";
import { lazy, Suspense, type ReactNode } from "react";

import { AnalyticsTracker } from "@/components/layout/analytics-tracker";
import { AuthGate } from "@/components/auth/auth-gate";
import { useAuth } from "@/components/auth/auth-context";
import { RouteErrorPage } from "@/components/layout/route-error-page";
import { routeModules } from "@/lib/route-modules";
import UserLayout from "@/layouts/user-layout";
const AssetsPage = lazy(routeModules.assets);
const AuthPage = lazy(routeModules.auth);
const CanvasPage = lazy(routeModules.canvas);
const CanvasProjectPage = lazy(routeModules.canvasProject);
const ConfigPage = lazy(routeModules.config);
const HomePage = lazy(routeModules.home);
const ImagePage = lazy(routeModules.image);
const NotFound = lazy(routeModules.notFound);
const PromptsPage = lazy(routeModules.prompts);
const VideoPage = lazy(routeModules.video);
const TextWorkbenchPage = lazy(routeModules.text);
const WorkspaceEntryPage = lazy(routeModules.workspaceEntry);
const OperationsPage = lazy(routeModules.operations);
const AdminPage = lazy(routeModules.admin);
const CreditsPage = lazy(routeModules.credits);

function deferred(element: ReactNode) {
    return <Suspense fallback={<div className="grid min-h-dvh place-items-center text-sm text-muted-foreground">正在加载</div>}>{element}</Suspense>;
}

function AdminRoute() {
    const { user } = useAuth();
    if (!user.isAdmin) return <Navigate to="/canvas" replace />;
    return deferred(<AdminPage />);
}

export const router = createBrowserRouter([
    { path: "/login", element: deferred(<AuthPage mode="login" />), errorElement: <RouteErrorPage /> },
    { path: "/register", element: deferred(<AuthPage mode="register" />), errorElement: <RouteErrorPage /> },
    { path: "/forgot-password", element: deferred(<AuthPage mode="forgot-password" />), errorElement: <RouteErrorPage /> },
    {
        element: (
            <AuthGate>
                <UserLayout>
                    <AnalyticsTracker />
                    <Outlet />
                </UserLayout>
            </AuthGate>
        ),
        errorElement: <RouteErrorPage />,
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
                <AdminRoute />
            </AuthGate>
        ),
        errorElement: <RouteErrorPage />,
    },
    { path: "*", element: deferred(<NotFound />), errorElement: <RouteErrorPage /> },
]);
