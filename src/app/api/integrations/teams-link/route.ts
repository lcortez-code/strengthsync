import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth/config";
import { apiSuccess, apiError, ApiErrorCode } from "@/lib/api/response";
import { acceptTeamsLink, getTeamsLinkStatus, reviewTeamsLink, TeamsLinkError, unlinkTeamsAccount } from "@/lib/integrations/teams-linking";
import { readTeamsJson, TeamsRequestError } from "@/lib/integrations/teams-request";

const linkSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("review"), token: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ action: z.literal("link"), token: z.string().regex(/^[a-f0-9]{64}$/), organizationId: z.string().min(1).max(100) }).strict(),
]);
const unlinkSchema = z.object({ mappingId: z.string().min(1).max(100) }).strict();

function privateResponse(response: Response) {
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

async function run(request: NextRequest, action: "status" | "link" | "unlink") {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return apiError(ApiErrorCode.UNAUTHORIZED, "Sign in to manage your Teams account");
    if (action === "status") return apiSuccess(await getTeamsLinkStatus(session.user.id));
    // Browser mutations must originate from this application; identity claims are never accepted from the client.
    if (request.headers.get("origin") !== new URL(request.url).origin) return apiError(ApiErrorCode.FORBIDDEN, "Open Teams account settings in StrengthSync to continue");
    const body = await readTeamsJson(request, 4096);
    if (action === "unlink") {
      const parsed = unlinkSchema.safeParse(body);
      if (!parsed.success) return apiError(ApiErrorCode.BAD_REQUEST, "Invalid Teams link");
      await unlinkTeamsAccount(parsed.data.mappingId, session.user.id);
      return apiSuccess({ unlinked: true });
    }
    const parsed = linkSchema.safeParse(body);
    if (!parsed.success) return apiError(ApiErrorCode.BAD_REQUEST, "Invalid Teams link");
    if (parsed.data.action === "review") return apiSuccess(await reviewTeamsLink(parsed.data.token, session.user.id));
    return apiSuccess(await acceptTeamsLink(parsed.data.token, session.user.id, parsed.data.organizationId));
  } catch (error) {
    if (error instanceof TeamsLinkError || error instanceof TeamsRequestError) return NextResponse.json({ success: false, error: { message: error.message } }, { status: error.status });
    console.error("[Teams Link] Request failed");
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Unable to update your Teams link. Please try again.");
  }
}

export async function GET(request: NextRequest) { return privateResponse(await run(request, "status")); }
export async function POST(request: NextRequest) { return privateResponse(await run(request, "link")); }
export async function DELETE(request: NextRequest) { return privateResponse(await run(request, "unlink")); }
