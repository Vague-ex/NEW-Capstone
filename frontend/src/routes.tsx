import type { ComponentType } from 'react';
import type { RouteObject } from 'react-router';
import {
  GuardFallback,
  redirectHome,
  requireAdmin,
  requireAlumni,
} from './app/route-guards';

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

// Portal pages redirect to the login page before rendering when there is no
// matching session. See app/route-guards.ts.
const adminRoute = (path: string, Component: ComponentType): RouteObject => ({
  path,
  Component,
  loader: requireAdmin,
  HydrateFallback: GuardFallback,
});

const alumniRoute = (path: string, Component: ComponentType): RouteObject => ({
  path,
  Component,
  loader: requireAlumni,
  HydrateFallback: GuardFallback,
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
  { path: '*', loader: redirectHome, HydrateFallback: GuardFallback },
];
