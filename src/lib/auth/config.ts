import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { credentialVersion } from "@/lib/auth/session-security";
import { protectAuthRequest, emailSchema } from "@/lib/auth/request-protection";
import { isPlatformAdmin } from "@/lib/auth/platform-admin";

export const authOptions: NextAuthOptions = {
  logger: {
    error(code) { console.error("[Authentication]", /^[A-Z_]{1,80}$/.test(code) ? code : "REQUEST_FAILED"); },
    warn(code) { console.warn("[Authentication]", /^[A-Z_]{1,80}$/.test(code) ? code : "WARNING"); },
    debug() {},
  },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        if (!emailSchema.safeParse(credentials?.email).success || typeof credentials?.password !== "string" || !credentials.password || Buffer.byteLength(credentials.password, "utf8") > 1024) {
          throw new Error("Email and password are required");
        }

        await protectAuthRequest("sign-in", request.headers, credentials.email);
        const user = await prisma.user.findUnique({
          where: { email: credentials.email.trim().toLowerCase() },
          include: {
            organizationMemberships: {
              where: { status: "ACTIVE" },
              include: {
                organization: true,
              },
              take: 1,
            },
          },
        });

        if (!user || !user.passwordHash) {
          throw new Error("Invalid email or password");
        }

        const isPasswordValid = await compare(credentials.password, user.passwordHash);

        if (!isPasswordValid) {
          throw new Error("Invalid email or password");
        }

        if (user.emailVerificationRequired && !user.emailVerified) {
          throw new Error("EmailVerificationRequired");
        }

        // Update last login
        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        const membership = user.organizationMemberships[0];

        return {
          id: user.id,
          email: user.email,
          name: user.fullName,
          image: user.avatarUrl,
          organizationId: membership?.organizationId,
          organizationName: membership?.organization.name,
          memberId: membership?.id,
          role: membership?.role,
          credentialVersion: credentialVersion(user.passwordHash),
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id;
        token.organizationId = (user as any).organizationId;
        token.organizationName = (user as any).organizationName;
        token.memberId = (user as any).memberId;
        token.role = (user as any).role;
        token.credentialVersion = user.credentialVersion;
      }
      const requestedOrganizationId = trigger === "update" && typeof session?.organizationId === "string"
        ? session.organizationId : undefined;
      const currentUser = await prisma.user.findUnique({
        where: { id: token.id },
        select: {
          passwordHash: true,
          emailVerificationRequired: true,
          emailVerified: true,
          avatarUrl: true,
          fullName: true,
          organizationMemberships: {
            where: requestedOrganizationId
              ? { organizationId: requestedOrganizationId, status: "ACTIVE" }
              : { id: token.memberId || "", organizationId: token.organizationId || "", status: "ACTIVE" },
            select: { id: true, organizationId: true, role: true, organization: { select: { name: true } } },
          },
        },
      });
      if (!currentUser?.passwordHash || (currentUser.emailVerificationRequired && !currentUser.emailVerified) || !token.credentialVersion ||
          credentialVersion(currentUser.passwordHash) !== token.credentialVersion) {
        throw new Error("Session is no longer valid. Sign in again.");
      }
      const membership = currentUser.organizationMemberships[0];
      // An issued organization session may never survive removal or suspension.
      if ((token.memberId || requestedOrganizationId) && !membership) {
        throw new Error("Organization membership is no longer active.");
      }
      token.memberId = membership?.id;
      token.organizationId = membership?.organizationId;
      token.organizationName = membership?.organization.name;
      token.role = membership?.role;
      token.picture = currentUser.avatarUrl;
      token.name = currentUser.fullName;
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id;
        (session.user as any).organizationId = token.organizationId;
        (session.user as any).organizationName = token.organizationName;
        (session.user as any).memberId = token.memberId;
        (session.user as any).role = token.role;
        session.user.isPlatformAdmin = isPlatformAdmin(token.id);

        session.user.image = token.picture;
        session.user.name = token.name || "";
      }
      return session;
    },
  },
  pages: {
    signIn: "/auth/login",
    error: "/auth/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 7 * 24 * 60 * 60, // 7 days
  },
  secret: process.env.NEXTAUTH_SECRET,
};

// Type augmentation for NextAuth
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      image?: string | null;
      organizationId?: string;
      organizationName?: string;
      memberId?: string;
      role?: "OWNER" | "ADMIN" | "MANAGER" | "MEMBER";
      isPlatformAdmin?: boolean;
    };
  }

  interface User {
    id: string;
    email: string;
    name: string;
    image?: string | null;
    organizationId?: string;
    organizationName?: string;
    memberId?: string;
    role?: "OWNER" | "ADMIN" | "MANAGER" | "MEMBER";
    credentialVersion?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    organizationId?: string;
    organizationName?: string;
    memberId?: string;
    role?: "OWNER" | "ADMIN" | "MANAGER" | "MEMBER";
    credentialVersion?: string;
  }
}
