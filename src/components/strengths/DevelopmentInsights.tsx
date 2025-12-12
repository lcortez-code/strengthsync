"use client";

import { useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { DomainIcon } from "./DomainIcon";
import {
  Sparkles,
  Target,
  AlertTriangle,
  Users,
  Calendar,
  ChevronDown,
  ChevronUp,
  Lightbulb,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { DomainSlug } from "@/constants/strengths-data";

interface DevelopmentInsightsProps {
  memberId?: string; // If not provided, uses current user
  memberName?: string;
  className?: string;
}

interface StrengthInsight {
  strength: string;
  domain: string;
  powerStatement: string;
  developmentTips: string[];
  watchOut: string;
  partnership: string;
}

interface ActionPlan {
  thisWeek: string;
  thisMonth: string;
  partnerships: string[];
}

interface InsightsResponse {
  overview: string;
  insights: StrengthInsight[];
  actionPlan: ActionPlan;
  member: {
    id: string;
    name: string;
    jobTitle: string | null;
    strengthCount: number;
    topDomain: string | null;
  };
}

const DOMAIN_SLUGS: Record<string, DomainSlug> = {
  "Executing": "executing",
  "Influencing": "influencing",
  "Relationship Building": "relationship",
  "Strategic Thinking": "strategic",
};

export function DevelopmentInsights({ memberId, memberName, className }: DevelopmentInsightsProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [insights, setInsights] = useState<InsightsResponse | null>(null);
  const [expandedStrengths, setExpandedStrengths] = useState<Set<string>>(new Set());

  const fetchInsights = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/ai/development-insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetMemberId: memberId,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setError(result.error?.message || "Failed to generate insights");
        return;
      }

      setInsights(result.data);
      // Expand first strength by default
      if (result.data.insights.length > 0) {
        setExpandedStrengths(new Set([result.data.insights[0].strength]));
      }
    } catch (err) {
      console.error("Development insights error:", err);
      setError("Failed to generate insights. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const toggleStrength = (strength: string) => {
    setExpandedStrengths((prev) => {
      const next = new Set(prev);
      if (next.has(strength)) {
        next.delete(strength);
      } else {
        next.add(strength);
      }
      return next;
    });
  };

  const getDomainSlug = (domain: string): DomainSlug => {
    return DOMAIN_SLUGS[domain] || "strategic";
  };

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-domain-strategic" />
          Development Insights
        </CardTitle>
        <CardDescription>
          {memberName
            ? `AI-powered growth recommendations for ${memberName}`
            : "Personalized strength development guidance"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!insights ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Get personalized insights on how to develop and leverage your strengths more effectively.
            </p>
            <Button
              onClick={fetchInsights}
              disabled={loading}
              className="w-full bg-domain-strategic hover:bg-domain-strategic/90"
            >
              {loading ? (
                <>
                  <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                  Analyzing strengths...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Generate Development Insights
                </>
              )}
            </Button>
            {error && (
              <p className="text-sm text-destructive text-center">{error}</p>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {/* Overview */}
            <div className="p-4 rounded-lg bg-domain-strategic/10 border border-domain-strategic/20">
              <p className="text-sm leading-relaxed">{insights.overview}</p>
            </div>

            {/* Strength Insights */}
            <div className="space-y-3">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <Target className="h-4 w-4 text-muted-foreground" />
                Strength Deep Dives
              </h4>
              {insights.insights.map((insight) => {
                const isExpanded = expandedStrengths.has(insight.strength);
                const domainSlug = getDomainSlug(insight.domain);

                return (
                  <div
                    key={insight.strength}
                    className="border rounded-lg overflow-hidden"
                  >
                    <button
                      onClick={() => toggleStrength(insight.strength)}
                      className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <DomainIcon domain={domainSlug} size="sm" />
                        <div className="text-left">
                          <span className="font-medium text-sm">{insight.strength}</span>
                          <span className="text-xs text-muted-foreground ml-2">
                            ({insight.domain})
                          </span>
                        </div>
                      </div>
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      )}
                    </button>

                    {isExpanded && (
                      <div className="p-4 pt-0 space-y-4 animate-in slide-in-from-top-2">
                        {/* Power Statement */}
                        <div className="p-3 rounded-lg bg-green-50 border border-green-200 dark:bg-green-900/20 dark:border-green-800">
                          <h5 className="text-xs font-medium text-green-800 dark:text-green-400 mb-1">
                            Your Superpower
                          </h5>
                          <p className="text-sm text-green-700 dark:text-green-300">
                            {insight.powerStatement}
                          </p>
                        </div>

                        {/* Development Tips */}
                        {insight.developmentTips.length > 0 && (
                          <div>
                            <h5 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                              <Lightbulb className="h-3 w-3" />
                              Development Tips
                            </h5>
                            <ul className="space-y-1">
                              {insight.developmentTips.map((tip, i) => (
                                <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                                  <span className="text-domain-strategic">•</span>
                                  {tip}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Watch Out */}
                        {insight.watchOut && (
                          <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 dark:bg-amber-900/20 dark:border-amber-800">
                            <h5 className="text-xs font-medium text-amber-800 dark:text-amber-400 mb-1 flex items-center gap-1">
                              <AlertTriangle className="h-3 w-3" />
                              Watch Out For
                            </h5>
                            <p className="text-sm text-amber-700 dark:text-amber-300">
                              {insight.watchOut}
                            </p>
                          </div>
                        )}

                        {/* Partnership */}
                        {insight.partnership && (
                          <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 dark:bg-blue-900/20 dark:border-blue-800">
                            <h5 className="text-xs font-medium text-blue-800 dark:text-blue-400 mb-1 flex items-center gap-1">
                              <Users className="h-3 w-3" />
                              Partner With
                            </h5>
                            <p className="text-sm text-blue-700 dark:text-blue-300">
                              {insight.partnership}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Action Plan */}
            {insights.actionPlan && (
              <div className="pt-4 border-t">
                <h4 className="text-sm font-medium flex items-center gap-2 mb-3">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  Action Plan
                </h4>
                <div className="space-y-3">
                  {insights.actionPlan.thisWeek && (
                    <div className="p-3 rounded-lg bg-muted/50">
                      <span className="text-xs font-medium text-domain-executing">This Week:</span>
                      <p className="text-sm mt-1">{insights.actionPlan.thisWeek}</p>
                    </div>
                  )}
                  {insights.actionPlan.thisMonth && (
                    <div className="p-3 rounded-lg bg-muted/50">
                      <span className="text-xs font-medium text-domain-strategic">This Month:</span>
                      <p className="text-sm mt-1">{insights.actionPlan.thisMonth}</p>
                    </div>
                  )}
                  {insights.actionPlan.partnerships.length > 0 && (
                    <div className="p-3 rounded-lg bg-muted/50">
                      <span className="text-xs font-medium text-domain-relationship">
                        Seek Out Partnerships With:
                      </span>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {insights.actionPlan.partnerships.map((p, i) => (
                          <span
                            key={i}
                            className="px-2 py-0.5 bg-domain-relationship/10 text-domain-relationship text-xs rounded-full"
                          >
                            {p}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Regenerate */}
            <Button
              variant="ghost"
              size="sm"
              onClick={fetchInsights}
              disabled={loading}
              className="w-full text-xs"
            >
              {loading ? "Regenerating..." : "Regenerate Insights"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
