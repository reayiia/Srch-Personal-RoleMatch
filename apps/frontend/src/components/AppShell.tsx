import {Bookmark, BriefcaseBusiness, ClipboardList, Home, LogOut, Search, User, Sun, Moon} from 'lucide-react';import {NavLink, Outlet, useNavigate} from 'react-router-dom';
import {useEffect, useMemo, useState} from 'react';
import {API_BASE_URL} from '../api/client';
import { useTheme } from '../hooks/useTheme';

const navItems = [
    {to: '/', label: 'Home', icon: Home},
    {to: '/jobs', label: 'Job search', icon: Search},
    {to: '/applications', label: 'Application tracker', icon: ClipboardList},
    {to: '/saved', label: 'Saved jobs', icon: Bookmark},
    {to: '/profile', label: 'Profile', icon: User},
];

interface ShellProfile {
    fullName: string;
    education: string | null;
    location: string | null;
    targetRoles?: string[] | null;
    avatarUrl?: string | null;
}

function initialsFor(name: string) {
    return name
        .split(' ')
        .map((part) => part[0])
        .filter(Boolean)
        .slice(0, 2)
        .join('')
        .toUpperCase() || 'RM';
}

export function AppShell() {
    const navigate = useNavigate();
    const [profile, setProfile] = useState<ShellProfile | null>(null);
    const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);
    const { theme, toggleTheme } = useTheme();

    useEffect(() => {
        const token = localStorage.getItem('rolematch_token');
        if (!token) return;

        const loadProfile = async () => {
            try {
                const response = await fetch(`${API_BASE_URL}/api/profile`, {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                });

                if (response.ok) {
                    setProfile(await response.json() as ShellProfile);
                }
            } catch {
                setProfile(null);
            }
        };

        void loadProfile();
    }, []);

    const displayName = profile?.fullName?.trim() || 'RoleMatch user';
    const subtitle = useMemo(() => {
        const role = profile?.targetRoles?.find((item) => item.trim())?.trim();
        const location = profile?.location?.trim();

        if (role && location) return `${role} - ${location}`;
        if (role) return role;
        if (location) return location;

        return 'Profile setup';
    }, [profile]);

    const handleLogoutClick = () => {
        setIsLogoutModalOpen(true);
    };

    const confirmLogout = () => {
        localStorage.removeItem('rolematch_token');
        setIsLogoutModalOpen(false);
        navigate('/auth', {replace: true});
    };

    const cancelLogout = () => {
        setIsLogoutModalOpen(false);
    };

    return (
        <div className="app-shell">
          <aside className="sidebar" aria-label="Primary navigation">
            <div className="brand-lockup">
              <div className="brand-mark" aria-hidden="true">
                <BriefcaseBusiness size={19}/>
              </div>
              <div>
                <strong>RoleMatch</strong>
                <span>Job workspace</span>
              </div>
            </div>

            <nav className="nav-list">
              {navItems.map((item) => {
                const Icon = item.icon;

                return (
                    <NavLink
                        key={item.to}
                        to={item.to}
                        className={({isActive}) => `nav-link${isActive ? ' active' : ''}`}
                        end={item.to === '/'}
                    >
                      <Icon size={18} aria-hidden="true"/>
                      <span>{item.label}</span>
                    </NavLink>
                );
              })}
            </nav>

              <div className="sidebar-footer">
                  <button className="mini-profile mini-profile-button" type="button"
                          onClick={() => navigate('/profile')}>
                      <div className="avatar" aria-hidden="true" style={{overflow: 'hidden'}}>
                          {profile?.avatarUrl ? (
                              <img src={`${API_BASE_URL}${profile.avatarUrl}`} alt=""
                                   style={{width: '100%', height: '100%', objectFit: 'cover'}}/>
                          ) : (
                              initialsFor(displayName)
                          )}
                      </div>
                      <div>
                          <strong>{displayName}</strong>
                          <span>{subtitle}</span>
                      </div>
                  </button>

                  <button className="nav-link" type="button" onClick={toggleTheme}>
                      {theme === 'light' ? (
                          <Moon size={18} aria-hidden="true"/>
                      ) : (
                          <Sun size={18} aria-hidden="true"/>
                      )}
                      <span>{theme === 'light' ? 'Dark mode' : 'Light mode'}</span>
                  </button>

                  <button className="nav-link danger" type="button" onClick={handleLogoutClick}>
                      <LogOut size={18} aria-hidden="true"/>
                      <span>Log out</span>
                  </button>
              </div>
          </aside>

            <main className="app-main">
                <Outlet/>
            </main>

            {/* 4. The Modal UI */}
            {isLogoutModalOpen && (
                <div style={styles.modalOverlay}>
                    <div style={styles.modalContent}>
                        <h3 style={{marginTop: 0, fontSize: '1.25rem', color: '#111827'}}>Sign Out</h3>
                        <p style={{color: '#4B5563', marginBottom: '24px', fontSize: '0.95rem'}}>
                            Are you sure you want to log out of your account?
                  </p>

                  <div style={styles.modalActions}>
                    <button
                        type="button"
                        onClick={cancelLogout}
                        style={styles.cancelButton}
                    >
                      Cancel
                    </button>
                    <button
                        type="button"
                        onClick={confirmLogout}
                        style={styles.confirmButton}
                    >
                      Yes, Log Out
                    </button>
                  </div>
                </div>
              </div>
          )}
        </div>
    );
}

// 5. Modal styles attached to the bottom of the file
const styles = {
    modalOverlay: {
        position: 'fixed' as const,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 1000,
    },
    modalContent: {
        backgroundColor: 'white',
        padding: '24px',
        borderRadius: '12px',
        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
        maxWidth: '400px',
        width: '90%',
        textAlign: 'center' as const,
        fontFamily: 'inherit',
    },
    modalActions: {
        display: 'flex',
        justifyContent: 'center',
        gap: '12px',
    },
    cancelButton: {
        padding: '10px 16px',
        backgroundColor: '#f3f4f6', // subtle gray
        border: '1px solid #e5e7eb',
        borderRadius: '6px',
        cursor: 'pointer',
        color: '#374151',
        fontWeight: '500',
        transition: 'background-color 0.2s',
    },
    confirmButton: {
        padding: '10px 16px',
        backgroundColor: '#ef4444', // nice UI red
        border: 'none',
        borderRadius: '6px',
        cursor: 'pointer',
        color: 'white',
        fontWeight: '500',
        transition: 'background-color 0.2s',
    }
};
