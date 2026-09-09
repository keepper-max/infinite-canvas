import { Navigate } from "react-router-dom";

import { useAuth } from "@/components/auth/auth-context";

export default function WorkspaceEntryPage() {
    const { workspace } = useAuth();
    return <Navigate to={`/canvas/${workspace.projectId}`} replace />;
}
