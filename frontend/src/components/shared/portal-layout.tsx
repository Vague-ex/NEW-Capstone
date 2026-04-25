import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router';
import Image from 'next/image';
import {
  GraduationCap, LayoutDashboard, LogOut,
  Building2, Search, BarChart2, Map, Upload,
  ChevronRight, Bell, Shield, Star, Briefcase,
  ClipboardCheck, CheckCircle2, Menu, UserCircle,
  Settings,
} from 'lucide-react';
import { ADMIN_ACCESS_TOKEN_KEY, fetchEmployerRequests, fetchPendingAlumni } from '../../app/api-client';
const schoolLogo = '/CHMSULogo.png';

type PortalRole = 'alumni' | 'employer' | 'admin';

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
  employer: [
    { label: 'Dashboard', path: '/employer/dashboard', icon: LayoutDashboard },
    { label: 'Verify Employment', path: '/employer/verify', icon: Search },
  ],
  admin: [
    { label: 'Dashboard', path: '/admin/dashboard', icon: LayoutDashboard },
    { label: 'Pending Verification', path: '/admin/unverified', icon: ClipboardCheck },
    { label: 'Verified Alumni', path: '/admin/verified', icon: CheckCircle2 },
    { label: 'Batch Upload', path: '/admin/batch-upload', icon: Upload },
    { label: 'Employer Requests', path: '/admin/employers', icon: Building2 },
    { label: 'Geomapping', path: '/admin/map', icon: Map },
    { label: 'Analytics & Reports', path: '/admin/analytics', icon: BarChart2 },
    { label: 'Settings', path: '/admin/settings', icon: Settings }, // import Settings from lucide-react
  ],
};

const ROLE_CONFIG = {
  alumni: {
    label: 'Alumni Portal',
    color: 'from-[#166534] to-[#14532d]',
    accent: 'bg-emerald-500',
    logoutPath: '/',
    sessionKey: 'alumni_user',
    username: 'BSIS Graduate',
    subtitle: 'CHMSU Talisay · BSIS',
  },
  employer: {
    label: 'Employer Portal',
    color: 'from-[#166534] to-[#052e16]',
    accent: 'bg-[#15803d]',
    logoutPath: '/employer',
    sessionKey: 'employer_user',
    username: 'Company Partner',
    subtitle: 'Recruitment Access',
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

function countPendingEmployerRequests(records: Array<Record<string, unknown>>): number {
  return records.filter((record) => {
    const statusValue = String(record.status ?? record.accountStatus ?? '').toLowerCase();
    return statusValue === 'pending';
  }).length;
}

export function PortalLayout({ role, children, pageTitle, pageSubtitle, notificationCount = 0 }: PortalLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [liveAdminNotificationCount, setLiveAdminNotificationCount] = useState<number | null>(null);
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
    } else if (role === 'employer') {
      const u = JSON.parse(sessionStorage.getItem('employer_user') || '{}');
      if (u.company) displayName = u.company;
      if (u.industry) displaySub = u.industry;
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
        const [pendingAlumni, employerRequests] = await Promise.all([
          fetchPendingAlumni(),
          fetchEmployerRequests(),
        ]);
        if (!active) return;

        const pendingEmployers = countPendingEmployerRequests(
          employerRequests as Array<Record<string, unknown>>,
        );
        const totalPending = pendingAlumni.length + pendingEmployers;
        setLiveAdminNotificationCount(totalPending);

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

  const handleLogout = () => {
    sessionStorage.removeItem(config.sessionKey);
    sessionStorage.removeItem(ADMIN_ACCESS_TOKEN_KEY);
    navigate(config.logoutPath);
  };

  const bellNotificationCount = role === 'admin' && liveAdminNotificationCount !== null
    ? liveAdminNotificationCount
    : notificationCount;

  const RoleIcon = role === 'admin' ? Shield : role === 'employer' ? Building2 : GraduationCap;

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className={`p-5 bg-gradient-to-b ${config.color} border-b border-white/10`}>
        <div className="flex items-center gap-3">
          <Image
            src={schoolLogo}
            alt="CHMSU Logo"
            width={36}
            height={36}
            className="size-9 rounded-full object-cover shrink-0 bg-white p-0.5"
          />
          <div className="min-w-0">
            <p className="text-white text-sm truncate" style={{ fontWeight: 700 }}>CHMSU Talisay</p>
            <p className="text-white/50 text-xs truncate">BSIS Graduate Tracer</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        <p className="text-white/30 text-xs px-3 mb-2 tracking-widest uppercase" style={{ fontWeight: 600 }}>
          {config.label}
        </p>
        {nav.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <button
              key={item.path}
              onClick={() => { navigate(item.path); setSidebarOpen(false); }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-150 ${isActive
                ? 'bg-white/20 text-white shadow-sm'
                : 'text-white/60 hover:text-white hover:bg-white/10'
                }`}
              style={{ fontWeight: isActive ? 600 : 400 }}
            >
              <item.icon className={`size-4 shrink-0 ${isActive ? 'text-white' : 'text-white/50'}`} />
              <span className="flex-1 text-left text-sm">{item.label}</span>
              {isActive && <ChevronRight className="size-3 text-white/60 shrink-0" />}
              {/* Notification dot on pending verification */}
              {item.path === '/admin/unverified' && notificationCount > 0 && !isActive && (
                <span className="flex size-4 items-center justify-center rounded-full bg-red-500 text-white shrink-0" style={{ fontSize: '10px', fontWeight: 700 }}>
                  {notificationCount}
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
        <SidebarContent />
      </aside>

      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
          <aside className={`relative z-10 flex flex-col w-64 bg-gradient-to-b ${config.color}`}>
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Topbar */}
        <header className="bg-white border-b border-gray-100 px-4 lg:px-6 h-14 flex items-center justify-between shrink-0 shadow-sm">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 rounded-lg hover:bg-gray-100 transition"
            >
              <Menu className="size-5 text-gray-600" />
            </button>
            {pageTitle && (
              <div>
                <h1 className="text-gray-900 text-sm" style={{ fontWeight: 700 }}>{pageTitle}</h1>
                {pageSubtitle && <p className="text-gray-400 text-xs">{pageSubtitle}</p>}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {role !== 'alumni' && (
              <button
                onClick={() => role === 'admin' ? navigate('/admin/unverified') : undefined}
                className="relative p-2 rounded-lg hover:bg-gray-100 transition"
              >
                <Bell className="size-4 text-gray-500" />
                {bellNotificationCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-red-500 text-white" style={{ fontSize: '9px', fontWeight: 700 }}>
                    {bellNotificationCount}
                  </span>
                )}
              </button>
            )}
            <div className={`flex size-8 items-center justify-center rounded-full ${config.accent} lg:hidden`}>
              <RoleIcon className="size-4 text-white" />
            </div>
          </div>
        </header>

        {/* Scrollable content */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}