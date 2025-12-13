import { writeFile, mkdir, unlink } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import crypto from "crypto";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
const AVATARS_DIR = path.join(UPLOAD_DIR, "avatars");

// Allowed image types
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export interface UploadResult {
  url: string;
  fileName: string;
}

export interface UploadError {
  message: string;
  code: "INVALID_TYPE" | "FILE_TOO_LARGE" | "UPLOAD_FAILED";
}

/**
 * Ensure upload directories exist
 */
async function ensureDirectories(): Promise<void> {
  if (!existsSync(UPLOAD_DIR)) {
    await mkdir(UPLOAD_DIR, { recursive: true });
  }
  if (!existsSync(AVATARS_DIR)) {
    await mkdir(AVATARS_DIR, { recursive: true });
  }
}

/**
 * Generate a unique filename for uploads
 */
function generateFileName(originalName: string, userId: string): string {
  const ext = path.extname(originalName).toLowerCase();
  const timestamp = Date.now();
  const hash = crypto.randomBytes(8).toString("hex");
  return `${userId}-${timestamp}-${hash}${ext}`;
}

/**
 * Validate uploaded file
 */
export function validateFile(
  file: File
): { valid: true } | { valid: false; error: UploadError } {
  if (!ALLOWED_TYPES.includes(file.type)) {
    return {
      valid: false,
      error: {
        message: "Invalid file type. Please upload a JPEG, PNG, GIF, or WebP image.",
        code: "INVALID_TYPE",
      },
    };
  }

  if (file.size > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: {
        message: "File too large. Maximum size is 5MB.",
        code: "FILE_TOO_LARGE",
      },
    };
  }

  return { valid: true };
}

/**
 * Upload an avatar image
 * Returns the public URL of the uploaded file
 */
export async function uploadAvatar(
  file: File,
  userId: string
): Promise<UploadResult> {
  await ensureDirectories();

  const fileName = generateFileName(file.name, userId);
  const filePath = path.join(AVATARS_DIR, fileName);

  // Convert File to Buffer
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Write file to disk
  await writeFile(filePath, buffer);

  // Return the public URL
  return {
    url: `/uploads/avatars/${fileName}`,
    fileName,
  };
}

/**
 * Delete an avatar file
 */
export async function deleteAvatar(avatarUrl: string): Promise<void> {
  if (!avatarUrl || !avatarUrl.startsWith("/uploads/avatars/")) {
    return; // Not a local upload, skip
  }

  const fileName = avatarUrl.replace("/uploads/avatars/", "");
  const filePath = path.join(AVATARS_DIR, fileName);

  try {
    if (existsSync(filePath)) {
      await unlink(filePath);
    }
  } catch (error) {
    console.error("Failed to delete avatar file:", error);
    // Don't throw - file deletion failure shouldn't break the flow
  }
}
