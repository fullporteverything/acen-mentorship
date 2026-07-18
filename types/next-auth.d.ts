import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  /**
   * Returned by `auth()`, `useSession`, `getSession`.
   * Extended with the member's Discord id so server pages and API
   * routes can gate on `session.user.discordId === ADMIN_DISCORD_ID`.
   */
  interface Session {
    user: {
      id?: string;
      discordId?: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  /** Extra claims we persist on the JWT. */
  interface JWT {
    discordId?: string;
    accessToken?: string;
  }
}
