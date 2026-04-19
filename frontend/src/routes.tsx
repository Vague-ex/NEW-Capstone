import type { RouteObject } from 'react-router';

// Auth / Public
import { LoginPage } from './components/login-page';
import { RegisterAlumni } from './components/register-alumni';
import { RegisterEmployer } from './components/register-employer';

// Employer Portal (separate route)
import { EmployerPortal } from './components/employer/employer-portal';

// Alumni Portal
import { AlumniDashboard } from './components/alumni/alumni-dashboard';
import { AlumniProfile } from './components/alumni/alumni-profile';
import { AlumniSkills } from './components/alumni/alumni-skills';
import { AlumniEmployment } from './components/alumni/alumni-employment';
import { AlumniPersonalEducation } from './components/alumni/alumni-personal-education';

// Employer Portal
import { EmployerDashboard } from './components/employer/employer-dashboard';
import { EmployerPending } from './components/employer/employer-pending';
import { GraduateVerify } from './components/employer/graduate-verify';

// Admin Portal
import { AdminNewDashboard } from './components/admin/admin-new-dashboard';
import { AdminUnverified } from './components/admin/admin-unverified';
import { AdminVerified } from './components/admin/admin-verified';
import { AdminBatchUpload } from './components/admin/admin-batch-upload';
import { AdminEmployerRequests } from './components/admin/admin-employer-requests';
import { AdminMap } from './components/admin/admin-map';
import { AdminAnalytics } from './components/admin/admin-analytics';
import { AdminSettings } from './components/admin/admin-settings';

export const routes: RouteObject[] = [
  // ── Single Login Entry Point ──
  { path: '/', Component: LoginPage },

  // ── Registration ──
  { path: '/register/alumni', Component: RegisterAlumni },
  { path: '/register/employer', Component: RegisterEmployer },

  // ── Alumni Portal ──
  { path: '/alumni/dashboard', Component: AlumniDashboard },
  { path: '/alumni/skills', Component: AlumniSkills },
  { path: '/alumni/employment', Component: AlumniEmployment },
  { path: '/alumni/profile', Component: AlumniProfile },
  { path: '/alumni/profile/personal-education', Component: AlumniPersonalEducation },

  // ── Employer Portal ──
  { path: '/employer', Component: EmployerPortal },
  { path: '/employer/pending', Component: EmployerPending },
  { path: '/employer/dashboard', Component: EmployerDashboard },
  { path: '/employer/verify', Component: GraduateVerify },

  // ── Admin Portal ──
  { path: '/admin/dashboard', Component: AdminNewDashboard },
  { path: '/admin/unverified', Component: AdminUnverified },
  { path: '/admin/verified', Component: AdminVerified },
  { path: '/admin/batch-upload', Component: AdminBatchUpload },
  { path: '/admin/employers', Component: AdminEmployerRequests },
  { path: '/admin/map', Component: AdminMap },
  { path: '/admin/analytics', Component: AdminAnalytics },
  { path: '/admin/settings', Component: AdminSettings },

  // Legacy fallbacks
  { path: '/admin', Component: AdminNewDashboard },
];