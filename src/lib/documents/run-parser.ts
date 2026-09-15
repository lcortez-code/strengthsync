import { spawn, execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DOCUMENT_LIMITS, DocumentParseError, type DocumentErrorCode } from "@/lib/documents/limits";

// The registry is shared across route bundles in the same server process.
const registry = globalThis as typeof globalThis & { strengthsyncDocumentJobs?: { active: number } };
const jobs = registry.strengthsyncDocumentJobs ??= { active: 0 };

async function residentBytes(pid: number): Promise<number> {
  if (process.platform === "linux") {
    const status = await readFile(`/proc/${pid}/status`, "utf8");
    const match = status.match(/^VmRSS:\s+(\d+)\s+kB$/m);
    if (!match) throw new Error("Process memory unavailable");
    return Number(match[1]) * 1024;
  }
  return new Promise((resolveRss, reject) => {
    execFile("/bin/ps", ["-o", "rss=", "-p", String(pid)], { timeout: 1_000, maxBuffer: 1024 }, (error, stdout) => {
      if (error || !/^\s*\d+\s*$/.test(stdout)) reject(new Error("Process memory unavailable"));
      else resolveRss(Number(stdout.trim()) * 1024);
    });
  });
}

export async function runDocumentParser<T>(kind: "pdf" | "excel", buffer: Buffer): Promise<T> {
  if (!buffer.length || buffer.length > DOCUMENT_LIMITS.inputBytes) {
    throw new DocumentParseError("LIMIT", "Document must contain data and be 10 MB or smaller");
  }
  if (jobs.active >= DOCUMENT_LIMITS.concurrency) {
    throw new DocumentParseError("BUSY", "Document processing is busy. Please try again shortly.");
  }
  jobs.active++;
  try {
    return await new Promise<T>((resolveResult, reject) => {
      const child = spawn(process.execPath, [
        `--max-old-space-size=${DOCUMENT_LIMITS.heapMb}`,
        "--max-semi-space-size=8",
        resolve(process.cwd(), ".document-worker/parser.cjs"), kind,
      ], {
        stdio: ["pipe", "pipe", "ignore"],
        env: { NODE_ENV: "production", LANG: "en_US.UTF-8", TZ: "UTC" },
        windowsHide: true,
      });
      const chunks: Buffer[] = [];
      let size = 0;
      let failure: DocumentParseError | undefined;
      let memoryCheckPending = false;
      const stop = (error: DocumentParseError) => {
        failure ??= error;
        child.kill("SIGKILL");
      };
      const timer = setTimeout(() => stop(new DocumentParseError("TIMEOUT", "Document took too long to process. Try a smaller file.")), DOCUMENT_LIMITS.timeoutMs);
      const memoryTimer = setInterval(async () => {
        if (!child.pid || child.exitCode !== null || child.signalCode !== null || memoryCheckPending) return;
        memoryCheckPending = true;
        try {
          const rss = await residentBytes(child.pid);
          if (rss > DOCUMENT_LIMITS.rssBytes) stop(new DocumentParseError("LIMIT", "Document exceeds the parser memory limit"));
        } catch {
          if (child.exitCode === null && child.signalCode === null) stop(new DocumentParseError("UNAVAILABLE", "Document resource monitoring is unavailable"));
        } finally {
          memoryCheckPending = false;
        }
      }, 250);
      child.stdout.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > DOCUMENT_LIMITS.outputBytes) stop(new DocumentParseError("LIMIT", "Document extracted data exceeds the import limit"));
        else chunks.push(chunk);
      });
      child.stdin.on("error", () => stop(new DocumentParseError("INVALID", "Document could not be processed")));
      child.on("error", () => { failure ??= new DocumentParseError("UNAVAILABLE", "Document processing is unavailable"); });
      child.once("close", (code) => {
        clearTimeout(timer);
        clearInterval(memoryTimer);
        if (failure) return reject(failure);
        if (code !== 0) return reject(new DocumentParseError("INVALID", "Document could not be processed within its resource limits"));
        try {
          const message = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (message.ok === true && Object.hasOwn(message, "result")) resolveResult(message.result as T);
          else if (message.ok === false && ["LIMIT", "INVALID"].includes(message.code) && typeof message.message === "string" && message.message.length < 200) {
            reject(new DocumentParseError(message.code as DocumentErrorCode, message.message));
          } else reject(new DocumentParseError("INVALID", "Document parser returned invalid output"));
        } catch {
          reject(new DocumentParseError("INVALID", "Document parser returned invalid output"));
        }
      });
      child.stdin.end(buffer);
    });
  } finally {
    // Release only after the child closes, including timeout and memory termination.
    jobs.active--;
  }
}
