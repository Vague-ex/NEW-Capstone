/**
 * Session checks for the portal pages.
 *
 * routes.tsx wraps each portal page in a guard component that renders the page
 * only when these return true, and otherwise redirects to the login page. The
 * page component itself never mounts without a session, so nothing flashes.
 *
 * This is deliberately NOT done with react-router loaders. An earlier version
 * used `loader` + `HydrateFallback`, and on the first load of a guarded URL the
 * loader could settle before RouterProvider had subscribed to the router --
 * the update was lost and the page stayed on the empty fallback forever. It
 * was timing-dependent (worse on slow devices), so it passed in testing and
 * then left an admin page blank. A synchronous check at render has no race.
 *
 * This is a front-end convenience, not the security boundary. Every admin and
 * graduate API endpoint still checks the bearer token server-side; a guard
 * that someone bypasses in devtools gets them an empty page and a stack of
 * 401s, never data.
 */
import { ADMIN_ACCESS_TOKEN_KEY, ALUMNI_ACCESS_TOKEN_KEY } from './api-client';

function read(key: string): string | null {
  // sessionStorage can throw (blocked site data, some privacy modes). Treat
  // that as "no session" rather than crashing the page.
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
 * A graduate session, as written by the graduate login. The profile alone is
 * accepted as well as the token so a login response without a token still
 * reaches /alumni/pending; the pages themselves re-check status with the API.
 */
export function hasAlumniSession(): boolean {
  return Boolean(read(ALUMNI_ACCESS_TOKEN_KEY)) || Boolean(read('alumni_user'));
}
