export class TeamsRequestError extends Error {
  constructor(message: string, public status: 400 | 413 = 400) { super(message); }
}

export async function readTeamsJson(request: Request, maxBytes = 64 * 1024): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new TeamsRequestError("JSON content is required");
  if (Number(request.headers.get("content-length")) > maxBytes) throw new TeamsRequestError("Request is too large", 413);
  if (!request.body) throw new TeamsRequestError("Request body is required");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) { await reader.cancel(); throw new TeamsRequestError("Request is too large", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new TeamsRequestError("Invalid JSON request"); }
}
