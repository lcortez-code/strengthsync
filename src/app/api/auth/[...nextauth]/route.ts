import NextAuth from "next-auth";
import { NextRequest } from "next/server";
import { authOptions } from "@/lib/auth/config";
import { readAuthBody, authProtectionResponse } from "@/lib/auth/request-protection";

const handler = NextAuth(authOptions);
export const GET = handler;
// Bound bytes before NextAuth parses credentials, including chunked requests.
export async function POST(request: NextRequest, context: { params: Promise<{ nextauth: string[] }> }) {
  try {
    const bytes = await readAuthBody(request);
    const bounded = new NextRequest(request.url, { method: "POST", headers: request.headers, body: Buffer.from(bytes) });
    return handler(bounded, context);
  } catch (error) {
    const response = authProtectionResponse(error);
    if (response) return response;
    throw error;
  }
}
