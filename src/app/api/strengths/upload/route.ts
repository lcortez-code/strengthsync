import { DocumentParseError } from "@/lib/documents/limits";
import { readUploadForm, UploadLimitError } from "@/lib/api/upload";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { parseCliftonStrengthsPDF, validateParsedReport } from "@/lib/pdf/parser";
import { apiSuccess, apiError, ApiErrorCode, apiCreated } from "@/lib/api/response";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return apiError(ApiErrorCode.UNAUTHORIZED, "Authentication required");
    }

    if (!session.user.organizationId || !session.user.memberId) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Organization membership required");
    }

    const formData = await readUploadForm(request);
    const file = formData.get("file") as File;
    const forMemberId = formData.get("forMemberId") as string | null;
    const forUserEmail = formData.get("forUserEmail") as string | null;
    const selfUpload = formData.get("selfUpload") === "true";

    // Permission check:
    // - Self-upload: Any authenticated user can upload their own strengths
    // - Upload for others: Requires OWNER or ADMIN role
    const isAdmin = session.user.role === "OWNER" || session.user.role === "ADMIN";
    const isUploadingForOthers = !selfUpload && (forMemberId || forUserEmail);

    if (isUploadingForOthers && !isAdmin) {
      return apiError(ApiErrorCode.FORBIDDEN, "Admin access required to upload for other members");
    }

    if (!file) {
      return apiError(ApiErrorCode.BAD_REQUEST, "PDF file required");
    }

    if (!(file instanceof File) || file.type !== "application/pdf") {
      return apiError(ApiErrorCode.VALIDATION_ERROR, "Only PDF files are accepted");
    }

    if (file.size > 10 * 1024 * 1024) return apiError(ApiErrorCode.BAD_REQUEST, "PDF exceeds the 10 MB limit");

    // Convert to buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Parse PDF
    const parsed = await parseCliftonStrengthsPDF(buffer);

    // Validate
    const validation = validateParsedReport(parsed);
    if (!validation.valid) {
      // Include diagnostic info for debugging
      const textLength = parsed.rawText?.length || 0;
      const textPreview = parsed.rawText?.substring(0, 200)?.replace(/\s+/g, ' ').trim() || '';

      // Check if PDF appears to be image-based (very little text extracted)
      const isLikelyImagePdf = textLength < 500;
      const errorMessage = isLikelyImagePdf
        ? "This PDF appears to be scanned/image-based. Please use the original digital PDF from Gallup's website (my.gallup.com)."
        : "Failed to parse valid strengths data";

      return apiError(ApiErrorCode.VALIDATION_ERROR, errorMessage, {
        errors: validation.errors,
        warnings: validation.warnings,
        parsedThemes: parsed.themes.length,
        diagnostics: {
          textExtracted: textLength > 0,
          textLength,
          textPreview: textPreview.length > 0 ? `${textPreview}...` : '(only whitespace/formatting characters)',
          participantName: parsed.participantName,
          isLikelyImagePdf,
        },
      });
    }

    // Resolve an accepted membership before creating or modifying assessment records.
    const targetMember = await prisma.organizationMember.findFirst({
      where: {
        organizationId: session.user.organizationId,
        status: "ACTIVE",
        ...(selfUpload
          ? { id: session.user.memberId }
          : forMemberId
            ? { id: forMemberId }
            : forUserEmail
              ? { user: { email: forUserEmail.toLowerCase().trim() } }
              : { id: session.user.memberId }),
      },
      include: { user: { select: { fullName: true, email: true } } },
    });
    if (!targetMember) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Add or invite this person from Members first. They must accept their invitation before strengths can be uploaded.");
    }

    // Store document record
    const document = await prisma.strengthsDocument.create({
      data: {
        uploadedById: session.user.id,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        processingStatus: "COMPLETED",
        extractedData: parsed as any,
      },
    });

    // If we have a target member, update their strengths
    if (targetMember) {
      // Get theme IDs from database
      const themeRecords = await prisma.strengthTheme.findMany({
        where: {
          slug: {
            in: parsed.themes.map((t) => t.slug),
          },
        },
      });

      const themeMap = new Map(themeRecords.map((t) => [t.slug, t.id]));

      // Delete existing strengths
      await prisma.memberStrength.deleteMany({
        where: { memberId: targetMember.id },
      });

      // Create new strengths with all personalized content
      const strengthsData = parsed.themes
        .filter((t) => themeMap.has(t.slug))
        .map((theme) => ({
          memberId: targetMember.id,
          themeId: themeMap.get(theme.slug)!,
          rank: theme.rank,
          isTop5: theme.rank <= 5,
          isTop10: theme.rank <= 10,
          personalizedDescription: theme.personalizedDescription,
          // NEW: Store personalized insights array
          personalizedInsights: theme.personalizedInsights || [],
          // NEW: Store strength blends as JSON
          strengthBlends: theme.strengthBlends
            ? JSON.parse(JSON.stringify(theme.strengthBlends))
            : null,
          // NEW: Store apply section as JSON
          applySection: theme.applySection
            ? JSON.parse(JSON.stringify(theme.applySection))
            : null,
        }));

      await prisma.memberStrength.createMany({
        data: strengthsData,
      });

      // Update member
      await prisma.organizationMember.update({
        where: { id: targetMember.id },
        data: {
          strengthsImportedAt: new Date(),
          strengthsDocumentId: document.id,
        },
      });
    }

    return apiCreated({
      documentId: document.id,
      participantName: parsed.participantName,
      themesFound: parsed.themes.length,
      reportType: parsed.reportType,
      confidence: parsed.confidence,
      warnings: validation.warnings,
      assignedTo: targetMember
        ? {
            memberId: targetMember.id,
            name: targetMember.user.fullName,
            email: targetMember.user.email,
          }
        : null,
    });
  } catch (error) {
    if (error instanceof DocumentParseError) {
      const code = error.code === "BUSY" ? ApiErrorCode.RATE_LIMITED : error.code === "UNAVAILABLE" ? ApiErrorCode.INTERNAL_ERROR : ApiErrorCode.VALIDATION_ERROR;
      return apiError(code, error.message);
    }
    if (error instanceof UploadLimitError) return apiError(ApiErrorCode.BAD_REQUEST, error.message);
    console.error("[Strengths Upload Error]");
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to process PDF");
  }
}
