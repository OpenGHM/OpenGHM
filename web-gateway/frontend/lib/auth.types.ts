import "next-auth";
import "next-auth/jwt";

/** Mirrors web-gateway/backend/app/core/roles.py:Role. Keep in sync. */
export type UserRole = "admin" | "staff" | "user" | "guest";

declare module "next-auth" {
  interface User {
    role?: UserRole;
    accessToken?: string;
    refreshToken?: string;
    expiresIn?: number;
  }
  interface Session {
    user: {
      id: string;
      role: UserRole;
      accessToken: string;
      name?: string | null;
      email?: string | null;
    };
    /** Set when a refresh attempt failed — session cookie is still alive
     *  but the backend access token could not be renewed. Callers should
     *  treat this like being signed out. */
    error?: "RefreshAccessTokenError";
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: UserRole;
    id?: string;
    accessToken?: string;
    refreshToken?: string;
    /** epoch ms; when Date.now() passes this, the jwt callback refreshes. */
    accessTokenExpires?: number;
    error?: "RefreshAccessTokenError";
  }
}
