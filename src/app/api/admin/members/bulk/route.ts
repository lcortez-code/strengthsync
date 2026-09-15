import { protectAuthRequest, authProtectionResponse } from "@/lib/auth/request-protection";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { parseCliftonStrengthsPDF, validateParsedReport } from "@/lib/pdf/parser";
import { apiSuccess, apiError, ApiErrorCode } from "@/lib/api/response";
import { requireInvitationEmail, sendMemberInvitation } from "@/lib/auth/account-emails";
import { readUploadForm, MAX_DOCUMENT_BYTES, UploadLimitError } from "@/lib/api/upload";
import {
  importRowSchema,
  type ImportRowResult,
  type BulkImportResponse,
} from "@/lib/validation/bulk-import";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return apiError(ApiErrorCode.UNAUTHORIZED, "Authentication required");
    }

    const organizationId = session.user.organizationId;
    const userRole = session.user.role;

    if (!organizationId) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Organization membership required");
    }

    // Only admins can bulk import members
    if (userRole !== "OWNER" && userRole !== "ADMIN") {
      return apiError(ApiErrorCode.FORBIDDEN, "Admin access required");
    }

    await protectAuthRequest("bulk-member-create", request.headers, session.user.id);
    requireInvitationEmail();
    const formData = await readUploadForm(request, 50 * 1024 * 1024);

    // Parse member data from form
    const members: Array<{
      email: string;
      fullName: string;
      jobTitle: string;
      department: string;
      pdf: File | null;
    }> = [];

    // Find all unique indices
    const indices = new Set<number>();
    for (const key of formData.keys()) {
      const match = key.match(/^members\[(\d+)\]\./);
      if (match) {
        indices.add(parseInt(match[1], 10));
      }
    }

    // Sort indices and extract data
    const sortedIndices = Array.from(indices).sort((a, b) => a - b);

    for (const index of sortedIndices) {
      const email = formData.get(`members[${index}].email`) as string;
      const fullName = formData.get(`members[${index}].fullName`) as string;
      const jobTitle = (formData.get(`members[${index}].jobTitle`) as string) || "";
      const department = (formData.get(`members[${index}].department`) as string) || "";
      const pdf = formData.get(`members[${index}].pdf`) as File | null;

      if (pdf && pdf.size > MAX_DOCUMENT_BYTES) return apiError(ApiErrorCode.BAD_REQUEST, "Each PDF must be 10 MB or smaller");

      members.push({
        email: email || "",
        fullName: fullName || "",
        jobTitle,
        department,
        pdf: pdf && pdf.size > 0 ? pdf : null,
      });
    }

    if (members.length === 0) {
      return apiError(ApiErrorCode.BAD_REQUEST, "No members provided");
    }

    if (members.length > 50) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Maximum 50 members per import");
    }

    // Validate all member data
    const validationErrors: Array<{ index: number; errors: Record<string, string[]> }> = [];
    for (let i = 0; i < members.length; i++) {
      const result = importRowSchema.safeParse(members[i]);
      if (!result.success) {
        validationErrors.push({
          index: i,
          errors: result.error.flatten().fieldErrors,
        });
      }
    }

    if (validationErrors.length > 0) {
      return apiError(ApiErrorCode.VALIDATION_ERROR, "Validation failed for some members", {
        validationErrors,
      });
    }

    // Check for duplicate emails within request
    const emails = members.map((m) => m.email.toLowerCase());
    const duplicates = emails.filter((email, idx) => emails.indexOf(email) !== idx);
    if (duplicates.length > 0) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Duplicate emails in request", {
        duplicates: [...new Set(duplicates)],
      });
    }

    // Pre-fetch theme records for PDF processing
    const themeRecords = await prisma.strengthTheme.findMany();
    const themeMap = new Map(themeRecords.map((t) => [t.slug, t.id]));

    // Process each member
    const results: ImportRowResult[] = [];

    for (let i = 0; i < members.length; i++) {
      const member = members[i];
      const normalizedEmail = member.email.toLowerCase().trim();

      try {
        // Check if user already exists in this organization
        const existingUser = await prisma.user.findUnique({
          where: { email: normalizedEmail },
          select: {
            id: true,
            email: true,
            fullName: true, emailVerificationRequired: true, emailVerified: true,
            organizationMemberships: {
              where: { organizationId },
            },
          },
        });

        if (existingUser?.organizationMemberships.length) {
          results.push({
            rowIndex: i,
            email: normalizedEmail,
            success: false,
            error: "User is already a member of this organization",
          });
          continue;
        }

        if (existingUser) {
          requireInvitationEmail();
          const membership = await prisma.organizationMember.create({
            data: { userId: existingUser.id, organizationId, role: "MEMBER", status: "PENDING" },
            include: { organization: { select: { name: true } } },
          });
          let invitationSent = true;
          try {
            await sendMemberInvitation({ ...membership, user: existingUser });
          } catch {
            invitationSent = false;
            console.error("Bulk invitation email could not be delivered");
          }
          results.push({
            rowIndex: i, email: normalizedEmail, success: true,
            data: { memberId: membership.id, userId: existingUser.id, isNewUser: false,
              status: "PENDING", invitationSent, strengthsImported: false,
              message: invitationSent ? "Invitation sent. Import strengths after the recipient accepts." : "Invitation saved, but email delivery failed. Resend from the member list." },
          });
          continue;
        }

        // Decode optional documents before opening a database transaction.
        let parsedPdf: Awaited<ReturnType<typeof parseCliftonStrengthsPDF>> | undefined;
        if (member.pdf) {
          try {
            const parsed = await parseCliftonStrengthsPDF(Buffer.from(await member.pdf.arrayBuffer()));
            if (validateParsedReport(parsed).valid && parsed.themes.length > 0) parsedPdf = parsed;
          } catch {
            console.error("Bulk import PDF could not be processed");
          }
        }

        // Process this new member in a transaction
        const result = await prisma.$transaction(async (tx) => {
          const newUser = await tx.user.create({
            data: { email: normalizedEmail, passwordHash: null, emailVerified: false, emailVerificationRequired: true, fullName: member.fullName.trim(),
              jobTitle: member.jobTitle.trim() || null, department: member.department.trim() || null },
          });
          const userId = newUser.id;
          const isNewUser = true;

          // Create membership
          const membership = await tx.organizationMember.create({
            data: {
              userId,
              organizationId,
              role: "MEMBER",
              status: "PENDING",
            },
          });

          let strengthsImported = false;
          let themesFound = 0;

          // Process PDF if provided
          if (member.pdf && parsedPdf) {
            const parsed = parsedPdf;
            // Store document
            const document = await tx.strengthsDocument.create({
              data: {
                uploadedById: session.user.id,
                fileName: member.pdf.name,
                fileSize: member.pdf.size,
                mimeType: member.pdf.type,
                processingStatus: "COMPLETED",
                extractedData: JSON.parse(JSON.stringify(parsed)),
              },
            });

            // Create strengths
            const strengthsData = parsed.themes
              .filter((t) => themeMap.has(t.slug))
              .map((theme) => ({
                memberId: membership.id,
                themeId: themeMap.get(theme.slug)!,
                rank: theme.rank,
                isTop5: theme.rank <= 5,
                isTop10: theme.rank <= 10,
                personalizedDescription: theme.personalizedDescription,
              }));

            if (strengthsData.length > 0) {
              await tx.memberStrength.createMany({
                data: strengthsData,
              });

              // Update member with document reference
              await tx.organizationMember.update({
                where: { id: membership.id },
                data: {
                  strengthsImportedAt: new Date(),
                  strengthsDocumentId: document.id,
                },
              });

              strengthsImported = true;
              themesFound = strengthsData.length;
            }
          }

          return {
            memberId: membership.id,
            userId,
            user: newUser,
            invitation: await tx.organizationMember.findUniqueOrThrow({ where: { id: membership.id }, include: { organization: { select: { name: true } } } }),
            isNewUser,
            strengthsImported,
            themesFound,
          };
        });

        const { user, invitation, ...importResult } = result;
        let invitationSent = true;
        try { await sendMemberInvitation({ ...invitation, user }); } catch { invitationSent = false; }
        results.push({
          rowIndex: i, email: normalizedEmail, success: true,
          data: { ...importResult, status: "PENDING", invitationSent,
            message: invitationSent ? "Invitation sent. The recipient must verify email and accept before joining." : "Invitation saved, but email delivery failed. Resend from the member list." },
        });
      } catch (error) {
        console.error("Bulk member import failed");
        results.push({
          rowIndex: i,
          email: normalizedEmail,
          success: false,
          error: "Failed to process member. Check the member list before retrying.",
        });
      }
    }

    const response: BulkImportResponse = {
      totalProcessed: results.length,
      successful: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    };

    console.log(
      `[Bulk Import] Processed ${response.totalProcessed} members: ${response.successful} successful, ${response.failed} failed`
    );

    return apiSuccess(response);
  } catch (error) {
    const protection = authProtectionResponse(error);
    if (protection) return protection;
    if (error instanceof UploadLimitError) return apiError(ApiErrorCode.BAD_REQUEST, error.message);
    console.error("Bulk import failed");
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to process bulk import");
  }
}
