import NextAuth from "next-auth";
import Discord from "next-auth/providers/discord";

const GUILD_ID = process.env.DISCORD_GUILD_ID!;
const REQUIRED_ROLE_ID = process.env.DISCORD_REQUIRED_ROLE_ID!;

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
  callbacks: {
    async signIn({ account }) {
      if (!account?.access_token) return false;

      try {
        const res = await fetch(
          `https://discord.com/api/users/@me/guilds/${GUILD_ID}/member`,
          {
            headers: {
              Authorization: `Bearer ${account.access_token}`,
            },
            // Bound the sign-in handoff — never hang on a slow Discord API.
            signal: AbortSignal.timeout(5000),
          }
        );

        if (!res.ok) return false;

        const member = await res.json();
        const hasRole = Array.isArray(member.roles) &&
          member.roles.includes(REQUIRED_ROLE_ID);

        return hasRole;
      } catch {
        return false;
      }
    },
    async session({ session, token }) {
      if (token?.sub) {
        session.user.id = token.sub;
      }
      if (token?.discordId) {
        session.user.discordId = token.discordId as string;
      }
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
      if (account) {
        token.accessToken = account.access_token;
        token.discordId = profile?.id as string;
        // Cosmetics from the raw Discord user object (identify scope):
        // animated avatars/banners have an "a_"-prefixed hash; the avatar
        // decoration is an APNG asset on Discord's CDN.
        const p = profile as {
          avatar?: string | null;
          banner?: string | null;
          accent_color?: number | null;
          avatar_decoration_data?: { asset?: string } | null;
        };
        token.avatarHash = p?.avatar ?? undefined;
        token.bannerHash = p?.banner ?? undefined;
        token.accentColor = p?.accent_color ?? undefined;
        token.decorationAsset = p?.avatar_decoration_data?.asset ?? undefined;
      }
      return token;
    },
  },
});
