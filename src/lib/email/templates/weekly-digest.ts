/**
 * Weekly Digest Email Template
 * A comprehensive weekly summary of strengths activity
 */
import { escapeHtml, safeEmailUrl } from "@/lib/email/html";

// Domain colors from the app
const DOMAIN_COLORS = {
  executing: "#7B68EE",
  influencing: "#F5A623",
  relationship: "#4A90D9",
  strategic: "#7CB342",
};

interface ShoutoutSummary {
  id: string;
  giverName: string;
  giverAvatarUrl?: string;
  themeName?: string;
  domainSlug?: string;
  message: string;
  createdAt: string;
}

interface BadgeEarned {
  name: string;
  description: string;
  iconUrl: string;
  earnedAt: string;
}

interface ChallengeProgress {
  name: string;
  type: string;
  progress: number; // 0-100
  endsAt: string;
}

interface TopContributor {
  name: string;
  avatarUrl?: string;
  points: number;
  rank: number;
}

export interface WeeklyDigestData {
  userName: string;
  userEmail: string;
  organizationName: string;
  periodStart: Date;
  periodEnd: Date;

  // Stats
  shoutoutsReceived: ShoutoutSummary[];
  shoutoutsGiven: number;
  pointsEarned: number;
  totalPoints: number;
  currentStreak: number;

  // Achievements
  badgesEarned: BadgeEarned[];
  badgeProgress?: { badgeName: string; current: number; required: number };

  // Challenges
  activeChallenges: ChallengeProgress[];

  // Leaderboard
  userRank?: number;
  topContributors: TopContributor[];

  // Suggestions
  suggestedActions: string[];

  // AI-generated personalized narrative (optional)
  aiNarrative?: string;

  // Links
  appUrl: string;
  unsubscribeUrl: string;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getDomainColor(slug?: string): string {
  if (!slug || !Object.hasOwn(DOMAIN_COLORS, slug)) return "#6B7280";
  return DOMAIN_COLORS[slug as keyof typeof DOMAIN_COLORS] || "#6B7280";
}

function generateShoutoutCard(shoutout: ShoutoutSummary, appUrl: string): string {
  const domainColor = getDomainColor(shoutout.domainSlug);
  const initial = escapeHtml(shoutout.giverName.charAt(0).toUpperCase());
  const avatarUrl = shoutout.giverAvatarUrl ? safeEmailUrl(shoutout.giverAvatarUrl, appUrl) : "";

  return `
    <div style="background: #F9FAFB; border-radius: 8px; padding: 16px; margin-bottom: 12px;">
      <div style="display: flex; align-items: flex-start;">
        <div style="width: 40px; height: 40px; border-radius: 50%; background: ${domainColor}; color: white; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 16px; margin-right: 12px; flex-shrink: 0;">
          ${
            avatarUrl
              ? `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(shoutout.giverName)}" style="width: 40px; height: 40px; border-radius: 50%;" />`
              : initial
          }
        </div>
        <div style="flex: 1;">
          <div style="font-weight: 600; color: #111827; margin-bottom: 4px;">${escapeHtml(shoutout.giverName)}</div>
          ${
            shoutout.themeName
              ? `<span style="display: inline-block; background: ${domainColor}20; color: ${domainColor}; font-size: 12px; padding: 2px 8px; border-radius: 12px; margin-bottom: 8px;">${escapeHtml(shoutout.themeName)}</span>`
              : ""
          }
          <p style="color: #4B5563; margin: 0; font-size: 14px; line-height: 1.5;">"${escapeHtml(shoutout.message)}"</p>
        </div>
      </div>
    </div>
  `;
}

function generateBadgeCard(badge: BadgeEarned, appUrl: string): string {
  const iconUrl = safeEmailUrl(badge.iconUrl, appUrl);
  return `
    <div style="text-align: center; padding: 12px;">
      ${iconUrl ? `<img src="${escapeHtml(iconUrl)}" alt="${escapeHtml(badge.name)}" style="width: 48px; height: 48px; margin-bottom: 8px;" />` : ""}
      <div style="font-weight: 600; color: #111827; font-size: 14px;">${escapeHtml(badge.name)}</div>
      <div style="color: #6B7280; font-size: 12px;">${escapeHtml(badge.description)}</div>
    </div>
  `;
}

function generateChallengeCard(challenge: ChallengeProgress): string {
  const progressWidth = Number.isFinite(challenge.progress) ? Math.max(0, Math.min(challenge.progress, 100)) : 0;
  return `
    <div style="background: #F9FAFB; border-radius: 8px; padding: 16px; margin-bottom: 12px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <span style="font-weight: 600; color: #111827;">${escapeHtml(challenge.name)}</span>
        <span style="color: #6B7280; font-size: 12px;">Ends ${escapeHtml(challenge.endsAt)}</span>
      </div>
      <div style="background: #E5E7EB; border-radius: 4px; height: 8px; overflow: hidden;">
        <div style="background: linear-gradient(90deg, #7B68EE, #F5A623); height: 100%; width: ${progressWidth}%; transition: width 0.3s;"></div>
      </div>
      <div style="text-align: right; margin-top: 4px; font-size: 12px; color: #6B7280;">${escapeHtml(challenge.progress)}% complete</div>
    </div>
  `;
}

function generateLeaderboardRow(
  contributor: TopContributor,
  isCurrentUser: boolean
): string {
  const bgColor = isCurrentUser ? "#EEF2FF" : "transparent";
  const rankColors: Record<number, string> = {
    1: "#FFD700",
    2: "#C0C0C0",
    3: "#CD7F32",
  };
  const rankColor = Object.hasOwn(rankColors, contributor.rank) ? rankColors[contributor.rank] : "#6B7280";

  return `
    <tr style="background: ${bgColor};">
      <td style="padding: 8px 12px; font-weight: ${isCurrentUser ? "600" : "400"}; color: ${rankColor};">#${escapeHtml(contributor.rank)}</td>
      <td style="padding: 8px 12px; font-weight: ${isCurrentUser ? "600" : "400"}; color: #111827;">${escapeHtml(contributor.name)}${isCurrentUser ? " (You)" : ""}</td>
      <td style="padding: 8px 12px; text-align: right; font-weight: 600; color: #7B68EE;">${escapeHtml(contributor.points.toLocaleString())}</td>
    </tr>
  `;
}

export function generateWeeklyDigestHtml(data: WeeklyDigestData): string {
  const {
    userName,
    organizationName,
    periodStart,
    periodEnd,
    shoutoutsReceived,
    shoutoutsGiven,
    pointsEarned,
    totalPoints,
    currentStreak,
    badgesEarned,
    badgeProgress,
    activeChallenges,
    userRank,
    topContributors,
    suggestedActions,
    aiNarrative,
  } = data;

  const appUrl = safeEmailUrl(data.appUrl) || "https://strengthsync.app";
  const unsubscribeUrl = safeEmailUrl(data.unsubscribeUrl, appUrl) || appUrl;
  const preferencesUrl = safeEmailUrl(`${appUrl.replace(/\/$/, "")}/settings/notifications`);

  const firstName = userName.split(" ")[0];
  const dateRange = `${formatDate(periodStart)} - ${formatDate(periodEnd)}`;

  // Build sections
  const shoutoutsSection =
    shoutoutsReceived.length > 0
      ? `
    <div style="margin-bottom: 32px;">
      <h2 style="color: #111827; font-size: 18px; margin-bottom: 16px; display: flex; align-items: center;">
        <span style="margin-right: 8px;">🎉</span> Recognition Received (${shoutoutsReceived.length})
      </h2>
      ${shoutoutsReceived.map((shoutout) => generateShoutoutCard(shoutout, appUrl)).join("")}
    </div>
  `
      : "";

  const badgesSection =
    badgesEarned.length > 0
      ? `
    <div style="margin-bottom: 32px;">
      <h2 style="color: #111827; font-size: 18px; margin-bottom: 16px; display: flex; align-items: center;">
        <span style="margin-right: 8px;">🏆</span> Badges Earned
      </h2>
      <div style="display: flex; flex-wrap: wrap; gap: 16px; background: #F9FAFB; border-radius: 8px; padding: 16px;">
        ${badgesEarned.map((badge) => generateBadgeCard(badge, appUrl)).join("")}
      </div>
    </div>
  `
      : "";

  const badgeProgressSection = badgeProgress
    ? `
    <div style="background: #FEF3C7; border-radius: 8px; padding: 16px; margin-bottom: 32px;">
      <div style="font-weight: 600; color: #92400E; margin-bottom: 8px;">📍 Almost there!</div>
      <div style="color: #78350F;">You're ${escapeHtml(badgeProgress.current)}/${escapeHtml(badgeProgress.required)} toward earning the <strong>${escapeHtml(badgeProgress.badgeName)}</strong> badge!</div>
    </div>
  `
    : "";

  const challengesSection =
    activeChallenges.length > 0
      ? `
    <div style="margin-bottom: 32px;">
      <h2 style="color: #111827; font-size: 18px; margin-bottom: 16px; display: flex; align-items: center;">
        <span style="margin-right: 8px;">🎯</span> Active Challenges
      </h2>
      ${activeChallenges.map(generateChallengeCard).join("")}
    </div>
  `
      : "";

  const leaderboardSection =
    topContributors.length > 0
      ? `
    <div style="margin-bottom: 32px;">
      <h2 style="color: #111827; font-size: 18px; margin-bottom: 16px; display: flex; align-items: center;">
        <span style="margin-right: 8px;">🏅</span> Leaderboard${userRank ? ` (You're #${escapeHtml(userRank)})` : ""}
      </h2>
      <table style="width: 100%; border-collapse: collapse; background: #F9FAFB; border-radius: 8px; overflow: hidden;">
        <thead>
          <tr style="background: #E5E7EB;">
            <th style="padding: 12px; text-align: left; font-size: 12px; color: #6B7280; text-transform: uppercase;">Rank</th>
            <th style="padding: 12px; text-align: left; font-size: 12px; color: #6B7280; text-transform: uppercase;">Member</th>
            <th style="padding: 12px; text-align: right; font-size: 12px; color: #6B7280; text-transform: uppercase;">Points</th>
          </tr>
        </thead>
        <tbody>
          ${topContributors.map((c) => generateLeaderboardRow(c, c.name === userName)).join("")}
        </tbody>
      </table>
    </div>
  `
      : "";

  const suggestionsSection =
    suggestedActions.length > 0
      ? `
    <div style="margin-bottom: 32px;">
      <h2 style="color: #111827; font-size: 18px; margin-bottom: 16px; display: flex; align-items: center;">
        <span style="margin-right: 8px;">💡</span> Suggested Actions
      </h2>
      <ul style="margin: 0; padding: 0 0 0 20px; color: #4B5563;">
        ${suggestedActions.map((action) => `<li style="margin-bottom: 8px;">${escapeHtml(action)}</li>`).join("")}
      </ul>
    </div>
  `
      : "";

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Weekly StrengthSync Digest</title>
</head>
<body style="margin: 0; padding: 0; background-color: #F3F4F6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #7B68EE 0%, #F5A623 50%, #4A90D9 75%, #7CB342 100%); border-radius: 12px 12px 0 0; padding: 32px; text-align: center;">
      <h1 style="color: white; margin: 0 0 8px 0; font-size: 28px; font-weight: 700;">StrengthSync</h1>
      <p style="color: rgba(255,255,255,0.9); margin: 0; font-size: 14px;">Weekly Digest • ${escapeHtml(dateRange)}</p>
    </div>

    <!-- Main Content -->
    <div style="background: white; padding: 32px; border-radius: 0 0 12px 12px;">
      <!-- Greeting -->
      <p style="font-size: 16px; color: #374151; margin: 0 0 24px 0;">
        Hi ${escapeHtml(firstName)}! 👋 Here's what happened this week at <strong>${escapeHtml(organizationName)}</strong>.
      </p>

      ${aiNarrative ? `
      <!-- AI Narrative -->
      <div style="background: linear-gradient(135deg, #F3E8FF 0%, #DBEAFE 100%); border-radius: 12px; padding: 20px; margin-bottom: 24px; border-left: 4px solid #7B68EE;">
        <div style="display: flex; align-items: center; margin-bottom: 8px;">
          <span style="font-size: 16px; margin-right: 8px;">✨</span>
          <span style="font-weight: 600; color: #5B21B6; font-size: 14px;">Your Week in Strengths</span>
        </div>
        <p style="color: #374151; margin: 0; font-size: 15px; line-height: 1.6; font-style: italic;">${escapeHtml(aiNarrative)}</p>
      </div>
      ` : ""}

      <!-- Stats Overview -->
      <div style="display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 32px;">
        <div style="flex: 1; min-width: 120px; background: #F3E8FF; border-radius: 8px; padding: 16px; text-align: center;">
          <div style="font-size: 24px; font-weight: 700; color: #7B68EE;">${shoutoutsReceived.length}</div>
          <div style="font-size: 12px; color: #6B21A8;">Received</div>
        </div>
        <div style="flex: 1; min-width: 120px; background: #FEF3C7; border-radius: 8px; padding: 16px; text-align: center;">
          <div style="font-size: 24px; font-weight: 700; color: #F59E0B;">${escapeHtml(shoutoutsGiven)}</div>
          <div style="font-size: 12px; color: #92400E;">Given</div>
        </div>
        <div style="flex: 1; min-width: 120px; background: #DBEAFE; border-radius: 8px; padding: 16px; text-align: center;">
          <div style="font-size: 24px; font-weight: 700; color: #2563EB;">+${escapeHtml(pointsEarned)}</div>
          <div style="font-size: 12px; color: #1E40AF;">Points</div>
        </div>
        <div style="flex: 1; min-width: 120px; background: #D1FAE5; border-radius: 8px; padding: 16px; text-align: center;">
          <div style="font-size: 24px; font-weight: 700; color: #059669;">${escapeHtml(currentStreak)}🔥</div>
          <div style="font-size: 12px; color: #065F46;">Streak</div>
        </div>
      </div>

      ${shoutoutsSection}
      ${badgesSection}
      ${badgeProgressSection}
      ${challengesSection}
      ${leaderboardSection}
      ${suggestionsSection}

      <!-- CTA Button -->
      <div style="text-align: center; margin: 32px 0;">
        <a href="${escapeHtml(appUrl)}" style="display: inline-block; background: linear-gradient(135deg, #7B68EE, #4A90D9); color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">
          Open StrengthSync
        </a>
      </div>

      <!-- Total Points -->
      <div style="text-align: center; padding: 16px; background: #F9FAFB; border-radius: 8px; margin-bottom: 24px;">
        <span style="color: #6B7280;">Your total points:</span>
        <span style="font-weight: 700; color: #7B68EE; font-size: 20px; margin-left: 8px;">${escapeHtml(totalPoints.toLocaleString())}</span>
      </div>
    </div>

    <!-- Footer -->
    <div style="text-align: center; padding: 24px; color: #6B7280; font-size: 12px;">
      <p style="margin: 0 0 8px 0;">
        You're receiving this because you're a member of ${escapeHtml(organizationName)} on StrengthSync.
      </p>
      <p style="margin: 0;">
        <a href="${escapeHtml(unsubscribeUrl)}" style="color: #6B7280; text-decoration: underline;">Unsubscribe</a> or
        <a href="${escapeHtml(preferencesUrl)}" style="color: #6B7280; text-decoration: underline;">manage email preferences</a>
      </p>
    </div>
  </div>
</body>
</html>
`;
}

export function generateWeeklyDigestText(data: WeeklyDigestData): string {
  const {
    userName,
    organizationName,
    periodStart,
    periodEnd,
    shoutoutsReceived,
    shoutoutsGiven,
    pointsEarned,
    totalPoints,
    currentStreak,
    badgesEarned,
    activeChallenges,
    suggestedActions,
    aiNarrative,
  } = data;

  const appUrl = safeEmailUrl(data.appUrl) || "https://strengthsync.app";
  const unsubscribeUrl = safeEmailUrl(data.unsubscribeUrl, appUrl) || appUrl;

  const firstName = userName.split(" ")[0];
  const dateRange = `${formatDate(periodStart)} - ${formatDate(periodEnd)}`;

  let text = `
STRENGTHSYNC WEEKLY DIGEST
${dateRange}

Hi ${firstName}!

Here's what happened this week at ${organizationName}.
${aiNarrative ? `
✨ YOUR WEEK IN STRENGTHS
${aiNarrative}
` : ""}
---

📊 YOUR STATS
• Shoutouts received: ${shoutoutsReceived.length}
• Shoutouts given: ${shoutoutsGiven}
• Points earned: +${pointsEarned}
• Current streak: ${currentStreak} days
• Total points: ${totalPoints.toLocaleString()}

`;

  if (shoutoutsReceived.length > 0) {
    text += `---

🎉 RECOGNITION RECEIVED

`;
    shoutoutsReceived.forEach((s) => {
      text += `From ${s.giverName}${s.themeName ? ` (${s.themeName})` : ""}:
"${s.message}"

`;
    });
  }

  if (badgesEarned.length > 0) {
    text += `---

🏆 BADGES EARNED

`;
    badgesEarned.forEach((b) => {
      text += `• ${b.name}: ${b.description}\n`;
    });
    text += "\n";
  }

  if (activeChallenges.length > 0) {
    text += `---

🎯 ACTIVE CHALLENGES

`;
    activeChallenges.forEach((c) => {
      text += `• ${c.name}: ${c.progress}% complete (ends ${c.endsAt})\n`;
    });
    text += "\n";
  }

  if (suggestedActions.length > 0) {
    text += `---

💡 SUGGESTED ACTIONS

`;
    suggestedActions.forEach((a) => {
      text += `• ${a}\n`;
    });
    text += "\n";
  }

  text += `---

Open StrengthSync: ${appUrl}

---

You're receiving this because you're a member of ${organizationName}.
Unsubscribe: ${unsubscribeUrl}
`;

  return text;
}
