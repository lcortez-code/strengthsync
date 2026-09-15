export class UploadLimitError extends Error {}

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

// Enforce the limit on bytes actually read, including chunked requests.
export async function readUploadForm(request: Request, maxBytes = 12 * 1024 * 1024): Promise<FormData> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (declaredLength > maxBytes) throw new UploadLimitError("Upload request is too large");
  if (!request.body) throw new UploadLimitError("Upload body is required");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw new UploadLimitError("Upload request is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new Request(request.url, {
    method: "POST", headers: { "content-type": request.headers.get("content-type") || "" },
    body: Buffer.concat(chunks),
  }).formData();
}
