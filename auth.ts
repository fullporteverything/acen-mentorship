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
  callbacks: {
    async signIn({ account, profile, user }) {
      if (!account?.access_token) return false;
      const discordId = typeof profile?.id === "string" ? profile.id : user.id;
      if (!discordId) return false;

      const roleCheck = await verifyDiscordMembership(
        discordId,
        account.access_token
      );
      return roleCheck.member;
    },
    async session({ session, token }) {
      if (token?.sub) {
        session.user.id = token.sub;
      }
      if (token?.discordId) {
        session.user.discordId = token.discordId as string;
      }
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
        // signIn already verified the required role with this OAuth login.
        // Keep only the verification time, never the OAuth access token.
        token.memberVerifiedAt = Date.now();
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
