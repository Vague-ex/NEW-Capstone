import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router';
import Image from 'next/image';
import {
  GraduationCap, LayoutDashboard, LogOut,
  BarChart2, Map, Upload,
  ChevronRight, Bell, Shield, Star, Briefcase,
  ClipboardCheck, CheckCircle2, Menu, UserCircle,
  Settings, UserCheck,
} from 'lucide-react';
import { ADMIN_ACCESS_TOKEN_KEY, fetchPendingAlumni, fetchProfileReviewAlumni } from '../../app/api-client';
const schoolLogo = '/CHMSULogo.png';

type PortalRole = 'alumni' | 'admin';

interface NavItem {
  label: string;
  path: string;
  icon: React.ElementType;
}

const NAV_CONFIG: Record<PortalRole, NavItem[]> = {
  alumni: [
    { label: 'Dashboard', path: '/alumni/dashboard', icon: LayoutDashboard },
    { label: 'My Skills', path: '/alumni/skills', icon: Star },
    { label: 'Employment', path: '/alumni/employment', icon: Briefcase },
    { label: 'Edit Profile', path: '/alumni/profile', icon: UserCircle },
  ],
  admin: [
    { label: 'Dashboard', path: '/admin/dashboard', icon: LayoutDashboard },
    { label: 'Pending Verification', path: '/admin/unverified', icon: ClipboardCheck },
    { label: 'Verified Graduates', path: '/admin/verified', icon: CheckCircle2 },
    { label: 'Batch Upload', path: '/admin/batch-upload', icon: Upload },
    { label: 'Geomapping', path: '/admin/map', icon: Map },
    { label: 'Analytics & Reports', path: '/admin/analytics', icon: BarChart2 },
    { label: 'Settings', path: '/admin/settings', icon: Settings }, // import Settings from lucide-react
  ],
};

const ROLE_CONFIG = {
  alumni: {
    label: 'Graduate Portal',
    color: 'from-[#166534] to-[#14532d]',
    accent: 'bg-emerald-500',
    logoutPath: '/',
    sessionKey: 'alumni_user',
    username: 'BSIS Graduate',
    subtitle: 'Carlos Hilado Memorial State University · BSIS',
  },
  admin: {
    label: 'Admin Portal',
    color: 'from-[#14532d] to-[#052e16]',
    accent: 'bg-lime-500',
    logoutPath: '/',
    sessionKey: 'admin_authenticated',
    username: 'BSIS Admin',
    subtitle: 'CHMSU BSIS · Admin',
  },
};

interface PortalLayoutProps {
  role: PortalRole;
  children: React.ReactNode;
  pageTitle?: string;
  pageSubtitle?: string;
  notificationCount?: number;
}


export function PortalLayout({ role, children, pageTitle, pageSubtitle, notificationCount = 0 }: PortalLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pendingAlumniCount, setPendingAlumniCount] = useState(0);
  const [profileReviewCount, setProfileReviewCount] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const notifButtonRef = useRef<HTMLButtonElement>(null);
  const notifDropdownRef = useRef<HTMLDivElement>(null);
  const lastKnownAdminPendingRef = useRef<number | null>(null);
  const notificationAudioRef = useRef<HTMLAudioElement | null>(null);

  const nav = NAV_CONFIG[role];
  const config = ROLE_CONFIG[role];

  // Get display name from session
  let displayName = config.username;
  let displaySub = config.subtitle;
  try {
    if (role === 'alumni') {
      const u = JSON.parse(sessionStorage.getItem('alumni_user') || '{}');
      if (u.name) displayName = u.name.split(' ')[0];
      if (u.schoolId) displaySub = `ID: ${u.schoolId}`;
    }
  } catch { /* noop */ }

  useEffect(() => {
    if (role !== 'admin') return;

    const audio = new Audio('/notification.mp3');
    audio.preload = 'auto';
    audio.load();
    notificationAudioRef.current = audio;

    // Browsers block audio.play() until the user has interacted with the page.
    // Unlock the element on the first pointer/key event so subsequent
    // notification chimes can play without a NotAllowedError.
    const unlock = () => {
      audio
        .play()
        .then(() => {
          audio.pause();
          audio.currentTime = 0;
        })
        .catch((err) => {
          if (process.env.NODE_ENV !== 'production') {
            console.warn('[notification] unlock blocked:', err);
          }
        });
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });

    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      notificationAudioRef.current = null;
    };
  }, [role]);

  useEffect(() => {
    if (role !== 'admin') return;

    const sessionKey = 'admin_last_pending_total';
    const storedTotal = Number(sessionStorage.getItem(sessionKey));
    if (!Number.isNaN(storedTotal)) {
      lastKnownAdminPendingRef.current = storedTotal;
    }

    let active = true;
    const updateAdminNotificationCount = async () => {
      try {
        const [pendingAlumni, profileReview] = await Promise.all([
          fetchPendingAlumni(),
          // A failed review fetch must not blank the pending count too.
          fetchProfileReviewAlumni().catch(() => [] as unknown[]),
        ]);
        if (!active) return;

        // Employer requests no longer exist — employers verify by one-time
        // link and never await approval. The bell counts graduates waiting on
        // approval plus masterlist matches waiting on a profile check.
        const totalPending = pendingAlumni.length + profileReview.length;
        setPendingAlumniCount(pendingAlumni.length);
        setProfileReviewCount(profileReview.length);

        const previousTotal = lastKnownAdminPendingRef.current;
        if (previousTotal !== null && totalPending > previousTotal && notificationAudioRef.current) {
          notificationAudioRef.current.currentTime = 0;
          void notificationAudioRef.current.play().catch((err) => {
            if (process.env.NODE_ENV !== 'production') {
              console.warn('[notification] play failed:', err);
            }
          });
        }

        lastKnownAdminPendingRef.current = totalPending;
        sessionStorage.setItem(sessionKey, String(totalPending));
      } catch {
        if (!active) return;
      }
    };

    void updateAdminNotificationCount();
    const intervalId = window.setInterval(() => {
      void updateAdminNotificationCount();
    }, 30000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [role]);

  // Close bell dropdown on outside click
  useEffect(() => {
    if (!notifOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (
        notifDropdownRef.current && !notifDropdownRef.current.contains(e.target as Node) &&
        notifButtonRef.current && !notifButtonRef.current.contains(e.target as Node)
      ) {
        setNotifOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [notifOpen]);

  const handleLogout = () => {
    sessionStorage.removeItem(config.sessionKey);
    sessionStorage.removeItem(ADMIN_ACCESS_TOKEN_KEY);
    navigate(config.logoutPath);
  };

  const bellNotificationCount = role === 'admin'
    ? pendingAlumniCount + profileReviewCount
    : notificationCount;

  const RoleIcon = role === 'admin' ? Shield : GraduationCap;

  // Called as a function, never rendered as a <SidebarContent /> element. A component
  // defined inside render is a new type on every render, so React remounted
  // the whole sidebar on each keystroke in the page and replayed its
  // gt-stagger entrance animation: the "flickering sidebar" (invisible on
  // machines with reduced motion, which disables that animation).
  const renderSidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className={`p-5 bg-gradient-to-b ${config.color} border-b border-white/10`}>
        <div className="flex items-center gap-3">
          <Image
            src={schoolLogo}
            alt="CHMSU Logo"
            width={40}
            height={40}
            className="size-10 object-contain shrink-0"
          />
          <div className="min-w-0">
            <p className="text-white text-sm leading-tight" style={{ fontWeight: 700 }}>Carlos Hilado Memorial State University</p>
            <p className="text-white/50 text-xs truncate mt-0.5">BSIS Graduate Tracer</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="gt-stagger flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        <p className="text-white/30 text-xs px-3 mb-2 tracking-widest uppercase" style={{ fontWeight: 600 }}>
          {config.label}
        </p>
        {nav.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <button
              key={item.path}
              onClick={() => { navigate(item.path); setSidebarOpen(false); }}
              className={`gt-bubble w-full flex items-center gap-3 px-3 py-3 lg:py-2.5 rounded-xl text-sm transition-colors duration-150 ${isActive
                ? 'bg-white/20 text-white shadow-sm'
                : 'text-white/60 hover:text-white'
                }`}
              style={{ fontWeight: isActive ? 600 : 400 }}
            >
              <item.icon className={`size-4 shrink-0 ${isActive ? 'text-white' : 'text-white/50'}`} />
              <span className="flex-1 text-left text-sm">{item.label}</span>
              {isActive && <ChevronRight className="size-3 text-white/60 shrink-0" />}
              {/* Per-item notification badges */}
              {/* Pending Verification covers both tabs: not on masterlist + masterlist matches. */}
              {item.path === '/admin/unverified' && pendingAlumniCount + profileReviewCount > 0 && !isActive && (
                <span className="flex h-4 min-w-4 px-1 items-center justify-center rounded-full bg-red-500 text-white shrink-0" style={{ fontSize: '10px', fontWeight: 700 }}>
                  {pendingAlumniCount + profileReviewCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* User + Logout */}
      <div className="p-3 border-t border-white/10">
        <div className="flex items-center gap-3 px-2 py-2 rounded-xl mb-1">
          <div className={`flex size-8 shrink-0 items-center justify-center rounded-full ${config.accent}`}>
            <RoleIcon className="size-4 text-white" />
          </div>
          <div className="min-w-0">
            <p className="text-white text-xs truncate" style={{ fontWeight: 600 }}>{displayName}</p>
            <p className="text-white/40 text-xs truncate">{displaySub}</p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-white/50 hover:text-white hover:bg-white/10 text-sm transition"
        >
          <LogOut className="size-4" />
          Sign Out
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {/* Desktop Sidebar */}
      <aside className={`hidden lg:flex flex-col w-60 bg-gradient-to-b ${config.color} shrink-0`}>
        {renderSidebarContent()}
      </aside>

      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
          <aside className={`relative z-10 flex flex-col w-64 bg-gradient-to-b ${config.color}`}>
            {renderSidebarContent()}
          </aside>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Topbar */}
        <header className="bg-white border-b border-gray-100 px-4 lg:px-6 2xl:px-8 h-14 flex items-center justify-between gap-3 shrink-0 shadow-sm">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <button
              onClick={() => setSidebarOpen(true)}
              aria-label="Open menu"
              className="lg:hidden -ml-2 flex size-11 shrink-0 items-center justify-center rounded-lg hover:bg-gray-100 transition"
            >
              <Menu className="size-5 text-gray-600" />
            </button>
            {pageTitle && (
              // One line each: a wrapped subtitle overflowed the 56px bar on phones.
              <div className="min-w-0">
                <h1 className="text-gray-900 text-sm truncate" style={{ fontWeight: 700 }}>{pageTitle}</h1>
                {pageSubtitle && <p className="text-gray-400 text-xs truncate">{pageSubtitle}</p>}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {role !== 'alumni' && (
              <div className="relative">
                <button
                  ref={notifButtonRef}
                  onClick={() => setNotifOpen(o => !o)}
                  className="relative flex size-10 items-center justify-center rounded-lg hover:bg-gray-100 transition"
                  aria-label="Notifications"
                >
                  <Bell className="size-4 text-gray-500" />
                  {bellNotificationCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-red-500 text-white" style={{ fontSize: '9px', fontWeight: 700 }}>
                      {bellNotificationCount}
                    </span>
                  )}
                </button>

                {/* Bell dropdown */}
                {notifOpen && (
                  <div ref={notifDropdownRef} className="absolute right-0 top-full mt-2 w-72 max-w-[calc(100vw-2rem)] bg-white rounded-xl border border-gray-200 shadow-lg z-50 overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-100">
                      <p className="text-gray-800 text-sm" style={{ fontWeight: 600 }}>Notifications</p>
                    </div>
                    {pendingAlumniCount + profileReviewCount === 0 ? (
                      <div className="px-4 py-5 text-center text-gray-400 text-xs">No pending items</div>
                    ) : (
                      <div>
                        {pendingAlumniCount > 0 && (
                          <button
                            onClick={() => { navigate('/admin/unverified'); setNotifOpen(false); }}
                            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition text-left"
                          >
                            <span className="flex size-8 items-center justify-center rounded-full bg-amber-100 shrink-0">
                              <UserCheck className="size-4 text-amber-600" />
                            </span>
                            <div>
                              <p className="text-gray-800 text-xs" style={{ fontWeight: 600 }}>{pendingAlumniCount} Graduates Pending Verification</p>
                              <p className="text-gray-400 text-xs">Awaiting face recognition review</p>
                            </div>
                          </button>
                        )}
                        {profileReviewCount > 0 && (
                          <button
                            onClick={() => { navigate('/admin/unverified?tab=review'); setNotifOpen(false); }}
                            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition text-left"
                          >
                            <span className="flex size-8 items-center justify-center rounded-full bg-emerald-100 shrink-0">
                              <UserCheck className="size-4 text-emerald-600" />
                            </span>
                            <div>
                              <p className="text-gray-800 text-xs" style={{ fontWeight: 600 }}>{profileReviewCount} Profiles to Review</p>
                              <p className="text-gray-400 text-xs">Masterlist matches already signed in</p>
                            </div>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            <div className={`flex size-8 items-center justify-center rounded-full ${config.accent} lg:hidden`}>
              <RoleIcon className="size-4 text-white" />
            </div>
          </div>
        </header>

        {/* Scrollable content */}
        {/* Pages fill the width on desktop (dashboards should be fluid); the
            1800px cap only engages on ultra-wide monitors, where lines and
            charts would otherwise stretch past comfortable reading width. */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6 2xl:p-8">
          <div className="mx-auto w-full max-w-[1800px]">{children}</div>
        </main>
      </div>
    </div>
  );
}