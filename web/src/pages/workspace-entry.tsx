import { Navigate, useLocation } from "react-router-dom";

import { useAuth } from "@/components/auth/auth-context";

export default function WorkspaceEntryPage() {
    const { workspace } = useAuth();
    const { pathname } = useLocation();
    return <Navigate to={`/canvas/${workspace.projectId}${pathname === "/pose-costume" ? "?open=pose-costume" : ""}`} replace />;
}
