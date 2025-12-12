"use client";

import { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/Avatar";
import { DomainIcon } from "@/components/strengths/DomainIcon";
import { ThemeBadge } from "@/components/strengths/ThemeBadge";
import { cn } from "@/lib/utils";
import {
  Presentation,
  FileText,
  Bug,
  Rocket,
  Users,
  Lightbulb,
  Target,
  Search,
  ArrowRight,
  Check,
  Loader2,
  HandshakeIcon,
} from "lucide-react";
import Link from "next/link";
import type { DomainSlug } from "@/constants/strengths-data";

// Project templates with recommended strength combinations
const PROJECT_TEMPLATES = [
  {
    id: "presentation",
    name: "Building a Presentation",
    description: "Creating and delivering impactful presentations",
    icon: Presentation,
    color: "domain-influencing",
    recommendedStrengths: ["communication", "ideation", "strategic", "woo"],
    complementaryPairs: [
      { primary: "communication", secondary: "analytical", reason: "Clear messaging backed by data" },
      { primary: "ideation", secondary: "focus", reason: "Creative ideas with structured delivery" },
      { primary: "woo", secondary: "strategic", reason: "Engaging style with strategic content" },
    ],
  },
  {
    id: "problem-solving",
    name: "Problem Solving",
    description: "Diagnosing issues and finding solutions",
    icon: Bug,
    color: "domain-strategic",
    recommendedStrengths: ["analytical", "restorative", "deliberative", "strategic"],
    complementaryPairs: [
      { primary: "analytical", secondary: "activator", reason: "Thorough analysis with quick action" },
      { primary: "restorative", secondary: "positivity", reason: "Problem-solving with optimism" },
      { primary: "strategic", secondary: "achiever", reason: "Best path identified and executed" },
    ],
  },
  {
    id: "new-initiative",
    name: "Launching New Initiative",
    description: "Starting something new from scratch",
    icon: Rocket,
    color: "domain-executing",
    recommendedStrengths: ["activator", "futuristic", "ideation", "achiever"],
    complementaryPairs: [
      { primary: "activator", secondary: "deliberative", reason: "Quick start with risk awareness" },
      { primary: "futuristic", secondary: "discipline", reason: "Vision with structured execution" },
      { primary: "ideation", secondary: "arranger", reason: "New ideas efficiently organized" },
    ],
  },
  {
    id: "team-building",
    name: "Team Building",
    description: "Strengthening team cohesion and culture",
    icon: Users,
    color: "domain-relationship",
    recommendedStrengths: ["relator", "includer", "harmony", "developer"],
    complementaryPairs: [
      { primary: "includer", secondary: "command", reason: "Everyone included with clear direction" },
      { primary: "harmony", secondary: "communication", reason: "Consensus built through dialogue" },
      { primary: "developer", secondary: "positivity", reason: "Growth mindset with encouragement" },
    ],
  },
  {
    id: "brainstorming",
    name: "Brainstorming Session",
    description: "Generating innovative ideas",
    icon: Lightbulb,
    color: "domain-strategic",
    recommendedStrengths: ["ideation", "input", "connectedness", "futuristic"],
    complementaryPairs: [
      { primary: "ideation", secondary: "focus", reason: "Many ideas refined to best ones" },
      { primary: "input", secondary: "strategic", reason: "Rich information distilled strategically" },
      { primary: "futuristic", secondary: "analytical", reason: "Vision validated with analysis" },
    ],
  },
  {
    id: "documentation",
    name: "Writing Documentation",
    description: "Creating clear, comprehensive docs",
    icon: FileText,
    color: "domain-executing",
    recommendedStrengths: ["communication", "discipline", "context", "learner"],
    complementaryPairs: [
      { primary: "communication", secondary: "analytical", reason: "Clear writing with accuracy" },
      { primary: "discipline", secondary: "input", reason: "Structured with rich content" },
      { primary: "context", secondary: "futuristic", reason: "Historical context with forward thinking" },
    ],
  },
  {
    id: "goal-setting",
    name: "Goal Setting & Planning",
    description: "Defining objectives and roadmaps",
    icon: Target,
    color: "domain-executing",
    recommendedStrengths: ["focus", "strategic", "achiever", "discipline"],
    complementaryPairs: [
      { primary: "focus", secondary: "ideation", reason: "Clear priorities with creative approaches" },
      { primary: "strategic", secondary: "activator", reason: "Best path chosen and started quickly" },
      { primary: "achiever", secondary: "relator", reason: "Results-driven with relationship awareness" },
    ],
  },
];

interface TeamMember {
  id: string;
  name: string;
  avatarUrl: string | null;
  jobTitle: string | null;
  topStrengths: {
    themeName: string;
    themeSlug: string;
    domain: string;
    rank: number;
  }[];
}

interface ProjectPartnerFinderProps {
  className?: string;
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function ProjectPartnerFinder({ className }: ProjectPartnerFinderProps) {
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [suggestedPartners, setSuggestedPartners] = useState<{
    member: TeamMember;
    matchedStrengths: string[];
    score: number;
  }[]>([]);

  // Fetch team members
  useEffect(() => {
    fetchMembers();
  }, []);

  const fetchMembers = async () => {
    try {
      const response = await fetch("/api/members?limit=100");
      if (response.ok) {
        const result = await response.json();
        setMembers(result.data || []);
      }
    } catch (err) {
      console.error("Failed to fetch members:", err);
    }
  };

  // Find partners when project is selected
  useEffect(() => {
    if (selectedProject && members.length > 0) {
      findPartners(selectedProject);
    }
  }, [selectedProject, members]);

  const findPartners = (projectId: string) => {
    setLoading(true);
    const project = PROJECT_TEMPLATES.find((p) => p.id === projectId);
    if (!project) {
      setLoading(false);
      return;
    }

    // Score each member based on matching strengths
    const scored = members.map((member) => {
      const matchedStrengths: string[] = [];
      let score = 0;

      member.topStrengths.forEach((strength) => {
        if (project.recommendedStrengths.includes(strength.themeSlug)) {
          matchedStrengths.push(strength.themeName);
          // Higher rank = higher score (rank 1 = 5 points, rank 5 = 1 point)
          score += 6 - Math.min(strength.rank, 5);
        }
      });

      return { member, matchedStrengths, score };
    });

    // Sort by score and filter those with matches
    const partners = scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);

    setSuggestedPartners(partners);
    setLoading(false);
  };

  const selectedProjectData = PROJECT_TEMPLATES.find((p) => p.id === selectedProject);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HandshakeIcon className="h-5 w-5 text-domain-relationship" />
          Project Partner Finder
        </CardTitle>
        <CardDescription>
          Find the ideal teammates based on project type
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Project selection */}
        <div>
          <p className="text-sm font-medium mb-3">What are you working on?</p>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {PROJECT_TEMPLATES.map((project) => {
              const Icon = project.icon;
              const isSelected = selectedProject === project.id;

              return (
                <button
                  key={project.id}
                  onClick={() => setSelectedProject(project.id)}
                  className={cn(
                    "p-3 rounded-xl border text-left transition-all",
                    isSelected
                      ? `bg-${project.color}/10 border-${project.color} ring-2 ring-${project.color}/30`
                      : "hover:bg-muted"
                  )}
                >
                  <Icon className={cn("h-5 w-5 mb-1", `text-${project.color}`)} />
                  <p className="text-sm font-medium">{project.name}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Results */}
        {selectedProjectData && (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-muted/50">
              <p className="text-sm text-muted-foreground mb-2">
                {selectedProjectData.description}
              </p>
              <div className="flex flex-wrap gap-2">
                <span className="text-xs text-muted-foreground">Best strengths:</span>
                {selectedProjectData.recommendedStrengths.map((s) => (
                  <span
                    key={s}
                    className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary capitalize"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>

            {/* Complementary pairs tip */}
            <div className="p-3 rounded-lg bg-domain-relationship/10 border border-domain-relationship/20">
              <p className="text-xs font-medium text-domain-relationship mb-2">
                Complementary Partnerships
              </p>
              <div className="space-y-1">
                {selectedProjectData.complementaryPairs.slice(0, 2).map((pair, idx) => (
                  <p key={idx} className="text-xs text-muted-foreground">
                    <span className="capitalize">{pair.primary}</span>
                    {" + "}
                    <span className="capitalize">{pair.secondary}</span>
                    {" → "}
                    <span className="text-foreground">{pair.reason}</span>
                  </p>
                ))}
              </div>
            </div>

            {/* Suggested partners */}
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : suggestedPartners.length > 0 ? (
              <div>
                <p className="text-sm font-medium mb-3">Suggested Partners</p>
                <div className="grid gap-3">
                  {suggestedPartners.map(({ member, matchedStrengths, score }) => (
                    <Link
                      key={member.id}
                      href={`/team/${member.id}`}
                      className="flex items-center gap-3 p-3 rounded-xl bg-muted/30 hover:bg-muted/50 transition-colors"
                    >
                      <Avatar className="h-10 w-10">
                        <AvatarImage src={member.avatarUrl || undefined} />
                        <AvatarFallback className="bg-primary text-primary-foreground">
                          {getInitials(member.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{member.name}</p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {matchedStrengths.slice(0, 3).map((s) => (
                            <span
                              key={s}
                              className="text-xs px-1.5 py-0.5 rounded bg-domain-strategic/10 text-domain-strategic"
                            >
                              {s}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Check className="h-3 w-3 text-green-500" />
                        {score} match
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center py-6">
                <Search className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  No team members found with these strengths
                </p>
              </div>
            )}
          </div>
        )}

        {!selectedProject && (
          <div className="text-center py-8">
            <Target className="h-10 w-10 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              Select a project type to find ideal partners
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
