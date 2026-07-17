# Acen Mentorship — Setup Guide

## Quick Start

```bash
# 1. Move this folder out of arctic-booking (or work from here)
cd acen-mentorship

# 2. Install dependencies
npm install

# 3. Copy env file and fill in your values
cp .env.example .env.local

# 4. Run dev server
npm run dev
# → open http://localhost:3000
```

---

## Environment Variables

Edit `.env.local` with your values:

| Variable | Description |
|---|---|
| `DISCORD_CLIENT_ID` | From Discord Developer Portal → Your App → OAuth2 |
| `DISCORD_CLIENT_SECRET` | Same location |
| `AUTH_SECRET` | Run `openssl rand -base64 32` in terminal |
| `NEXTAUTH_URL` | `http://localhost:3000` for dev, your Vercel URL for prod |

### Discord App Setup
1. Go to https://discord.com/developers/applications
2. Create New Application → name it "Acen Mentorship"
3. Go to OAuth2 → Add Redirect URI: `http://localhost:3000/api/auth/callback/discord`
4. Copy Client ID and Client Secret into `.env.local`
5. For production, add your Vercel URL as another redirect: `https://your-app.vercel.app/api/auth/callback/discord`

---

## Deploy to GitHub + Vercel

```bash
# Initialize git
git init
git add .
git commit -m "feat: initial acen mentorship build"

# Create GitHub repo (requires gh CLI: https://cli.github.com)
gh repo create acen-mentorship --public --source=. --push

# Deploy to Vercel (requires vercel CLI: npm i -g vercel)
vercel

# Set env vars in Vercel (do this from Vercel dashboard or CLI)
vercel env add DISCORD_CLIENT_ID
vercel env add DISCORD_CLIENT_SECRET
vercel env add AUTH_SECRET
vercel env add NEXTAUTH_URL
# → set NEXTAUTH_URL to your https://your-app.vercel.app URL

# Redeploy after setting env vars
vercel --prod
```

---

## Tech Stack

- **Next.js 14** (App Router)
- **TypeScript**
- **Tailwind CSS**
- **Three.js + @react-three/fiber** — 3D floating geometric background
- **Framer Motion** — login card animations
- **NextAuth v5** — Discord OAuth
- **Vercel** — deployment

---

## Folder Structure

```
acen-mentorship/
├── app/
│   ├── page.tsx              ← Login page (public)
│   ├── layout.tsx            ← Root layout
│   ├── globals.css           ← Global styles + CSS vars
│   ├── dashboard/
│   │   └── page.tsx          ← Protected dashboard
│   └── api/auth/[...nextauth]/
│       └── route.ts          ← Auth API
├── components/
│   ├── ThreeBackground.tsx   ← 3D scene (Three.js)
│   └── LoginCard.tsx         ← Animated login modal
├── auth.ts                   ← NextAuth config
├── middleware.ts             ← Route protection
├── .env.example              ← Env var template
└── SETUP.md                  ← This file
```
