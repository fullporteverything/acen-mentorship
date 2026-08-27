/**
 * Security headers.
 *
 * The Content-Security-Policy for HTML pages is NOT set here — it is emitted
 * per-request by proxy.ts with a live nonce (a static config CSP can't carry a
 * nonce, and shipping both produced two conflicting CSP headers, one with a
 * dead nonce placeholder that was never substituted). This file owns only the
 * header set that is
 * identical on every response: the browser-isolation + transport headers, plus
 * a locked-down CSP for the JSON API surface (which the page middleware
 * deliberately doesn't touch and which never needs to load anything).
 */
const ISOLATION_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    // picture-in-picture: PiP escapes the lesson away-blur and the DOM
    // watermark by moving playback into an OS window. See proxy.ts.
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), picture-in-picture=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Don't advertise the framework/version to every visitor.
  poweredByHeader: false,
  transpilePackages: ["three"],
  turbopack: {
    root: process.cwd(),
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: ISOLATION_HEADERS,
      },
      {
        // API responses are JSON consumed by fetch — they never render markup
        // or load sub-resources, so the strictest CSP fits and covers the one
        // surface the page middleware doesn't.
        source: "/api/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
