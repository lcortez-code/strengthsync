import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import crypto from "crypto";

// S3 Configuration
const s3Client = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
  },
});

const BUCKET_NAME = process.env.AWS_S3_BUCKET || "";

// Allowed image types
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

// Content type to extension mapping
const CONTENT_TYPE_TO_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

export interface UploadResult {
  url: string;
  key: string;
}

export interface UploadError {
  message: string;
  code: "INVALID_TYPE" | "FILE_TOO_LARGE" | "UPLOAD_FAILED" | "NOT_CONFIGURED";
}

/**
 * Check if S3 is properly configured
 */
export function isS3Configured(): boolean {
  return !!(
    process.env.AWS_REGION &&
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY &&
    process.env.AWS_S3_BUCKET
  );
}

/**
 * Generate a unique filename for uploads
 */
function generateFileName(contentType: string, userId: string): string {
  const ext = CONTENT_TYPE_TO_EXT[contentType] || ".jpg";
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
 * Get the S3 key from a full URL
 */
function getKeyFromUrl(url: string): string | null {
  if (!url) return null;

  // Handle S3 URLs
  if (url.includes(".s3.") && url.includes("amazonaws.com")) {
    // Format: https://bucket.s3.region.amazonaws.com/key
    const urlObj = new URL(url);
    return urlObj.pathname.slice(1); // Remove leading /
  }

  // Handle local URLs (for backwards compatibility)
  if (url.startsWith("/uploads/avatars/")) {
    return null; // Local file, can't delete from S3
  }

  return null;
}

/**
 * Upload an avatar image to S3
 * Returns the public URL of the uploaded file
 */
export async function uploadAvatar(
  file: File,
  userId: string
): Promise<UploadResult> {
  if (!isS3Configured()) {
    throw new Error("S3 is not configured. Please set AWS environment variables.");
  }

  const fileName = generateFileName(file.type, userId);
  const key = `avatars/${fileName}`;

  // Convert File to Buffer
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Upload to S3
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: file.type,
    CacheControl: "max-age=31536000", // 1 year cache
  });

  await s3Client.send(command);

  // Construct the public URL
  const url = `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;

  return {
    url,
    key,
  };
}

/**
 * Delete an avatar from S3
 */
export async function deleteAvatar(avatarUrl: string): Promise<void> {
  if (!avatarUrl || !isS3Configured()) {
    return;
  }

  const key = getKeyFromUrl(avatarUrl);
  if (!key) {
    return; // Not an S3 URL or couldn't parse
  }

  try {
    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    await s3Client.send(command);
  } catch (error) {
    console.error("Failed to delete avatar from S3:", error);
    // Don't throw - file deletion failure shouldn't break the flow
  }
}
