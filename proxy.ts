import { auth } from "@/auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

function contentSecurityPolicy(nonce: string) {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    `script-src 'self' 'nonce-${nonce}' https://discord.com https://*.discord.com https://*.kinescope.io`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://cdn.discordapp.com https://media.discordapp.net https://*.public.blob.vercel-storage.com",
    "connect-src 'self' https://discord.com https://*.discord.com https://*.kinescope.io https://kinescope.io https://*.public.blob.vercel-storage.com",
    "frame-src 'self' https://*.kinescope.io",
    "media-src 'self' blob: https://*.kinescope.io https://*.public.blob.vercel-storage.com",
  ].join("; ");
}

function withSecurityHeaders(response: NextResponse, nonce: string) {
  response.headers.set("Content-Security-Policy", contentSecurityPolicy(nonce));
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  return response;
}

function isChrome(req: NextRequest): boolean {
  const ua = req.headers.get("user-agent") || "";
  // Must have Chrome but NOT Chromium-based browsers masking as Chrome on non-Chrome platforms
  // Block Safari (includes iOS Safari), Firefox, Edge (we allow Chromium Edge), Opera
  const isChromeBrowser = /Chrome\//.test(ua) && !/Edg\//.test(ua);
  const isSafari = /Safari\//.test(ua) && !/Chrome\//.test(ua);
  const isFirefox = /Firefox\//.test(ua);
  if (isSafari || isFirefox) return false;
  return isChromeBrowser;
}

export default auth((req) => {
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const { pathname } = req.nextUrl;

  // Skip browser check for API routes and static assets
  const isApi = pathname.startsWith("/api");
  if (!isApi && !isChrome(req)) {
    return withSecurityHeaders(new NextResponse(
      `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Chrome Required — Dojo</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #000000;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      font-family: Georgia, serif;
      color: #F5F0F0;
    }
    .card {
      text-align: center;
      padding: 64px 56px;
      background: #000;
      border: 1px solid rgba(232,160,160,0.2);
      max-width: 400px;
    }
    .label { font-size: 10px; letter-spacing: 5px; color: #E8A0A0; text-transform: uppercase; margin-bottom: 24px; }
    h1 { font-size: 22px; letter-spacing: 6px; color: #F5F0F0; text-transform: uppercase; font-weight: 400; margin-bottom: 20px; }
    p { font-size: 13px; color: rgba(245,240,240,0.55); line-height: 1.8; font-style: italic; }
    .rule { width: 40px; height: 1px; background: linear-gradient(90deg, transparent, #E8A0A0, transparent); margin: 24px auto; }
    a { color: #E8A0A0; text-decoration: none; font-style: normal; font-size: 11px; letter-spacing: 3px; text-transform: uppercase; }
  </style>
</head>
<body>
  <div class="card">
    <p class="label">Access Denied</p>
    <h1>Chrome Only</h1>
    <div class="rule"></div>
    <p>This platform requires Google Chrome.<br />Please open it in Chrome to continue.</p>
    <div class="rule"></div>
    <a href="https://www.google.com/chrome/" target="_blank">Download Chrome</a>
  </div>
</body>
</html>`,
      {
        status: 403,
        headers: { "Content-Type": "text/html" },
      }
    ), nonce);
  }

  const isLoggedIn = !!req.auth;

  // Protect all /dashboard routes
  if (pathname.startsWith("/dashboard")) {
    if (!isLoggedIn) {
      return withSecurityHeaders(NextResponse.redirect(new URL("/", req.url)), nonce);
    }
  }

  // Redirect logged-in users away from the login page
  if (pathname === "/" && isLoggedIn) {
    return withSecurityHeaders(NextResponse.redirect(new URL("/dashboard", req.url)), nonce);
  }

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  return withSecurityHeaders(response, nonce);
});

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico).*)",
  ],
};
