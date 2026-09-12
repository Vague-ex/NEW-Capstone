/**
 * Route guards for the portal pages.
 *
 * These run as react-router loaders, which execute BEFORE the route renders,
 * so someone who opens /admin/verified without an admin session is sent to the
 * login page without the admin page ever mounting or flashing on screen.
 *
 * This is a front-end convenience, not the security boundary. Every admin and
 * graduate API endpoint still checks the bearer token server-side; a guard
 * that someone bypasses in devtools gets them an empty page and a stack of
 * 401s, never data.
 */
import { redirect } from 'react-router';
import { ADMIN_ACCESS_TOKEN_KEY, ALUMNI_ACCESS_TOKEN_KEY } from './api-client';

function read(key: string): string | null {
  // sessionStorage can throw (blocked site data, some privacy modes). Treat
  // that as "no session" rather than letting the loader crash the router.
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Both markers the admin login writes: the flag and the API token. */
export function hasAdminSession(): boolean {
  return read('admin_authenticated') === 'true' && Boolean(read(ADMIN_ACCESS_TOKEN_KEY));
}

/**
 * A graduate session. The profile alone is accepted, not just the token,
 * because registration lands on /alumni/pending with the profile stored but no
 * token issued yet -- requiring the token would bounce every new registrant.
 */
export function hasAlumniSession(): boolean {
  return Boolean(read(ALUMNI_ACCESS_TOKEN_KEY)) || Boolean(read('alumni_user'));
}

export function requireAdmin() {
  if (!hasAdminSession()) throw redirect('/');
  return null;
}

export function requireAlumni() {
  if (!hasAlumniSession()) throw redirect('/');
  return null;
}

/** Any URL that matches no route goes back to the login page. */
export function redirectHome() {
  return redirect('/');
}

/**
 * Rendered while a guarded route's loader runs on first load. The guards are
 * synchronous so this is never actually visible; declaring it stops
 * react-router warning that no hydration fallback was provided.
 */
export function GuardFallback() {
  return null;
}
