import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

import Login from "../../pages/Login";
import { NotFoundCard } from "../../components/NotFoundCard";
import { useAuth } from "../auth/AuthContext";
import { ROUTES } from "../../lib/paths";

// ---------------------------------------------------------------------------
// What the route tree in `routes.tsx` renders. Each element pulls what it needs
// from the query cache itself; none of them knows a path -- those come from
// `lib/paths.ts`, and "back" from the tree through `useBackPath`.
// ---------------------------------------------------------------------------

export function ProtectedRoute({ children }: { children: ReactNode }) {
    const { isAuthenticated } = useAuth();
    if (!isAuthenticated) {
        return <Navigate to={ROUTES.login} replace />;
    }
    return <>{children}</>;
}

export function LoginRoute() {
    const { isAuthenticated } = useAuth();
    return isAuthenticated ? <Navigate to={ROUTES.root} /> : <Login />;
}

export function NotFound() {
    const { pathname } = useLocation();

    return (
        <NotFoundCard title="Page not found" backTo={ROUTES.root} backLabel="Back to the dashboard">
            There is nothing at <code className="font-mono text-sm">{pathname}</code>.
        </NotFoundCard>
    );
}
