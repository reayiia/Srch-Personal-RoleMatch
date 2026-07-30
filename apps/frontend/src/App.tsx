import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import Auth from './Auth';
import ProtectedRoute from './ProtectedRoute';
import { AppShell } from './components/AppShell';
import { ApplicationsPage } from './pages/ApplicationsPage';
import { DashboardPage } from './pages/DashboardPage';
import { JobSearchPage } from './pages/JobSearchPage';
import { ProfilePage } from './pages/ProfilePage';
import { SavedJobsPage } from './pages/SavedJobsPage';
import './App.css';

function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route path="/auth" element={<Auth />} />
                <Route element={<ProtectedRoute />}>
                    <Route element={<AppShell />}>
                        <Route path="/" element={<DashboardPage />} />
                        <Route path="/jobs" element={<JobSearchPage />} />
                        <Route path="/saved" element={<SavedJobsPage />} />
                        <Route path="/applications" element={<ApplicationsPage />} />
                        <Route path="/profile" element={<ProfilePage />} />
                        <Route path="*" element={<Navigate to="/" replace />} />
                    </Route>
                </Route>
            </Routes>
        </BrowserRouter>
    );
}

export default App;
