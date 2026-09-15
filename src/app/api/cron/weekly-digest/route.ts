import { NextRequest } from "next/server";
import { POST as dispatchDigest } from "@/app/api/email/digest/route";
import { isDigestScheduler } from "@/lib/email/digest-delivery";
import { apiError, ApiErrorCode } from "@/lib/api/response";

export const dynamic = "force-dynamic";

// Scheduler-only GET. The interactive GET /api/email/digest remains a preview.
export async function GET(request: NextRequest) {
  if (!isDigestScheduler(request)) return apiError(ApiErrorCode.UNAUTHORIZED, "Scheduler authentication required");
  if (new URL(request.url).search) return apiError(ApiErrorCode.BAD_REQUEST, "Scheduler parameters are not supported");
  const response = await dispatchDigest(new NextRequest(new URL("/api/email/digest", request.url), {
    method: "POST", headers: request.headers,
  }));
  response.headers.set("Cache-Control", "no-store");
  return response;
}
