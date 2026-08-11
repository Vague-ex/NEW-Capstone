import type { RouteObject } from 'react-router';

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

export const routes: RouteObject[] = [
  // ── Single Login Entry Point ──
  { path: '/', Component: LoginPage },

  // ── Public employer verification (one-time link, no account) ──
  { path: '/verify/:tokenId', Component: EmployerVerificationPage },

  // ── Registration ──
  { path: '/register/alumni', Component: RegisterAlumni },

  // ── Alumni Portal ──
  { path: '/alumni/dashboard', Component: AlumniDashboard },
  { path: '/alumni/pending', Component: GraduatePending },
  { path: '/alumni/skills', Component: AlumniSkills },
  { path: '/alumni/employment', Component: AlumniEmployment },
  { path: '/alumni/profile', Component: AlumniProfile },
  { path: '/alumni/profile/personal-education', Component: AlumniPersonalEducation },

  // ── Admin Portal ──
  { path: '/admin/dashboard', Component: AdminNewDashboard },
  { path: '/admin/unverified', Component: AdminUnverified },
  { path: '/admin/verified', Component: AdminVerified },
  { path: '/admin/batch-upload', Component: AdminBatchUpload },
  { path: '/admin/map', Component: AdminMap },
  { path: '/admin/analytics', Component: AdminAnalytics },
  { path: '/admin/settings', Component: AdminSettings },

  // Legacy fallbacks
  { path: '/admin', Component: AdminNewDashboard },
];