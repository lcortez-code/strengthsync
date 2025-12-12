"use client";

import { useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import {
  Sparkles,
  RefreshCw,
  BookOpen,
  Target,
  Users,
  Lightbulb,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface TeamNarrativeProps {
  className?: string;
}

type NarrativeStyle = "brief" | "detailed" | "executive";
type FocusArea = "strengths" | "gaps" | "collaboration" | "all";

interface NarrativeResponse {
  narrative: string;
  teamStats: {
    memberCount: number;
    membersWithStrengths: number;
    topDomains: { name: string; percentage: number }[];
    topThemes: string[];
    gapCount: number;
  };
  style: NarrativeStyle;
  focusArea: FocusArea;
}

const STYLE_OPTIONS: { value: NarrativeStyle; label: string; icon: React.ReactNode }[] = [
  { value: "brief", label: "Brief", icon: <Lightbulb className="h-4 w-4" /> },
  { value: "detailed", label: "Detailed", icon: <BookOpen className="h-4 w-4" /> },
  { value: "executive", label: "Executive", icon: <Target className="h-4 w-4" /> },
];

const FOCUS_OPTIONS: { value: FocusArea; label: string }[] = [
  { value: "all", label: "Balanced" },
  { value: "strengths", label: "Strengths" },
  { value: "gaps", label: "Gaps" },
  { value: "collaboration", label: "Collaboration" },
];

export function TeamNarrative({ className }: TeamNarrativeProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [narrative, setNarrative] = useState<NarrativeResponse | null>(null);
  const [style, setStyle] = useState<NarrativeStyle>("detailed");
  const [focusArea, setFocusArea] = useState<FocusArea>("all");

  const generateNarrative = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/ai/team-narrative", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ style, focusArea }),
      });

      const result = await response.json();

      if (!response.ok) {
        setError(result.error?.message || "Failed to generate narrative");
        return;
      }

      setNarrative(result.data);
    } catch (err) {
      console.error("Narrative generation error:", err);
      setError("Failed to generate narrative. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-domain-strategic" />
              Team Narrative
            </CardTitle>
            <CardDescription>
              AI-generated story of your team&apos;s strengths
            </CardDescription>
          </div>
          {narrative && (
            <Button
              variant="ghost"
              size="sm"
              onClick={generateNarrative}
              disabled={loading}
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {!narrative ? (
          <div className="space-y-4">
            {/* Style Selection */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Narrative Style</label>
              <div className="flex gap-2">
                {STYLE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setStyle(option.value)}
                    className={cn(
                      "flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors text-sm",
                      style === option.value
                        ? "bg-primary text-primary-foreground border-primary"
                        : "hover:bg-muted"
                    )}
                  >
                    {option.icon}
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Focus Area Selection */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Focus Area</label>
              <div className="flex flex-wrap gap-2">
                {FOCUS_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setFocusArea(option.value)}
                    className={cn(
                      "px-3 py-1.5 rounded-full border text-sm transition-colors",
                      focusArea === option.value
                        ? "bg-domain-strategic text-white border-domain-strategic"
                        : "hover:bg-muted"
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Generate Button */}
            <Button
              onClick={generateNarrative}
              disabled={loading}
              className="w-full bg-domain-strategic hover:bg-domain-strategic/90"
            >
              {loading ? (
                <>
                  <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Generate Team Narrative
                </>
              )}
            </Button>

            {error && (
              <p className="text-sm text-destructive text-center">{error}</p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Team Stats Summary */}
            <div className="flex items-center gap-4 p-3 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-1.5">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">
                  <span className="font-semibold">{narrative.teamStats.membersWithStrengths}</span>
                  <span className="text-muted-foreground">/{narrative.teamStats.memberCount} profiled</span>
                </span>
              </div>
              {narrative.teamStats.topDomains.slice(0, 2).map((domain, i) => (
                <span key={domain.name} className="text-sm">
                  {i > 0 && <span className="text-muted-foreground mx-1">•</span>}
                  <span className="font-medium">{domain.name}</span>
                  <span className="text-muted-foreground"> {domain.percentage}%</span>
                </span>
              ))}
            </div>

            {/* Narrative Content */}
            <div className="prose prose-sm max-w-none">
              {narrative.narrative.split("\n\n").map((paragraph, i) => (
                <p key={i} className="text-sm leading-relaxed mb-3">
                  {paragraph}
                </p>
              ))}
            </div>

            {/* Top Themes */}
            {narrative.teamStats.topThemes.length > 0 && (
              <div className="pt-3 border-t">
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  Top Team Strengths
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {narrative.teamStats.topThemes.map((theme) => (
                    <span
                      key={theme}
                      className="px-2 py-0.5 bg-domain-strategic/10 text-domain-strategic text-xs rounded-full"
                    >
                      {theme}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Regenerate with different options */}
            <div className="pt-3 border-t flex items-center justify-between">
              <div className="flex gap-2">
                <select
                  value={style}
                  onChange={(e) => setStyle(e.target.value as NarrativeStyle)}
                  className="text-xs border rounded px-2 py-1 bg-background"
                >
                  {STYLE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <select
                  value={focusArea}
                  onChange={(e) => setFocusArea(e.target.value as FocusArea)}
                  className="text-xs border rounded px-2 py-1 bg-background"
                >
                  {FOCUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={generateNarrative}
                disabled={loading}
                className="text-xs"
              >
                {loading ? "Regenerating..." : "Regenerate"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
