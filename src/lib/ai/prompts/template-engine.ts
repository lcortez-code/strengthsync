import { prisma } from "@/lib/prisma";
import type { AIPromptCategory } from "@prisma/client";

export interface TemplateVariables {
  [key: string]: string | number | boolean | string[] | undefined;
}

export interface PromptTemplate {
  name: string;
  systemPrompt: string;
  userPrompt: string;
  model: string;
  temperature: number;
  maxTokens: number;
  variables: string[];
}

// Render a template by replacing {{variable}} placeholders
export function renderTemplate(
  template: string,
  variables: TemplateVariables
): string {
  let result = template;

  // Replace all {{variable}} patterns
  const variablePattern = /\{\{(\w+)\}\}/g;

  result = result.replace(variablePattern, (match, varName) => {
    const value = variables[varName];

    if (value === undefined) {
      console.warn(`Template variable '${varName}' not provided`);
      return match; // Keep original if not found
    }

    if (Array.isArray(value)) {
      return value.join(", ");
    }

    return String(value);
  });

  return result;
}

// Extract variable names from a template
export function extractVariables(template: string): string[] {
  const variablePattern = /\{\{(\w+)\}\}/g;
  const variables: string[] = [];
  let match;

  while ((match = variablePattern.exec(template)) !== null) {
    if (!variables.includes(match[1])) {
      variables.push(match[1]);
    }
  }

  return variables;
}

// Validate that all required variables are provided
export function validateVariables(
  template: string,
  variables: TemplateVariables
): { valid: boolean; missing: string[] } {
  const required = extractVariables(template);
  const missing = required.filter((v) => variables[v] === undefined);

  return {
    valid: missing.length === 0,
    missing,
  };
}

// Get a prompt template from database or use hardcoded default
export async function getPromptTemplate(
  name: string
): Promise<PromptTemplate | null> {
  // Try to get from database first
  const dbTemplate = await prisma.aIPromptTemplate.findUnique({
    where: { name, isActive: true },
  });

  if (dbTemplate) {
    return {
      name: dbTemplate.name,
      systemPrompt: dbTemplate.systemPrompt,
      userPrompt: dbTemplate.userPrompt,
      model: dbTemplate.model,
      temperature: dbTemplate.temperature,
      maxTokens: dbTemplate.maxTokens,
      variables: dbTemplate.variables,
    };
  }

  // Fall back to hardcoded templates
  return getHardcodedTemplate(name);
}

// Hardcoded default templates
const HARDCODED_TEMPLATES: Record<string, PromptTemplate> = {
  "shoutout-generator": {
    name: "shoutout-generator",
    systemPrompt: `You are a recognition message enhancer for a CliftonStrengths-based team collaboration app.
Your role is to help users write more impactful recognition messages (shoutouts) that:
1. Connect the recognition to specific CliftonStrengths themes when relevant
2. Are genuine and specific, not generic
3. Highlight the impact of the person's contribution
4. Maintain the original sentiment and intent

Keep responses concise (2-3 sentences max). Never invent facts not present in the original message.`,
    userPrompt: `Please enhance this recognition message for {{recipientName}}:

Original message: "{{originalMessage}}"

{{#if recipientStrengths}}
Recipient's top strengths: {{recipientStrengths}}
{{/if}}

{{#if context}}
Additional context: {{context}}
{{/if}}

Provide an enhanced version that is more impactful while staying true to the original intent.`,
    model: "gpt-4o-mini",
    temperature: 0.8,
    maxTokens: 500,
    variables: ["recipientName", "originalMessage", "recipientStrengths", "context"],
  },

  "coaching-tips": {
    name: "coaching-tips",
    systemPrompt: `You are a CliftonStrengths coach providing personalized development tips.
Use the Gallup CliftonStrengths framework to give actionable, specific advice.
Focus on leveraging strengths rather than fixing weaknesses.
Keep tips practical and immediately actionable.`,
    userPrompt: `Provide 3-5 coaching tips for {{userName}} based on their strengths profile.

Top strengths: {{topStrengths}}
{{#if dominantDomain}}
Dominant domain: {{dominantDomain}}
{{/if}}

{{#if focusArea}}
Focus area: {{focusArea}}
{{/if}}

Format as a bulleted list with brief explanations.`,
    model: "gpt-4o",
    temperature: 0.7,
    maxTokens: 800,
    variables: ["userName", "topStrengths", "dominantDomain", "focusArea"],
  },

  "review-assistant": {
    name: "review-assistant",
    systemPrompt: `You are a performance review writing assistant that incorporates CliftonStrengths insights.
Help managers write constructive, strengths-based performance feedback.
Focus on:
1. Specific examples tied to strengths
2. Development opportunities that leverage existing strengths
3. Clear, actionable goals
4. Positive, growth-oriented language`,
    userPrompt: `Help write a performance review section for {{employeeName}}.

Their top strengths: {{topStrengths}}
Recent accomplishments: {{accomplishments}}
Areas for development: {{developmentAreas}}

{{#if context}}
Additional context: {{context}}
{{/if}}

Write a balanced, strengths-based review paragraph.`,
    model: "gpt-4o",
    temperature: 0.6,
    maxTokens: 1000,
    variables: ["employeeName", "topStrengths", "accomplishments", "developmentAreas", "context"],
  },

  "goal-suggester": {
    name: "goal-suggester",
    systemPrompt: `You are a development goal generator using the CliftonStrengths framework.
Create SMART goals (Specific, Measurable, Achievable, Relevant, Time-bound) that:
1. Leverage the person's top strengths
2. Address development areas through a strengths lens
3. Are practical and achievable within a review period
4. Contribute to both individual and team success`,
    userPrompt: `Suggest 3 development goals for {{employeeName}}.

Their top strengths: {{topStrengths}}
Role: {{role}}
{{#if teamContext}}
Team context: {{teamContext}}
{{/if}}
{{#if focusAreas}}
Focus areas: {{focusAreas}}
{{/if}}

Format each goal with:
- Goal title
- Description
- How it leverages their strengths
- Suggested timeline`,
    model: "gpt-4o",
    temperature: 0.7,
    maxTokens: 1000,
    variables: ["employeeName", "topStrengths", "role", "teamContext", "focusAreas"],
  },

  "partnership-insights": {
    name: "partnership-insights",
    systemPrompt: `You are a team dynamics expert specializing in CliftonStrengths partnerships.
Analyze how two people's strengths can complement each other.
Focus on:
1. Complementary strengths that create synergy
2. Potential blind spots to watch for
3. Practical collaboration strategies
4. Communication tips based on dominant domains`,
    userPrompt: `Analyze the partnership potential between {{person1Name}} and {{person2Name}}.

{{person1Name}}'s top strengths: {{person1Strengths}}
{{person2Name}}'s top strengths: {{person2Strengths}}

{{#if projectContext}}
Project context: {{projectContext}}
{{/if}}

Provide:
1. Key synergies
2. Potential challenges
3. Collaboration tips`,
    model: "gpt-4o",
    temperature: 0.7,
    maxTokens: 800,
    variables: ["person1Name", "person1Strengths", "person2Name", "person2Strengths", "projectContext"],
  },

  "team-narrative": {
    name: "team-narrative",
    systemPrompt: `You are a team dynamics storyteller who translates CliftonStrengths data into compelling narratives.
Create engaging, insightful summaries that help teams understand their collective strengths.
Use vivid language and metaphors when appropriate.
Be positive but also honest about potential challenges.`,
    userPrompt: `Write a narrative summary of this team's strengths composition.

Team: {{teamName}} ({{memberCount}} members)

Domain distribution:
{{domainDistribution}}

Top themes:
{{topThemes}}

{{#if gaps}}
Gaps identified:
{{gaps}}
{{/if}}

Write a 2-3 paragraph narrative that:
1. Describes the team's collective identity
2. Highlights unique strengths and capabilities
3. Suggests areas for growth or attention`,
    model: "gpt-4o",
    temperature: 0.7,
    maxTokens: 1500,
    variables: ["teamName", "memberCount", "domainDistribution", "topThemes", "gaps"],
  },

  "bio-generator": {
    name: "bio-generator",
    systemPrompt: `You are a professional bio writer who incorporates CliftonStrengths into compelling personal narratives.
Write bios that are:
1. Authentic and personable
2. Strengths-focused without being jargon-heavy
3. Appropriate for the chosen tone (professional, casual, or leadership)
4. Concise but impactful`,
    userPrompt: `Write a {{style}} bio for {{userName}}.

Top strengths: {{topStrengths}}
{{#if jobTitle}}
Role: {{jobTitle}}
{{/if}}
{{#if department}}
Department: {{department}}
{{/if}}
{{#if interests}}
Interests: {{interests}}
{{/if}}

Keep it to 2-3 sentences.`,
    model: "gpt-4o-mini",
    temperature: 0.8,
    maxTokens: 300,
    variables: ["style", "userName", "topStrengths", "jobTitle", "department", "interests"],
  },
};

function getHardcodedTemplate(name: string): PromptTemplate | null {
  return HARDCODED_TEMPLATES[name] || null;
}

// List all available templates
export async function listTemplates(
  category?: AIPromptCategory
): Promise<Array<{ name: string; description: string | null; category: AIPromptCategory }>> {
  const dbTemplates = await prisma.aIPromptTemplate.findMany({
    where: {
      isActive: true,
      ...(category && { category }),
    },
    select: {
      name: true,
      description: true,
      category: true,
    },
  });

  // Add hardcoded templates that aren't in DB
  const hardcodedEntries = Object.entries(HARDCODED_TEMPLATES)
    .filter(([name]) => !dbTemplates.some((t) => t.name === name))
    .map(([name]) => ({
      name,
      description: `Built-in ${name} template`,
      category: "WRITING_ASSISTANCE" as AIPromptCategory,
    }));

  return [...dbTemplates, ...hardcodedEntries];
}

// Create or update a template in the database
export async function saveTemplate(
  template: PromptTemplate & { description?: string; category: AIPromptCategory }
): Promise<void> {
  await prisma.aIPromptTemplate.upsert({
    where: { name: template.name },
    create: {
      name: template.name,
      slug: template.name.toLowerCase().replace(/\s+/g, "-"),
      description: template.description,
      category: template.category,
      systemPrompt: template.systemPrompt,
      userPrompt: template.userPrompt,
      model: template.model,
      temperature: template.temperature,
      maxTokens: template.maxTokens,
      variables: template.variables,
    },
    update: {
      description: template.description,
      systemPrompt: template.systemPrompt,
      userPrompt: template.userPrompt,
      model: template.model,
      temperature: template.temperature,
      maxTokens: template.maxTokens,
      variables: template.variables,
      version: { increment: 1 },
    },
  });
}
