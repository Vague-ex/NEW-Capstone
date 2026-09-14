import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/** Origin of the Django API, exactly as app/api-client.ts resolves it. */
function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}
const apiOrigin = originOf(process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000");

/**
 * Enforced Content-Security-Policy: only directives that cannot break the app.
 * Nothing here frames the site, uses plugins, <base>, or native form posts.
 * This is what stops clickjacking today.
 */
const enforcedCsp = [
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

/**
 * The full policy, REPORT-ONLY: browsers block nothing and report what they
 * would have blocked to the API's /api/csp-report/, which logs it. Once real
 * phones show no violations, rename the header below to enforce it.
 *
 * Why each allowance exists:
 * - script 'unsafe-inline': pages are statically prerendered, and Next.js's own
 *   inline scripts need it (nonces require dynamic rendering). No 'unsafe-eval'
 *   in production: the face library, tfjs, jspdf, html2canvas and xlsx were
 *   checked and use no eval, new Function or WebAssembly.
 * - style 'unsafe-inline': MUI/emotion and the chart component inject <style>.
 * - unpkg.com: Leaflet's stylesheet and marker icons.
 * - *.supabase.co: face photos and sweep frames in admin review.
 * - *.tile.openstreetmap.org: map tiles. nominatim: address lookups made from
 *   the browser by the admin geomap and the graduate employment page.
 * - connect data:/blob:: registration turns camera frames into files with
 *   fetch(dataUrl); blocking that would break the face scan.
 * - dev only: 'unsafe-eval' and ws: for React debugging and hot reload.
 */
const reportOnlyCsp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline' https://unpkg.com",
  "img-src 'self' data: blob: https://*.supabase.co https://*.tile.openstreetmap.org https://unpkg.com",
  "font-src 'self' data:",
  `connect-src 'self' data: blob: ${apiOrigin} https://nominatim.openstreetmap.org${isDev ? " ws: wss:" : ""}`,
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  `report-uri ${apiOrigin}/api/csp-report/`,
].join("; ");

const nextConfig: NextConfig = {
  // Emits .next/standalone with a minimal server.js and only the node_modules
  // actually needed at runtime. Without this the Docker image has to carry the
  // full dependency tree, which is far larger and slower to ship.
  // See node_modules/next/dist/docs/.../05-config/01-next-config-js/output.md
  output: "standalone",

  // Stops advertising "X-Powered-By: Next.js" (OWASP ZAP finding).
  poweredByHeader: false,

  // Security headers for every response, pages and static files alike. HSTS is
  // set by Caddy in production instead: sending it from localhost would pin
  // the developer's browser to https for localhost.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: enforcedCsp },
          { key: "Content-Security-Policy-Report-Only", value: reportOnlyCsp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // camera and geolocation stay available to this site only: the face
          // scan and "Use my current location" need them. Everything else is off.
          { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=(), payment=(), usb=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
