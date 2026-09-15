import { NextRequest, NextResponse } from "next/server";
import type {
  ActivityHandler as ActivityHandlerType,
  CloudAdapter as CloudAdapterType,
  Request as BotFrameworkRequest,
  Response as BotFrameworkResponse,
  TurnContext,
} from "botbuilder";
import { handleTeamsBotCommand } from "@/lib/integrations/teams-bot-handlers";
import { identifyTeamsActivity, isTeamsBotConfigured } from "@/lib/integrations/teams-identity";
import { readTeamsJson, TeamsRequestError } from "@/lib/integrations/teams-request";

/**
 * POST /api/integrations/teams-bot
 *
 * Bot Framework messaging endpoint.
 * Receives Activity objects from Teams and responds with Adaptive Cards.
 *
 * Requires MICROSOFT_APP_ID and MICROSOFT_APP_PASSWORD environment variables.
 *
 * Note: The Bot Framework's CloudAdapter expects Node.js http.IncomingMessage/ServerResponse
 * objects, which differ from Next.js App Router's Web API Request/Response.
 * We bridge this by constructing a compatible shim object.
 *
 * The adapter and bot are lazily initialized to avoid build-time assertion errors
 * from botbuilder when environment variables are not yet available.
 */

type BotFrameworkRequestShim = BotFrameworkRequest & { url: string };
type BotFrameworkResponseShim = BotFrameworkResponse & {
  setHeader(name: string, value: unknown): unknown;
  writeHead(statusCode: number): unknown;
  write(data: unknown): boolean;
};

let _adapter: CloudAdapterType | null = null;
let _bot: ActivityHandlerType | null = null;

function getAdapterAndBot() {
  if (_adapter && _bot) return { adapter: _adapter, bot: _bot };

  const {
    CloudAdapter,
    ConfigurationBotFrameworkAuthentication,
    ActivityHandler,
    CardFactory,
  }: typeof import("botbuilder") = require("botbuilder");

  const botFrameworkAuth = new ConfigurationBotFrameworkAuthentication({
    MicrosoftAppId: process.env.MICROSOFT_APP_ID || "",
    MicrosoftAppPassword: process.env.MICROSOFT_APP_PASSWORD || "",
    MicrosoftAppType: "SingleTenant",
    MicrosoftAppTenantId: process.env.MICROSOFT_APP_TENANT_ID || "",
  });

  const adapter = new CloudAdapter(botFrameworkAuth);

  adapter.onTurnError = async (context: TurnContext, error: Error) => {
    console.error("[Teams Bot] Command failed");
    await context.sendActivity(
      "Sorry, something went wrong processing your message. Please try again."
    );
  };

  class StrengthSyncBot extends ActivityHandler {
    constructor() {
      super();

      this.onMessage(async (context: TurnContext, next: () => Promise<void>) => {
        const identity = identifyTeamsActivity(context.activity);
        if (!identity) {
          await context.sendActivity("Use a personal chat with StrengthSync in the configured Teams organization.");
          return next();
        }
        const messageText = context.activity.text || "";
        if (typeof messageText !== "string" || messageText.length > 2000) {
          await context.sendActivity("Keep your message under 2,000 characters.");
          return next();
        }
        const card = await handleTeamsBotCommand(identity, messageText);
        const adaptiveCard = CardFactory.adaptiveCard(card);
        await context.sendActivity({ attachments: [adaptiveCard] });

        return next();
      });

      this.onMembersAdded(async (context: TurnContext, next: () => Promise<void>) => {
        if (!identifyTeamsActivity(context.activity)) return next();
        for (const member of context.activity.membersAdded || []) {
          if (member.id !== context.activity.recipient.id) {
            const welcomeCard = CardFactory.adaptiveCard({
              $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
              type: "AdaptiveCard",
              version: "1.4",
              body: [
                {
                  type: "TextBlock",
                  text: "Welcome to StrengthSync!",
                  size: "Medium",
                  weight: "Bolder",
                },
                {
                  type: "TextBlock",
                  text: "I can help you interact with your team's CliftonStrengths right from Teams. Type `/help` to see what I can do!",
                  wrap: true,
                  spacing: "Small",
                },
              ],
              actions: [
                {
                  type: "Action.OpenUrl",
                  title: "Open StrengthSync",
                  url: process.env.NEXTAUTH_URL || "https://strengthsync.app",
                },
              ],
            });

            await context.sendActivity({ attachments: [welcomeCard] });
          }
        }
        return next();
      });
    }
  }

  _adapter = adapter;
  _bot = new StrengthSyncBot();

  return { adapter: _adapter, bot: _bot };
}

export async function POST(request: NextRequest) {
  try {
    // Verify that bot credentials are configured
    if (!isTeamsBotConfigured()) {
      return NextResponse.json(
        { error: "Bot not configured" },
        { status: 503 }
      );
    }

    const authHeader = request.headers.get("authorization") || "";
    if (!authHeader.trim()) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const body = await readTeamsJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid activity" }, { status: 400 });
    const { adapter, bot } = getAdapterAndBot();

    // Bridge Next.js App Router Request to Bot Framework compatible format.
    // CloudAdapter.process expects a Node-style Request with a body property.
    const shimRequest: BotFrameworkRequestShim = {
      body: body as Record<string, unknown>,
      headers: {
        authorization: authHeader,
        "content-type": "application/json",
      },
      method: "POST",
      url: request.url,
    };

    // Shim response to collect status/body
    let responseStatus = 200;
    let responseBody = "";
    const shimResponse: BotFrameworkResponseShim = {
      socket: null,
      status: (code: number) => {
        responseStatus = code;
        return shimResponse;
      },
      send: (...args: unknown[]) => {
        responseBody = args[0] == null ? "" : String(args[0]);
        return shimResponse;
      },
      end: (...args: unknown[]) => {
        if (args[0] != null) responseBody += String(args[0]);
        return shimResponse;
      },
      header: () => shimResponse,
      setHeader: () => shimResponse,
      writeHead: (statusCode: number) => {
        responseStatus = statusCode;
        return shimResponse;
      },
      write: (data: unknown) => {
        responseBody += String(data);
        return true;
      },
    };

    // Process the Bot Framework activity
    await adapter.process(
      shimRequest,
      shimResponse,
      async (context: TurnContext) => {
        await bot.run(context);
      }
    );

    return new NextResponse(responseBody || null, { status: responseStatus });
  } catch (error) {
    if (error instanceof TeamsRequestError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error && typeof error === "object" && "statusCode" in error && error.statusCode === 401) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    console.error("[Teams Bot] Request failed");
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
