"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/Avatar";
import { DomainIcon } from "@/components/strengths/DomainIcon";
import { ThemeBadge } from "@/components/strengths/ThemeBadge";
import {
  Handshake,
  Users,
  RefreshCw,
  Sparkles,
  ArrowRight,
  CheckCircle2,
  Clock,
  UserPlus,
  Target,
  Brain,
  Loader2,
  Lightbulb,
  MessageSquare,
  ListTodo,
  Flag,
  ChevronDown,
  ChevronUp,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { DomainSlug } from "@/constants/strengths-data";

interface MentorSuggestion {
  id: string;
  name: string;
  avatarUrl: string | null;
  jobTitle: string | null;
  score: number;
  reasons: string[];
  complementaryStrengths: string[];
  topStrengths: { name: string; domain: string }[];
}

interface Mentorship {
  id: string;
  status: string;
  focusAreas: string[];
  notes: string | null;
  startedAt: string;
  endedAt: string | null;
  mentor: {
    id: string;
    name: string;
    avatarUrl: string | null;
    jobTitle: string | null;
    topStrengths: { name: string; domain: string }[];
  };
  mentee: {
    id: string;
    name: string;
    avatarUrl: string | null;
    jobTitle: string | null;
    topStrengths: { name: string; domain: string }[];
  };
  isMentor: boolean;
}

interface MentorshipGuide {
  overview: string;
  focusAreas: {
    area: string;
    description: string;
    mentorStrength: string;
    menteeGoal: string;
  }[];
  discussionTopics: {
    topic: string;
    questions: string[];
    expectedOutcome: string;
  }[];
  activities: {
    name: string;
    description: string;
    duration: string;
    strengthsConnection: string;
  }[];
  checkpoints: {
    milestone: string;
    timeframe: string;
    indicators: string[];
  }[];
  watchOuts: string[];
}

interface AIGuideState {
  loading: boolean;
  error: string | null;
  guide: MentorshipGuide | null;
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function getStatusBadge(status: string) {
  switch (status) {
    case "ACTIVE":
      return (
        <span className="flex items-center gap-1 text-xs font-medium text-domain-strategic bg-domain-strategic-light px-2 py-0.5 rounded-full">
          <CheckCircle2 className="h-3 w-3" />
          Active
        </span>
      );
    case "PENDING":
      return (
        <span className="flex items-center gap-1 text-xs font-medium text-domain-influencing bg-domain-influencing-light px-2 py-0.5 rounded-full">
          <Clock className="h-3 w-3" />
          Pending
        </span>
      );
    default:
      return null;
  }
}

// AI Mentorship Guide Panel component
function MentorshipGuidePanel({ mentorship }: { mentorship: Mentorship }) {
  const [expanded, setExpanded] = useState(false);
  const [aiGuide, setAiGuide] = useState<AIGuideState>({
    loading: false,
    error: null,
    guide: null,
  });

  const fetchGuide = useCallback(async () => {
    if (aiGuide.guide || aiGuide.loading) return;

    setAiGuide((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const response = await fetch("/api/ai/mentorship-guide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mentorId: mentorship.mentor.id,
          menteeId: mentorship.mentee.id,
          focusThemes: mentorship.focusAreas,
          duration: "medium",
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error?.message || "Failed to generate guide");
      }

      setAiGuide({
        loading: false,
        error: null,
        guide: data.data.guide,
      });
    } catch (error) {
      setAiGuide({
        loading: false,
        error: error instanceof Error ? error.message : "Failed to load AI guide",
        guide: null,
      });
    }
  }, [mentorship.mentor.id, mentorship.mentee.id, mentorship.focusAreas, aiGuide.guide, aiGuide.loading]);

  const handleToggle = () => {
    if (!expanded && !aiGuide.guide && !aiGuide.loading) {
      fetchGuide();
    }
    setExpanded(!expanded);
  };

  return (
    <div className="mt-4 pt-4 border-t">
      <Button
        variant="outline"
        size="sm"
        onClick={handleToggle}
        className="w-full justify-between"
      >
        <span className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-domain-strategic" />
          AI Mentorship Guide
        </span>
        {aiGuide.loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : expanded ? (
          <ChevronUp className="h-4 w-4" />
        ) : (
          <ChevronDown className="h-4 w-4" />
        )}
      </Button>

      {expanded && (
        <div className="mt-4 space-y-4">
          {aiGuide.loading && (
            <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>Generating personalized mentorship guide...</span>
            </div>
          )}

          {aiGuide.error && (
            <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20">
              <div className="flex items-center gap-2 text-destructive mb-2">
                <AlertCircle className="h-4 w-4" />
                <span className="font-medium">Error</span>
              </div>
              <p className="text-sm text-destructive/80">{aiGuide.error}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setAiGuide({ loading: false, error: null, guide: null });
                  fetchGuide();
                }}
                className="mt-2"
              >
                Try Again
              </Button>
            </div>
          )}

          {aiGuide.guide && (
            <div className="space-y-6">
              {/* Overview */}
              <div className="p-4 rounded-lg bg-domain-strategic-light/30 border border-domain-strategic/20">
                <div className="flex items-center gap-2 text-domain-strategic font-medium mb-2">
                  <Lightbulb className="h-4 w-4" />
                  Overview
                </div>
                <p className="text-sm text-muted-foreground">{aiGuide.guide.overview}</p>
              </div>

              {/* Focus Areas */}
              {aiGuide.guide.focusAreas.length > 0 && (
                <div>
                  <h4 className="font-medium flex items-center gap-2 mb-3">
                    <Target className="h-4 w-4 text-domain-executing" />
                    Focus Areas
                  </h4>
                  <div className="grid gap-3">
                    {aiGuide.guide.focusAreas.map((area, i) => (
                      <div key={i} className="p-3 rounded-lg bg-muted/50 border">
                        <div className="font-medium text-sm mb-1">{area.area}</div>
                        <p className="text-xs text-muted-foreground mb-2">{area.description}</p>
                        <div className="flex flex-wrap gap-2 text-xs">
                          <span className="bg-domain-executing-light text-domain-executing px-2 py-0.5 rounded">
                            Mentor: {area.mentorStrength}
                          </span>
                          <span className="bg-domain-relationship-light text-domain-relationship px-2 py-0.5 rounded">
                            Goal: {area.menteeGoal}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Discussion Topics */}
              {aiGuide.guide.discussionTopics.length > 0 && (
                <div>
                  <h4 className="font-medium flex items-center gap-2 mb-3">
                    <MessageSquare className="h-4 w-4 text-domain-influencing" />
                    Discussion Topics
                  </h4>
                  <div className="space-y-3">
                    {aiGuide.guide.discussionTopics.slice(0, 4).map((topic, i) => (
                      <div key={i} className="p-3 rounded-lg bg-muted/50 border">
                        <div className="font-medium text-sm mb-2">{topic.topic}</div>
                        <ul className="text-xs text-muted-foreground space-y-1 mb-2">
                          {topic.questions.map((q, j) => (
                            <li key={j} className="flex items-start gap-1">
                              <span className="text-domain-influencing">•</span> {q}
                            </li>
                          ))}
                        </ul>
                        <p className="text-xs text-domain-strategic italic">
                          Expected: {topic.expectedOutcome}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Activities */}
              {aiGuide.guide.activities.length > 0 && (
                <div>
                  <h4 className="font-medium flex items-center gap-2 mb-3">
                    <ListTodo className="h-4 w-4 text-domain-relationship" />
                    Suggested Activities
                  </h4>
                  <div className="grid gap-2">
                    {aiGuide.guide.activities.map((activity, i) => (
                      <div key={i} className="p-3 rounded-lg bg-muted/50 border">
                        <div className="flex justify-between items-start mb-1">
                          <span className="font-medium text-sm">{activity.name}</span>
                          <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                            {activity.duration}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">{activity.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Checkpoints */}
              {aiGuide.guide.checkpoints.length > 0 && (
                <div>
                  <h4 className="font-medium flex items-center gap-2 mb-3">
                    <Flag className="h-4 w-4 text-domain-strategic" />
                    Progress Checkpoints
                  </h4>
                  <div className="space-y-2">
                    {aiGuide.guide.checkpoints.map((checkpoint, i) => (
                      <div key={i} className="flex items-start gap-3 p-2 rounded bg-muted/30">
                        <div className="h-6 w-6 rounded-full bg-domain-strategic text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
                          {i + 1}
                        </div>
                        <div>
                          <div className="text-sm font-medium">{checkpoint.milestone}</div>
                          <div className="text-xs text-muted-foreground">{checkpoint.timeframe}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Watch Outs */}
              {aiGuide.guide.watchOuts.length > 0 && (
                <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                  <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 font-medium mb-2">
                    <AlertCircle className="h-4 w-4" />
                    Watch Out For
                  </div>
                  <ul className="space-y-1">
                    {aiGuide.guide.watchOuts.map((item, i) => (
                      <li key={i} className="text-sm text-amber-700 dark:text-amber-400 flex items-start gap-1">
                        <span>•</span> {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function MentorshipPage() {
  const { data: session } = useSession();
  const [suggestions, setSuggestions] = useState<MentorSuggestion[]>([]);
  const [mentorships, setMentorships] = useState<Mentorship[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingSuggestions, setLoadingSuggestions] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    setLoadingSuggestions(true);

    try {
      const [mentorshipsRes, suggestionsRes] = await Promise.all([
        fetch("/api/mentorship"),
        fetch("/api/mentorship/suggestions"),
      ]);

      if (mentorshipsRes.ok) {
        const result = await mentorshipsRes.json();
        setMentorships(result.data);
      }

      if (suggestionsRes.ok) {
        const result = await suggestionsRes.json();
        setSuggestions(result.data.suggestions || []);
      }
    } catch (err) {
      console.error("Failed to fetch data:", err);
    } finally {
      setLoading(false);
      setLoadingSuggestions(false);
    }
  };

  const activeMentorships = mentorships.filter((m) => m.status === "ACTIVE");
  const pendingMentorships = mentorships.filter((m) => m.status === "PENDING");

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold flex items-center gap-2">
            <Handshake className="h-8 w-8 text-domain-relationship" />
            Mentorship
          </h1>
          <p className="text-muted-foreground mt-1">
            Connect with team members who have complementary strengths
          </p>
        </div>
        <Button variant="outline" onClick={fetchData}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Active Mentorships */}
      {(activeMentorships.length > 0 || pendingMentorships.length > 0) && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Users className="h-5 w-5 text-domain-relationship" />
            Your Mentorships
          </h2>

          <div className="grid gap-4 md:grid-cols-2">
            {[...activeMentorships, ...pendingMentorships].map((mentorship) => {
              const otherPerson = mentorship.isMentor
                ? mentorship.mentee
                : mentorship.mentor;
              const role = mentorship.isMentor ? "Mentor to" : "Mentee of";

              return (
                <Card key={mentorship.id} className="overflow-hidden">
                  <CardContent className="pt-6">
                    <div className="flex items-start gap-4">
                      <Avatar className="h-14 w-14 ring-2 ring-offset-2 ring-domain-relationship/20">
                        <AvatarImage src={otherPerson.avatarUrl || undefined} />
                        <AvatarFallback className="bg-domain-relationship-light text-domain-relationship dark:bg-domain-relationship/20 dark:text-domain-relationship-muted">
                          {getInitials(otherPerson.name || "?")}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs text-muted-foreground">{role}</span>
                          {getStatusBadge(mentorship.status)}
                        </div>
                        <Link
                          href={`/team/${otherPerson.id}`}
                          className="font-semibold hover:text-primary transition-colors"
                        >
                          {otherPerson.name}
                        </Link>
                        {otherPerson.jobTitle && (
                          <p className="text-sm text-muted-foreground">
                            {otherPerson.jobTitle}
                          </p>
                        )}

                        {/* Focus areas */}
                        {mentorship.focusAreas.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {mentorship.focusAreas.map((area) => (
                              <span
                                key={area}
                                className="text-xs bg-muted px-2 py-0.5 rounded-full"
                              >
                                {area}
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Top strengths */}
                        <div className="flex gap-1 mt-2">
                          {otherPerson.topStrengths?.slice(0, 3).map((s) => (
                            <DomainIcon
                              key={s.name}
                              domain={s.domain as DomainSlug}
                              size="sm"
                            />
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* AI Guide Panel for active mentorships */}
                    {mentorship.status === "ACTIVE" && (
                      <MentorshipGuidePanel mentorship={mentorship} />
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Suggested Mentors */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-amber-500" />
          Suggested Mentors
        </h2>
        <p className="text-sm text-muted-foreground">
          Team members with strengths that complement yours
        </p>

        {loadingSuggestions ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <CardContent className="pt-6">
                  <div className="animate-pulse space-y-4">
                    <div className="flex items-center gap-4">
                      <div className="h-12 w-12 rounded-full bg-muted" />
                      <div className="space-y-2 flex-1">
                        <div className="h-4 bg-muted rounded w-3/4" />
                        <div className="h-3 bg-muted rounded w-1/2" />
                      </div>
                    </div>
                    <div className="h-10 bg-muted rounded" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : suggestions.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {suggestions.map((suggestion) => (
              <Card
                key={suggestion.id}
                className="overflow-hidden hover:shadow-md transition-all"
              >
                <CardContent className="pt-6">
                  <div className="flex items-start gap-4 mb-4">
                    <Avatar className="h-14 w-14 ring-2 ring-offset-2 ring-primary/10">
                      <AvatarImage src={suggestion.avatarUrl || undefined} />
                      <AvatarFallback className="bg-primary text-primary-foreground">
                        {getInitials(suggestion.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <Link
                        href={`/team/${suggestion.id}`}
                        className="font-semibold hover:text-primary transition-colors"
                      >
                        {suggestion.name}
                      </Link>
                      {suggestion.jobTitle && (
                        <p className="text-sm text-muted-foreground truncate">
                          {suggestion.jobTitle}
                        </p>
                      )}
                      <div className="flex gap-1 mt-1">
                        {suggestion.topStrengths.slice(0, 4).map((s) => (
                          <DomainIcon
                            key={s.name}
                            domain={s.domain as DomainSlug}
                            size="sm"
                          />
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Reasons */}
                  {suggestion.reasons.length > 0 && (
                    <div className="space-y-1 mb-4">
                      {suggestion.reasons.slice(0, 2).map((reason, i) => (
                        <p key={i} className="text-xs text-muted-foreground flex items-start gap-1">
                          <Target className="h-3 w-3 mt-0.5 text-domain-strategic flex-shrink-0" />
                          {reason}
                        </p>
                      ))}
                    </div>
                  )}

                  {/* Complementary strengths */}
                  {suggestion.complementaryStrengths.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-4">
                      {suggestion.complementaryStrengths.map((strength) => {
                        const strengthData = suggestion.topStrengths.find(
                          (s) => s.name === strength
                        );
                        return (
                          <ThemeBadge
                            key={strength}
                            themeName={strength}
                            domainSlug={(strengthData?.domain || "strategic") as DomainSlug}
                            size="sm"
                          />
                        );
                      })}
                    </div>
                  )}

                  <Button
                    variant="relationship"
                    className="w-full"
                    asChild
                  >
                    <Link href={`/mentorship/request?mentor=${suggestion.id}`}>
                      <UserPlus className="h-4 w-4 mr-2" />
                      Request Mentorship
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="pt-6">
              <div className="text-center py-8">
                <Handshake className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold">No Suggestions Yet</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Upload your CliftonStrengths to get personalized mentor suggestions
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* How it works */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">How Mentorship Works</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid sm:grid-cols-3 gap-6">
            {[
              {
                step: 1,
                title: "Find a Match",
                description:
                  "We suggest mentors based on complementary strengths - they're strong where you want to grow",
                icon: Sparkles,
              },
              {
                step: 2,
                title: "Send a Request",
                description:
                  "Choose focus areas and send a mentorship request to start the conversation",
                icon: UserPlus,
              },
              {
                step: 3,
                title: "Connect & Grow",
                description:
                  "Meet regularly to learn from their expertise and develop new skills",
                icon: Handshake,
              },
            ].map((item) => (
              <div key={item.step} className="text-center">
                <div className="flex items-center justify-center gap-2 mb-3">
                  <span className="h-6 w-6 rounded-full bg-domain-relationship text-white text-sm font-bold flex items-center justify-center">
                    {item.step}
                  </span>
                  <item.icon className="h-5 w-5 text-domain-relationship" />
                </div>
                <h4 className="font-semibold mb-1">{item.title}</h4>
                <p className="text-sm text-muted-foreground">{item.description}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
