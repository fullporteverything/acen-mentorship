import NextAuth from "next-auth";
import Discord from "next-auth/providers/discord";
import { verifyDiscordMembership } from "@/lib/discord-membership";
import { upgradeLegacyMembershipProof } from "@/lib/membership-proof";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Discord({
      clientId: process.env.DISCORD_CLIENT_ID!,
      clientSecret: process.env.DISCORD_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: "identify email guilds guilds.members.read",
        },
      },
    }),
  ],
  pages: {
    signIn: "/",
    error: "/",
  },
  /**
   * SHORT SESSIONS ON PURPOSE.
   *
   * The default is 30 days, which meant a student signed in once and every
   * later visit skipped the login page entirely — the proxy saw a valid token
   * and bounced them straight to /dashboard. Eight hours is about one study
   * session: come back tomorrow and you sign in again.
   *
   * Auth.js always stamps an expiry on the session cookie (see
   * @auth/core/lib/actions/callback), so a true dies-when-the-browser-closes
   * cookie is not reachable through config. This is the lever that exists and
   * it gets the same practical result.
   *
   * This is NOT what protects against a member whose Discord role was pulled.
   * lib/authz re-verifies the role against Discord every 60 seconds, so
   * revoked access stops working within the minute however long the session
   * lasts. This setting governs the login wall, not access.
   */
  session: {
    strategy: "jwt",
    maxAge: 8 * 60 * 60,
  },
  callbacks: {
    async signIn({ account, profile, user }) {
      if (!account?.access_token) return false;
      const discordId = typeof profile?.id === "string" ? profile.id : user.id;
      if (!discordId) return false;

      const roleCheck = await verifyDiscordMembership(
        discordId,
        account.access_token
      );
      if (roleCheck.member) {
        // ONE LIVE SEAT PER ACCOUNT. A second sign-in is REFUSED here rather
        // than allowed to evict the session already in use — a shared or
        // stolen login must not be able to boot the real member simply by
        // logging in. "Live" is a heartbeat inside SESSION_IDLE_MS, so a
        // closed laptop frees the seat on its own (see lib/session-store).
        //
        // The admin legitimately works across devices (phone for Discord,
        // desktop for review), so they are exempt from the seat limit — but
        // not from an explicit revoke; see lib/authz.
        const adminId = process.env.ADMIN_DISCORD_ID?.trim();
        if (adminId && discordId === adminId) return true;
        try {
          const { getActiveSession } = await import("@/lib/session-store");
          const active = await getActiveSession(discordId);
          if (active) return "/?error=SessionActive";
        } catch (error) {
          // Neon hiccup, table not yet created, cold-start timeout. An
          // infrastructure failure must never read as "your account is in
          // use elsewhere" — fail OPEN and let the member in.
          console.error("[auth] seat check unavailable", error);
        }
        return true;
      }

      // A bare `false` collapses every refusal into NextAuth's generic
      // AccessDenied, which told the visitor nothing. Auth.js v5 lets this
      // callback return a redirect URL instead — so the login page can say
      // whether they need to JOIN the server or just wait on the role.
      switch (roleCheck.reason) {
        case "not_in_server":
          return "/?error=NotInServer";
        case "role_missing":
          return "/?error=RoleMissing";
        case "unavailable":
          return "/?error=Verification";
        default:
          return "/?error=AccessDenied";
      }
    },
    async session({ session, token }) {
      if (token?.sub) {
        session.user.id = token.sub;
      }
      if (token?.discordId) {
        session.user.discordId = token.discordId as string;
      }
      // The seat this browser holds. lib/authz compares it against the
      // registry on every protected request, so a kicked or superseded
      // session stops working without waiting for the JWT to expire.
      session.user.sessionId = typeof token.sid === "string" ? token.sid : undefined;
      session.user.memberVerifiedAt =
        typeof token.memberVerifiedAt === "number"
          ? token.memberVerifiedAt
          : undefined;
      // Discord profile cosmetics captured at sign-in (refresh on next login).
      session.user.avatarHash = (token.avatarHash as string) || undefined;
      session.user.bannerHash = (token.bannerHash as string) || undefined;
      session.user.accentColor =
        typeof token.accentColor === "number" ? token.accentColor : undefined;
      session.user.decorationAsset =
        (token.decorationAsset as string) || undefined;
      return session;
    },
    async jwt({ token, account, profile }) {
      upgradeLegacyMembershipProof(token);
      if (account) {
        token.discordId = profile?.id as string;
        // Fresh sign-in: mint this browser's session id and take the seat.
        //
        // There is a small window between the signIn callback's seat check
        // above and this claim — two logins racing on the same account can
        // both pass the check. That is tolerable because the claim itself is
        // atomic (an advisory lock per account inside one transaction, see
        // lib/session-store), so exactly one of them ends up owning the row.
        // The loser still receives a JWT carrying a sid that is not the
        // current session, and `requireMember` rejects it on the very next
        // request — so the outcome is the same, one live seat, just enforced
        // one hop later.
        const sessionId = crypto.randomUUID();
        token.sid = sessionId;
        // signIn already verified the required role with this OAuth login.
        // Keep only the verification time, never the OAuth access token.
        token.memberVerifiedAt = Date.now();
        // Cosmetics from the raw Discord user object (identify scope):
        // animated avatars/banners have an "a_"-prefixed hash; the avatar
        // decoration is an APNG asset on Discord's CDN.
        const p = profile as {
          username?: string | null;
          avatar?: string | null;
          banner?: string | null;
          accent_color?: number | null;
          avatar_decoration_data?: { asset?: string } | null;
        };
        token.avatarHash = p?.avatar ?? undefined;
        token.bannerHash = p?.banner ?? undefined;
        token.accentColor = p?.accent_color ?? undefined;
        token.decorationAsset = p?.avatar_decoration_data?.asset ?? undefined;

        const discordId =
          typeof token.discordId === "string" ? token.discordId : undefined;
        if (discordId) {
          try {
            const { claimSession } = await import("@/lib/session-store");
            await claimSession({
              discordId,
              sessionId,
              displayName: p?.username ?? token.name ?? undefined,
            });
          } catch (error) {
            // Same fail-open reasoning as the seat check: a registry that is
            // down must not stop a verified member signing in.
            console.error("[auth] session claim failed", error);
          }
        }
      }
      return token;
    },
  },
  events: {
    /**
     * Signing out frees the seat immediately instead of leaving it held until
     * the heartbeat lapses — otherwise a member who signs out on the laptop
     * waits three minutes before the desktop will let them in.
     *
     * With the JWT strategy this event carries `{ token }` (the `{ session }`
     * shape belongs to database sessions), and the token can be null when the
     * cookie was already gone, so both are handled before touching the id.
     */
    async signOut(message) {
      const token = "token" in message ? message.token : null;
      const discordId =
        typeof token?.discordId === "string" ? token.discordId : undefined;
      if (!discordId) return;
      try {
        const { revokeSessions } = await import("@/lib/session-store");
        await revokeSessions(discordId, "signed_out");
      } catch (error) {
        // Never let a registry failure break sign-out itself; the seat still
        // frees itself once the heartbeat lapses.
        console.error("[auth] releasing the seat on sign-out failed", error);
      }
    },
  },
});
