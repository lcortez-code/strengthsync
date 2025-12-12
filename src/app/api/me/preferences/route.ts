import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, ApiErrorCode } from "@/lib/api/response";

// Default user preferences
const DEFAULT_PREFERENCES = {
  weeklyDigestEnabled: true,
  shoutoutNotificationsEnabled: true,
  mentorshipNotificationsEnabled: true,
  challengeNotificationsEnabled: true,
  marketplaceNotificationsEnabled: true,
};

export type UserPreferences = typeof DEFAULT_PREFERENCES;

/**
 * GET /api/me/preferences
 * Get current user's preferences
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return apiError(ApiErrorCode.UNAUTHORIZED, "Authentication required");
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        preferences: true,
      },
    });

    if (!user) {
      return apiError(ApiErrorCode.NOT_FOUND, "User not found");
    }

    // Merge with defaults
    const storedPrefs = (user.preferences as Partial<UserPreferences>) || {};
    const preferences = { ...DEFAULT_PREFERENCES, ...storedPrefs };

    return apiSuccess({ preferences });
  } catch (error) {
    console.error("[Get Preferences Error]", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to fetch preferences");
  }
}

/**
 * PATCH /api/me/preferences
 * Update current user's preferences
 */
export async function PATCH(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return apiError(ApiErrorCode.UNAUTHORIZED, "Authentication required");
    }

    const body = await request.json();

    // Validate input - only allow known preference keys
    const allowedKeys = Object.keys(DEFAULT_PREFERENCES);
    const updates: Partial<UserPreferences> = {};

    for (const key of allowedKeys) {
      if (key in body && typeof body[key] === "boolean") {
        updates[key as keyof UserPreferences] = body[key];
      }
    }

    if (Object.keys(updates).length === 0) {
      return apiError(ApiErrorCode.BAD_REQUEST, "No valid preferences provided");
    }

    // Get current preferences
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { preferences: true },
    });

    const currentPrefs = (user?.preferences as Partial<UserPreferences>) || {};
    const newPrefs = { ...DEFAULT_PREFERENCES, ...currentPrefs, ...updates };

    // Update user
    await prisma.user.update({
      where: { id: session.user.id },
      data: {
        preferences: JSON.parse(JSON.stringify(newPrefs)),
      },
    });

    return apiSuccess({
      preferences: newPrefs,
      message: "Preferences updated successfully",
    });
  } catch (error) {
    console.error("[Update Preferences Error]", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to update preferences");
  }
}
