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
      return session;
    },
    async jwt({ token, account, profile }) {
      if (account) {
        token.accessToken = account.access_token;
        token.discordId = profile?.id as string;
      }
      return token;
    },
  },
});
