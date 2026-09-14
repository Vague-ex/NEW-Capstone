import type { ComponentType } from 'react';
import { Navigate, type RouteObject } from 'react-router';
import { hasAdminSession, hasAlumniSession } from './app/route-guards';

// Auth / Public
import { LoginPage } from './components/login-page';
import { RegisterAlumni } from './components/register-alumni';
// Public employer verification — reached only by a one-time link from a
// graduate. No account, no session; see components/verify/.
import { EmployerVerificationPage } from './components/verify/employer-verification-page';

// Alumni Portal
import { AlumniDashboard } from './components/alumni/alumni-dashboard';
import { AlumniProfile } from './components/alumni/alumni-profile';
import { AlumniSkills } from './components/alumni/alumni-skills';
import { AlumniEmployment } from './components/alumni/alumni-employment';
import { AlumniPersonalEducation } from './components/alumni/alumni-personal-education';
import { GraduatePending } from './components/alumni/graduate-pending';

// Admin Portal
import { AdminNewDashboard } from './components/admin/admin-new-dashboard';
import { AdminUnverified } from './components/admin/admin-unverified';
import { AdminVerified } from './components/admin/admin-verified';
import { AdminBatchUpload } from './components/admin/admin-batch-upload';
import { AdminMap } from './components/admin/admin-map';
import { AdminAnalytics } from './components/admin/admin-analytics';
import { AdminSettings } from './components/admin/admin-settings';
// #region DEBUG-ONLY:CurrenChanDebug
import { AdminFaceDebug } from './components/admin/admin-face-debug';
// #endregion DEBUG-ONLY:CurrenChanDebug

/**
 * Wrap a portal page so it only mounts with a matching session, and otherwise
 * sends the visitor to the login page. The check is synchronous at render --
 * see app/route-guards.ts for why this is not a react-router loader.
 *
 * Built once per route at module load, so each guard keeps a stable component
 * identity across renders.
 */
function guarded(allowed: () => boolean, Page: ComponentType): ComponentType {
  function Guarded() {
    return allowed() ? <Page /> : <Navigate to="/" replace />;
  }
  Guarded.displayName = `Guarded(${Page.displayName || Page.name || 'Page'})`;
  return Guarded;
}

const adminRoute = (path: string, Component: ComponentType): RouteObject => ({
  path,
  Component: guarded(hasAdminSession, Component),
});

const alumniRoute = (path: string, Component: ComponentType): RouteObject => ({
  path,
  Component: guarded(hasAlumniSession, Component),
});

export const routes: RouteObject[] = [
  // ── Single Login Entry Point ──
  { path: '/', Component: LoginPage },

  // ── Public employer verification (one-time link, no account) ──
  { path: '/verify/:tokenId', Component: EmployerVerificationPage },

  // ── Registration ──
  { path: '/register/alumni', Component: RegisterAlumni },

  // ── Alumni Portal ──
  alumniRoute('/alumni/dashboard', AlumniDashboard),
  alumniRoute('/alumni/pending', GraduatePending),
  alumniRoute('/alumni/skills', AlumniSkills),
  alumniRoute('/alumni/employment', AlumniEmployment),
  alumniRoute('/alumni/profile', AlumniProfile),
  alumniRoute('/alumni/profile/personal-education', AlumniPersonalEducation),

  // ── Admin Portal ──
  adminRoute('/admin/dashboard', AdminNewDashboard),
  adminRoute('/admin/unverified', AdminUnverified),
  adminRoute('/admin/verified', AdminVerified),
  adminRoute('/admin/batch-upload', AdminBatchUpload),
  adminRoute('/admin/map', AdminMap),
  adminRoute('/admin/analytics', AdminAnalytics),
  adminRoute('/admin/settings', AdminSettings),

  // #region DEBUG-ONLY:CurrenChanDebug
  // URL-only, deliberately absent from the sidebar. Maintenance hatch, not
  // a feature — omit from DFDs / use-case docs.
  adminRoute('/admin/debug/face', AdminFaceDebug),
  // #endregion DEBUG-ONLY:CurrenChanDebug

  // Legacy fallbacks
  adminRoute('/admin', AdminNewDashboard),

  // Unknown URLs go back to the login page instead of the router's 404 screen.
  { path: '*', element: <Navigate to="/" replace /> },
];
