"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/Avatar";
import { ThemeBadge } from "@/components/strengths/ThemeBadge";
import { DomainIcon } from "@/components/strengths/DomainIcon";
import {
  MessageSquarePlus,
  Search,
  ArrowLeft,
  Send,
  Sparkles,
  Check,
  X,
  Lightbulb,
  TrendingUp,
  HelpCircle,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { THEMES, DOMAINS, type DomainSlug } from "@/constants/strengths-data";

interface Member {
  id: string;
  name: string;
  avatarUrl: string | null;
  jobTitle: string | null;
  topStrengths: {
    themeName: string;
    themeSlug: string;
    domain: string;
  }[];
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

// Theme keyword mappings for auto-suggestion
const THEME_KEYWORDS: Record<string, string[]> = {
  achiever: ["completed", "finished", "accomplished", "productive", "delivered", "results", "goal"],
  activator: ["started", "initiated", "launched", "kicked off", "began", "motivated", "action"],
  adaptability: ["flexible", "adapted", "pivoted", "adjusted", "changed", "spontaneous"],
  analytical: ["analyzed", "data", "logic", "evidence", "research", "numbers", "figured out"],
  arranger: ["organized", "coordinated", "managed", "juggled", "orchestrated", "efficiency"],
  belief: ["values", "purpose", "mission", "conviction", "integrity", "principles"],
  command: ["decisive", "led", "directed", "took charge", "confronted", "bold"],
  communication: ["presented", "explained", "storytelling", "articulated", "expressed", "wrote"],
  competition: ["won", "best", "outperformed", "first", "benchmark", "beat"],
  connectedness: ["connected", "linked", "purpose", "bigger picture", "meaning"],
  consistency: ["fair", "equal", "standard", "process", "rules", "uniform"],
  context: ["history", "background", "precedent", "learned from", "pattern"],
  deliberative: ["careful", "thorough", "cautious", "risk", "planned", "anticipated"],
  developer: ["mentored", "coached", "helped grow", "encouraged", "potential", "developed"],
  discipline: ["structure", "routine", "organized", "planned", "systematic", "order"],
  empathy: ["understood", "felt", "sensed", "emotional", "perspective", "compassion"],
  focus: ["prioritized", "concentrated", "goal", "direction", "stayed on track"],
  futuristic: ["vision", "future", "possibilities", "imagine", "dream", "what if"],
  harmony: ["consensus", "agreement", "peace", "common ground", "resolved conflict"],
  ideation: ["idea", "creative", "brainstorm", "innovative", "concept", "new approach"],
  includer: ["included", "welcomed", "belonging", "invited", "acceptance"],
  individualization: ["unique", "individual", "customized", "personalized", "tailored"],
  input: ["collected", "gathered", "curious", "learned", "information", "resources"],
  intellection: ["thought", "reflected", "considered", "pondered", "deep thinking"],
  learner: ["learned", "studied", "curious", "grew", "developed", "mastered"],
  maximizer: ["improved", "excellent", "optimized", "enhanced", "best possible"],
  positivity: ["positive", "enthusiastic", "optimistic", "upbeat", "energized", "fun"],
  relator: ["relationship", "trusted", "genuine", "close", "authentic", "bond"],
  responsibility: ["reliable", "dependable", "committed", "owned", "accountable", "followed through"],
  restorative: ["solved", "fixed", "resolved", "problem", "troubleshot", "diagnosed"],
  "self-assurance": ["confident", "certain", "assured", "trusted instincts", "self-reliant"],
  significance: ["important", "impact", "meaningful", "recognition", "contribution"],
  strategic: ["strategic", "planned", "path", "alternatives", "options", "way forward"],
  woo: ["connected", "networked", "charm", "won over", "rapport", "strangers"],
};

// Recognition quality tips
const QUALITY_TIPS = [
  "Be specific about what they did",
  "Describe the impact on you or the team",
  "Connect it to a strength they demonstrated",
  "Share how it made a difference",
];

// Starter prompts
const STARTER_PROMPTS = [
  "When [person] [action], it helped [outcome]...",
  "I noticed [person] using their [strength] when they...",
  "Thanks to [person]'s work on [project], we were able to...",
  "[Person] really showed their [strength] by...",
];

export default function CreateShoutoutPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedMemberId = searchParams.get("to");

  const [members, setMembers] = useState<Member[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [memberSearch, setMemberSearch] = useState("");

  const [selectedThemeId, setSelectedThemeId] = useState<string | null>(null);
  const [selectedDomain, setSelectedDomain] = useState<DomainSlug | null>(null);
  const [message, setMessage] = useState("");
  const [impact, setImpact] = useState("");
  const [suggestedThemes, setSuggestedThemes] = useState<string[]>([]);
  const [showTips, setShowTips] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // AI Enhancement state
  const [enhancing, setEnhancing] = useState(false);
  const [enhancedMessage, setEnhancedMessage] = useState<string | null>(null);
  const [showEnhanced, setShowEnhanced] = useState(false);

  // Auto-suggest themes based on message content
  useEffect(() => {
    if (message.length < 15) {
      setSuggestedThemes([]);
      return;
    }

    const lowercaseMessage = message.toLowerCase();
    const suggestions: { slug: string; score: number }[] = [];

    Object.entries(THEME_KEYWORDS).forEach(([themeSlug, keywords]) => {
      const matchCount = keywords.filter((kw) => lowercaseMessage.includes(kw)).length;
      if (matchCount > 0) {
        suggestions.push({ slug: themeSlug, score: matchCount });
      }
    });

    // Sort by match count and take top 3
    const topSuggestions = suggestions
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((s) => s.slug);

    setSuggestedThemes(topSuggestions);
  }, [message]);

  // Fetch members
  useEffect(() => {
    fetchMembers();
  }, []);

  // Pre-select member from URL
  useEffect(() => {
    if (preselectedMemberId && members.length > 0) {
      const member = members.find((m) => m.id === preselectedMemberId);
      if (member) setSelectedMember(member);
    }
  }, [preselectedMemberId, members]);

  const fetchMembers = async () => {
    setLoadingMembers(true);
    try {
      const response = await fetch("/api/members?limit=100");
      if (response.ok) {
        const result = await response.json();
        setMembers(result.data);
      }
    } catch (err) {
      console.error("Failed to fetch members:", err);
    } finally {
      setLoadingMembers(false);
    }
  };

  // AI Enhancement handler
  const handleEnhanceMessage = async () => {
    if (!selectedMember || message.length < 10) return;

    setEnhancing(true);
    setError(null);

    try {
      const response = await fetch("/api/ai/enhance-shoutout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          recipientId: selectedMember.id,
          context: impact || undefined,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setError(result.error?.message || "Failed to enhance message");
        return;
      }

      setEnhancedMessage(result.data.enhancedMessage);
      setShowEnhanced(true);
    } catch (err) {
      console.error("AI enhancement error:", err);
      setError("Failed to enhance message. Please try again.");
    } finally {
      setEnhancing(false);
    }
  };

  // Accept enhanced message
  const acceptEnhancedMessage = () => {
    if (enhancedMessage) {
      setMessage(enhancedMessage);
      setEnhancedMessage(null);
      setShowEnhanced(false);
    }
  };

  // Reject enhanced message
  const rejectEnhancedMessage = () => {
    setEnhancedMessage(null);
    setShowEnhanced(false);
  };

  // Fetch theme ID from slug
  const getThemeId = async (slug: string): Promise<string | null> => {
    try {
      const response = await fetch(`/api/themes?slug=${slug}`);
      if (response.ok) {
        const result = await response.json();
        return result.data?.id || null;
      }
    } catch (err) {
      console.error("Failed to fetch theme:", err);
    }
    return null;
  };

  const handleSubmit = async () => {
    if (!selectedMember) {
      setError("Please select a recipient");
      return;
    }
    if (message.length < 10) {
      setError("Message must be at least 10 characters");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      // Get theme ID if selected
      let themeId = null;
      if (selectedThemeId) {
        themeId = await getThemeId(selectedThemeId);
      }

      // Combine message and impact if impact is provided
      const fullMessage = impact.trim()
        ? `${message}\n\nImpact: ${impact}`
        : message;

      const response = await fetch("/api/shoutouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receiverId: selectedMember.id,
          themeId,
          message: fullMessage,
          isPublic: true,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error?.message || "Failed to create shoutout");
        return;
      }

      setSuccess(true);
      setTimeout(() => {
        router.push("/shoutouts");
      }, 1500);
    } catch (err) {
      setError("An unexpected error occurred");
    } finally {
      setSubmitting(false);
    }
  };

  // Filter members based on search
  const filteredMembers = members.filter(
    (m) =>
      m.name.toLowerCase().includes(memberSearch.toLowerCase()) ||
      m.jobTitle?.toLowerCase().includes(memberSearch.toLowerCase())
  );

  // Filter themes based on domain
  const filteredThemes = selectedDomain
    ? THEMES.filter((t) => t.domain === selectedDomain)
    : THEMES;

  if (success) {
    return (
      <div className="max-w-7xl mx-auto">
        <Card className="overflow-hidden">
          <CardContent className="pt-6">
            <div className="text-center py-12">
              <Check className="h-12 w-12 text-domain-strategic mx-auto mb-4" />
              <h2 className="text-2xl font-bold">Shoutout Sent!</h2>
              <p className="text-muted-foreground mt-2">
                {selectedMember?.name} will be notified of your recognition
              </p>
              <div className="mt-4 flex gap-2 justify-center text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Sparkles className="h-4 w-4 text-amber-500" />
                  +5 points for you
                </span>
                <span className="flex items-center gap-1">
                  <Sparkles className="h-4 w-4 text-amber-500" />
                  +10 points for {selectedMember?.name.split(" ")[0]}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/shoutouts">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Link>
        </Button>
      </div>

      <div>
        <h1 className="font-display text-3xl font-bold flex items-center gap-2">
          <MessageSquarePlus className="h-8 w-8 text-domain-influencing" />
          Give a Shoutout
        </h1>
        <p className="text-muted-foreground mt-1">
          Recognize a teammate for demonstrating their strengths
        </p>
      </div>

      {/* Step 1: Select recipient */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">1. Who do you want to recognize?</CardTitle>
          <CardDescription>Select a team member</CardDescription>
        </CardHeader>
        <CardContent>
          {selectedMember ? (
            <div className="flex items-center justify-between p-4 rounded-xl bg-domain-influencing-light/30 dark:bg-domain-influencing/10 border border-domain-influencing/20">
              <div className="flex items-center gap-3">
                <Avatar className="h-12 w-12">
                  <AvatarImage src={selectedMember.avatarUrl || undefined} />
                  <AvatarFallback className="bg-primary text-primary-foreground">
                    {getInitials(selectedMember.name)}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-semibold">{selectedMember.name}</p>
                  {selectedMember.jobTitle && (
                    <p className="text-sm text-muted-foreground">
                      {selectedMember.jobTitle}
                    </p>
                  )}
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelectedMember(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Search team members..."
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                  className="pl-10"
                />
              </div>
              <div className="max-h-60 overflow-y-auto space-y-2">
                {loadingMembers ? (
                  <div className="text-center py-4 text-muted-foreground">Loading...</div>
                ) : filteredMembers.length > 0 ? (
                  filteredMembers.map((member) => (
                    <button
                      key={member.id}
                      onClick={() => setSelectedMember(member)}
                      className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-muted transition-colors text-left"
                    >
                      <Avatar className="h-10 w-10">
                        <AvatarImage src={member.avatarUrl || undefined} />
                        <AvatarFallback className="bg-muted dark:bg-muted/50">
                          {getInitials(member.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{member.name}</p>
                        {member.jobTitle && (
                          <p className="text-sm text-muted-foreground truncate">
                            {member.jobTitle}
                          </p>
                        )}
                      </div>
                      {member.topStrengths.length > 0 && (
                        <div className="flex gap-1">
                          {member.topStrengths.slice(0, 2).map((s) => (
                            <DomainIcon
                              key={s.themeSlug}
                              domain={s.domain as DomainSlug}
                              size="sm"
                            />
                          ))}
                        </div>
                      )}
                    </button>
                  ))
                ) : (
                  <div className="text-center py-4 text-muted-foreground">
                    No members found
                  </div>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Step 2: Select theme (optional) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">2. What strength did they show? (optional)</CardTitle>
          <CardDescription>Select a CliftonStrengths theme</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Domain filter */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => {
                setSelectedDomain(null);
                setSelectedThemeId(null);
              }}
              className={cn(
                "px-3 py-1.5 rounded-full text-sm font-medium transition-all border",
                !selectedDomain
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border hover:border-primary/50"
              )}
            >
              All
            </button>
            {DOMAINS.map((domain) => (
              <button
                key={domain.slug}
                onClick={() => {
                  setSelectedDomain(domain.slug);
                  setSelectedThemeId(null);
                }}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all border",
                  selectedDomain === domain.slug
                    ? `bg-domain-${domain.slug} text-white border-domain-${domain.slug}`
                    : "bg-background border-border hover:border-primary/50"
                )}
              >
                <DomainIcon domain={domain.slug} size="sm" />
                {domain.name.split(" ")[0]}
              </button>
            ))}
          </div>

          {/* Theme selection */}
          <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto">
            {filteredThemes.map((theme) => (
              <button
                key={theme.slug}
                onClick={() =>
                  setSelectedThemeId(selectedThemeId === theme.slug ? null : theme.slug)
                }
                className={cn(
                  "px-3 py-1 rounded-full text-sm transition-all border",
                  selectedThemeId === theme.slug
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted/50 border-border hover:border-primary/50"
                )}
              >
                {theme.name}
              </button>
            ))}
          </div>

          {selectedThemeId && (
            <div className="p-3 rounded-lg bg-muted/50">
              <ThemeBadge
                themeName={THEMES.find((t) => t.slug === selectedThemeId)?.name || ""}
                domainSlug={THEMES.find((t) => t.slug === selectedThemeId)?.domain || "executing"}
                size="default"
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Step 3: Write message */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-lg">3. Write your shoutout</CardTitle>
              <CardDescription>Share how they demonstrated this strength</CardDescription>
            </div>
            <button
              onClick={() => setShowTips(!showTips)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <HelpCircle className="h-4 w-4" />
              Tips
            </button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Quality tips */}
          {showTips && (
            <div className="p-3 rounded-xl bg-domain-strategic/10 border border-domain-strategic/20">
              <div className="flex items-center gap-2 text-sm font-medium text-domain-strategic mb-2">
                <Lightbulb className="h-4 w-4" />
                Recognition Quality Tips
              </div>
              <ul className="space-y-1">
                {QUALITY_TIPS.map((tip, idx) => (
                  <li key={idx} className="text-sm text-muted-foreground flex items-start gap-2">
                    <span className="text-domain-strategic">•</span>
                    {tip}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Starter prompt suggestions */}
          {message.length === 0 && selectedMember && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground font-medium">Try starting with:</p>
              <div className="flex flex-wrap gap-2">
                {STARTER_PROMPTS.map((prompt, idx) => (
                  <button
                    key={idx}
                    onClick={() => setMessage(prompt.replace("[person]", selectedMember.name.split(" ")[0]))}
                    className="text-xs px-3 py-1.5 rounded-full bg-muted hover:bg-muted/80 text-muted-foreground"
                  >
                    {prompt.replace("[person]", selectedMember.name.split(" ")[0]).slice(0, 40)}...
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Main message textarea */}
          <div>
            <label className="text-sm font-medium mb-2 block">
              What specific action did they take?
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Tell them specifically what they did..."
              rows={3}
              className="w-full px-4 py-3 rounded-xl border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
            />
            <div className="flex justify-between items-center mt-2">
              <div className="text-xs text-muted-foreground">
                <span>{message.length} characters</span>
                <span className="mx-2">•</span>
                <span>Minimum 10 characters</span>
              </div>
              {/* AI Enhance Button */}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleEnhanceMessage}
                disabled={!selectedMember || message.length < 10 || enhancing}
                className="text-xs gap-1.5 text-domain-strategic hover:text-domain-strategic hover:bg-domain-strategic/10"
              >
                {enhancing ? (
                  <>
                    <div className="h-3 w-3 border-2 border-domain-strategic border-t-transparent rounded-full animate-spin" />
                    Enhancing...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3 w-3" />
                    Enhance with AI
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* AI Enhanced Message Panel */}
          {showEnhanced && enhancedMessage && (
            <div className="p-4 rounded-xl bg-domain-strategic/10 border border-domain-strategic/30 space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-domain-strategic">
                <Sparkles className="h-4 w-4" />
                AI-Enhanced Version
              </div>
              <p className="text-sm leading-relaxed bg-background/50 p-3 rounded-lg">
                {enhancedMessage}
              </p>
              <div className="flex gap-2 justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={rejectEnhancedMessage}
                  className="text-xs"
                >
                  <X className="h-3 w-3 mr-1" />
                  Keep Original
                </Button>
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={acceptEnhancedMessage}
                  className="text-xs bg-domain-strategic hover:bg-domain-strategic/90"
                >
                  <Check className="h-3 w-3 mr-1" />
                  Use Enhanced
                </Button>
              </div>
            </div>
          )}

          {/* Auto-suggested themes */}
          {suggestedThemes.length > 0 && !selectedThemeId && (
            <div className="p-3 rounded-xl bg-domain-influencing/10 border border-domain-influencing/20">
              <div className="flex items-center gap-2 text-sm font-medium text-domain-influencing mb-2">
                <Sparkles className="h-4 w-4" />
                Suggested strengths based on your message
              </div>
              <div className="flex flex-wrap gap-2">
                {suggestedThemes.map((slug) => {
                  const theme = THEMES.find((t) => t.slug === slug);
                  return theme ? (
                    <button
                      key={slug}
                      onClick={() => setSelectedThemeId(slug)}
                      className="text-sm px-3 py-1 rounded-full bg-card border border-domain-influencing/30 hover:border-domain-influencing text-foreground flex items-center gap-1.5"
                    >
                      <DomainIcon domain={theme.domain} size="sm" />
                      {theme.name}
                    </button>
                  ) : null;
                })}
              </div>
            </div>
          )}

          {/* Impact field (optional) */}
          <div>
            <label className="text-sm font-medium mb-2 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-domain-strategic" />
              Impact (optional)
            </label>
            <textarea
              value={impact}
              onChange={(e) => setImpact(e.target.value)}
              placeholder="How did this help you or the team? What was the outcome?"
              rows={2}
              className="w-full px-4 py-3 rounded-xl border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Describing the impact makes recognition more meaningful
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Error */}
      {error && (
        <div className="p-4 rounded-xl bg-destructive/10 text-destructive text-sm">
          {error}
        </div>
      )}

      {/* Submit */}
      <div className="flex gap-3 justify-end">
        <Button variant="outline" asChild>
          <Link href="/shoutouts">Cancel</Link>
        </Button>
        <Button
          variant="influencing"
          onClick={handleSubmit}
          isLoading={submitting}
          disabled={!selectedMember || message.length < 10}
        >
          <Send className="h-4 w-4 mr-2" />
          Send Shoutout
        </Button>
      </div>
    </div>
  );
}
