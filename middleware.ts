import { auth } from "@/auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

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
  const { pathname } = req.nextUrl;

  // Skip browser check for API routes and static assets
  const isApi = pathname.startsWith("/api");
  if (!isApi && !isChrome(req)) {
    return new NextResponse(
      `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Chrome Required — Dojo</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #EADAC0;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      font-family: Georgia, serif;
      color: #1A0808;
    }
    .card {
      text-align: center;
      padding: 64px 56px;
      background: #000;
      border: 1px solid rgba(196,24,24,0.2);
      max-width: 400px;
    }
    .label { font-size: 10px; letter-spacing: 5px; color: #C41818; text-transform: uppercase; margin-bottom: 24px; }
    h1 { font-size: 22px; letter-spacing: 6px; color: #F0EDE6; text-transform: uppercase; font-weight: 400; margin-bottom: 20px; }
    p { font-size: 13px; color: rgba(240,237,230,0.55); line-height: 1.8; font-style: italic; }
    .rule { width: 40px; height: 1px; background: linear-gradient(90deg, transparent, #C41818, transparent); margin: 24px auto; }
    a { color: #C41818; text-decoration: none; font-style: normal; font-size: 11px; letter-spacing: 3px; text-transform: uppercase; }
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
    );
  }

  const isLoggedIn = !!req.auth;

  // Protect all /dashboard routes
  if (pathname.startsWith("/dashboard")) {
    if (!isLoggedIn) {
      return NextResponse.redirect(new URL("/", req.url));
    }
  }

  // Redirect logged-in users away from the login page
  if (pathname === "/" && isLoggedIn) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico).*)",
  ],
};
