import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, ApiErrorCode, apiCreated } from "@/lib/api/response";
import { z } from "zod";

const createPromptSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  description: z.string().optional(),
  category: z.enum(["WRITING_ASSISTANCE", "INSIGHTS", "RECOMMENDATIONS", "CHAT", "ADMIN"]),
  systemPrompt: z.string().min(1),
  userPrompt: z.string().min(1),
  model: z.string().default("gpt-4o"),
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().min(100).max(4000).default(1000),
  variables: z.array(z.string()).default([]),
});

const updatePromptSchema = createPromptSchema.partial().extend({
  id: z.string(),
});

// GET - List all prompt templates
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return apiError(ApiErrorCode.UNAUTHORIZED, "Authentication required");
    }

    const role = session.user.role;
    if (role !== "OWNER" && role !== "ADMIN") {
      return apiError(ApiErrorCode.FORBIDDEN, "Admin access required");
    }

    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category");

    const where = category ? { category: category as never } : {};

    const templates = await prisma.aIPromptTemplate.findMany({
      where,
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });

    return apiSuccess(templates);
  } catch (error) {
    console.error("[Admin AI Prompts GET Error]", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to fetch prompt templates");
  }
}

// POST - Create a new prompt template
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return apiError(ApiErrorCode.UNAUTHORIZED, "Authentication required");
    }

    const role = session.user.role;
    if (role !== "OWNER" && role !== "ADMIN") {
      return apiError(ApiErrorCode.FORBIDDEN, "Admin access required");
    }

    const body = await request.json();
    const validation = createPromptSchema.safeParse(body);

    if (!validation.success) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Invalid input", {
        errors: validation.error.errors,
      });
    }

    // Check for existing slug
    const existing = await prisma.aIPromptTemplate.findUnique({
      where: { slug: validation.data.slug },
    });

    if (existing) {
      return apiError(ApiErrorCode.BAD_REQUEST, "A template with this slug already exists");
    }

    const template = await prisma.aIPromptTemplate.create({
      data: validation.data,
    });

    console.log(`[Admin AI Prompts] Created template: ${template.name}`);

    return apiCreated(template);
  } catch (error) {
    console.error("[Admin AI Prompts POST Error]", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to create prompt template");
  }
}

// PATCH - Update an existing prompt template
export async function PATCH(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return apiError(ApiErrorCode.UNAUTHORIZED, "Authentication required");
    }

    const role = session.user.role;
    if (role !== "OWNER" && role !== "ADMIN") {
      return apiError(ApiErrorCode.FORBIDDEN, "Admin access required");
    }

    const body = await request.json();
    const validation = updatePromptSchema.safeParse(body);

    if (!validation.success) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Invalid input", {
        errors: validation.error.errors,
      });
    }

    const { id, ...updateData } = validation.data;

    // Check if template exists
    const existing = await prisma.aIPromptTemplate.findUnique({
      where: { id },
    });

    if (!existing) {
      return apiError(ApiErrorCode.NOT_FOUND, "Template not found");
    }

    // If updating slug, check it doesn't conflict
    if (updateData.slug && updateData.slug !== existing.slug) {
      const slugExists = await prisma.aIPromptTemplate.findUnique({
        where: { slug: updateData.slug },
      });
      if (slugExists) {
        return apiError(ApiErrorCode.BAD_REQUEST, "A template with this slug already exists");
      }
    }

    const template = await prisma.aIPromptTemplate.update({
      where: { id },
      data: updateData,
    });

    console.log(`[Admin AI Prompts] Updated template: ${template.name}`);

    return apiSuccess(template);
  } catch (error) {
    console.error("[Admin AI Prompts PATCH Error]", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to update prompt template");
  }
}

// DELETE - Delete a prompt template
export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return apiError(ApiErrorCode.UNAUTHORIZED, "Authentication required");
    }

    const role = session.user.role;
    if (role !== "OWNER" && role !== "ADMIN") {
      return apiError(ApiErrorCode.FORBIDDEN, "Admin access required");
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Template ID required");
    }

    const existing = await prisma.aIPromptTemplate.findUnique({
      where: { id },
    });

    if (!existing) {
      return apiError(ApiErrorCode.NOT_FOUND, "Template not found");
    }

    await prisma.aIPromptTemplate.delete({
      where: { id },
    });

    console.log(`[Admin AI Prompts] Deleted template: ${existing.name}`);

    return apiSuccess({ deleted: true, id });
  } catch (error) {
    console.error("[Admin AI Prompts DELETE Error]", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to delete prompt template");
  }
}
