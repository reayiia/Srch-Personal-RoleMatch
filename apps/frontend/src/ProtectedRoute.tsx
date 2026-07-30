import { Navigate, Outlet } from 'react-router-dom';

export default function ProtectedRoute() {
    // Check if the browser has our authentication token
    const token = localStorage.getItem('rolematch_token');

    // If there's no token, redirect to the Auth page.
    // 'replace' prevents them from hitting the back button to return to the protected page.
    if (!token) {
        return <Navigate to="/auth" replace />;
    }

    // If they have a token, render whatever component is inside this route
    return <Outlet />;
}