"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/Avatar";
import { DomainIcon } from "@/components/strengths/DomainIcon";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  Calendar,
  Users,
  Sparkles,
  MessageCircle,
  Target,
  Lightbulb,
  Copy,
  Check,
  Loader2,
  Printer,
  Clock,
} from "lucide-react";
import Link from "next/link";
import type { DomainSlug } from "@/constants/strengths-data";

// Question templates based on strengths
const STRENGTH_QUESTIONS: Record<string, string[]> = {
  achiever: [
    "What accomplishments are you most proud of recently?",
    "What goals are you working toward that energize you?",
    "How can we help you feel more productive in your role?",
  ],
  activator: [
    "What new initiatives are you excited to start?",
    "Where do you feel stuck and need to get moving?",
    "How can we remove barriers to help you take action faster?",
  ],
  analytical: [
    "What data or evidence would help you make better decisions?",
    "Where would you like more time to analyze before acting?",
    "What patterns have you noticed that we should discuss?",
  ],
  communication: [
    "How can we help you share your ideas more broadly?",
    "What stories or messages are you working on?",
    "Where do you feel your voice isn't being heard?",
  ],
  developer: [
    "Who have you been helping grow recently?",
    "What development opportunities would you like for yourself?",
    "How can we recognize the growth you see in others?",
  ],
  empathy: [
    "How is the team morale feeling to you?",
    "Whose perspective should we be considering more?",
    "What emotions have you picked up on that we should address?",
  ],
  focus: [
    "What's your top priority right now?",
    "What distractions are pulling you away from your goals?",
    "How can we help you maintain focus on what matters?",
  ],
  futuristic: [
    "What vision are you most excited about for the team?",
    "Where do you see opportunities we're not exploring?",
    "How can we make space for forward-thinking discussions?",
  ],
  harmony: [
    "Are there any tensions on the team we should address?",
    "Where do you see opportunities for more alignment?",
    "How can we build more consensus in our decisions?",
  ],
  ideation: [
    "What new ideas are you exploring?",
    "Where do you feel creative thinking is needed?",
    "How can we create more space for brainstorming?",
  ],
  includer: [
    "Is everyone feeling included in our discussions?",
    "Who might we be overlooking that should be involved?",
    "How can we make our team more welcoming?",
  ],
  learner: [
    "What have you learned recently that excited you?",
    "What skills or knowledge would you like to develop?",
    "How can we support your learning journey?",
  ],
  positivity: [
    "What's going well that we should celebrate?",
    "How can we boost team morale?",
    "What brings you energy and enthusiasm at work?",
  ],
  relator: [
    "How are your key working relationships?",
    "Who would you like to build a deeper connection with?",
    "How can we support the relationships that matter to you?",
  ],
  responsibility: [
    "What commitments are weighing on you?",
    "Where do you feel you need more support to deliver?",
    "How can we better align expectations with capacity?",
  ],
  restorative: [
    "What problems are you working to solve?",
    "Where do you see issues that need attention?",
    "How can we give you time to fix things properly?",
  ],
  strategic: [
    "What options are you considering for current challenges?",
    "Where do you see the best path forward?",
    "How can we leverage your strategic thinking more?",
  ],
  woo: [
    "What new connections have you made recently?",
    "Where do you see networking opportunities?",
    "How can we use your relationship-building skills?",
  ],
};

// General questions for any 1:1
const GENERAL_QUESTIONS = {
  opening: [
    "How are you feeling overall this week?",
    "What's on your mind that we should discuss?",
    "What would make this conversation most valuable for you?",
  ],
  development: [
    "What strengths do you want to use more?",
    "What's one thing you'd like to learn or improve?",
    "How can I better support your growth?",
  ],
  closing: [
    "What's your biggest priority for the next week?",
    "Is there anything blocking your progress?",
    "What support do you need from me?",
  ],
};

interface Member {
  id: string;
  name: string;
  avatarUrl: string | null;
  jobTitle: string | null;
  topStrengths: { name: string; slug: string; domain: string }[];
}

function getInitials(name: string): string {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
}

export default function MeetingTemplatePage() {
  const searchParams = useSearchParams();
  const member1Id = searchParams.get("member1");
  const member2Id = searchParams.get("member2");

  const [member1, setMember1] = useState<Member | null>(null);
  const [member2, setMember2] = useState<Member | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // Member selection
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedMember1, setSelectedMember1] = useState<string | null>(member1Id);
  const [selectedMember2, setSelectedMember2] = useState<string | null>(member2Id);

  useEffect(() => {
    fetchMembers();
  }, []);

  useEffect(() => {
    if (member1Id && member2Id) {
      setSelectedMember1(member1Id);
      setSelectedMember2(member2Id);
      fetchMemberDetails(member1Id, member2Id);
    }
  }, [member1Id, member2Id]);

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

  const fetchMemberDetails = async (m1: string, m2: string) => {
    setLoading(true);
    try {
      const [res1, res2] = await Promise.all([
        fetch(`/api/members/${m1}`),
        fetch(`/api/members/${m2}`),
      ]);

      if (res1.ok && res2.ok) {
        const [data1, data2] = await Promise.all([res1.json(), res2.json()]);
        setMember1({
          id: data1.data.id,
          name: data1.data.user.name,
          avatarUrl: data1.data.user.image,
          jobTitle: data1.data.title,
          topStrengths: data1.data.strengths.slice(0, 5).map((s: { theme: { slug: string; name: string; domain: { slug: string } } }) => ({
            slug: s.theme.slug,
            name: s.theme.name,
            domain: s.theme.domain.slug,
          })),
        });
        setMember2({
          id: data2.data.id,
          name: data2.data.user.name,
          avatarUrl: data2.data.user.image,
          jobTitle: data2.data.title,
          topStrengths: data2.data.strengths.slice(0, 5).map((s: { theme: { slug: string; name: string; domain: { slug: string } } }) => ({
            slug: s.theme.slug,
            name: s.theme.name,
            domain: s.theme.domain.slug,
          })),
        });
      }
    } catch (err) {
      console.error("Failed to fetch member details:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = () => {
    if (selectedMember1 && selectedMember2) {
      fetchMemberDetails(selectedMember1, selectedMember2);
    }
  };

  const getStrengthQuestions = (member: Member) => {
    const questions: string[] = [];
    member.topStrengths.slice(0, 3).forEach((s) => {
      const qs = STRENGTH_QUESTIONS[s.slug];
      if (qs) {
        questions.push(qs[Math.floor(Math.random() * qs.length)]);
      }
    });
    return questions;
  };

  const generateAgendaText = (): string => {
    if (!member1 || !member2) return "";

    const lines: string[] = [
      `# 1:1 Meeting Agenda`,
      `## ${member1.name} & ${member2.name}`,
      `Date: ${new Date().toLocaleDateString()}`,
      "",
      "---",
      "",
      "## Opening (5 min)",
      ...GENERAL_QUESTIONS.opening.slice(0, 2).map((q) => `- ${q}`),
      "",
      `## For ${member1.name.split(" ")[0]} (10 min)`,
      `Based on their strengths: ${member1.topStrengths.map((s) => s.name).join(", ")}`,
      ...getStrengthQuestions(member1).map((q) => `- ${q}`),
      "",
      `## For ${member2.name.split(" ")[0]} (10 min)`,
      `Based on their strengths: ${member2.topStrengths.map((s) => s.name).join(", ")}`,
      ...getStrengthQuestions(member2).map((q) => `- ${q}`),
      "",
      "## Development & Growth (5 min)",
      ...GENERAL_QUESTIONS.development.slice(0, 2).map((q) => `- ${q}`),
      "",
      "## Closing (5 min)",
      ...GENERAL_QUESTIONS.closing.map((q) => `- ${q}`),
      "",
      "---",
      "Generated with StrengthSync",
    ];

    return lines.join("\n");
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(generateAgendaText());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/partnerships/guide">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Link>
        </Button>
      </div>

      <div>
        <h1 className="font-display text-3xl font-bold flex items-center gap-2">
          <Calendar className="h-8 w-8 text-domain-executing" />
          1:1 Meeting Template
        </h1>
        <p className="text-muted-foreground mt-1">
          Strengths-based conversation starters for your 1:1s
        </p>
      </div>

      {/* Member selection */}
      {(!member1 || !member2) && !loading && (
        <Card>
          <CardHeader>
            <CardTitle>Select Meeting Participants</CardTitle>
            <CardDescription>
              Generate a personalized meeting agenda based on strengths
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-2 block">First Person</label>
                <select
                  value={selectedMember1 || ""}
                  onChange={(e) => setSelectedMember1(e.target.value || null)}
                  className="w-full px-3 py-2 rounded-lg border bg-background"
                >
                  <option value="">Select a member...</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id} disabled={m.id === selectedMember2}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">Second Person</label>
                <select
                  value={selectedMember2 || ""}
                  onChange={(e) => setSelectedMember2(e.target.value || null)}
                  className="w-full px-3 py-2 rounded-lg border bg-background"
                >
                  <option value="">Select a member...</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id} disabled={m.id === selectedMember1}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <Button
              onClick={handleGenerate}
              disabled={!selectedMember1 || !selectedMember2}
              className="w-full"
            >
              <Sparkles className="h-4 w-4 mr-2" />
              Generate Meeting Template
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Loading */}
      {loading && (
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary mb-4" />
              <p className="text-muted-foreground">Generating personalized agenda...</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Generated Template */}
      {member1 && member2 && !loading && (
        <div className="space-y-6 print:space-y-4">
          {/* Actions */}
          <div className="flex justify-end gap-2 print:hidden">
            <Button variant="outline" size="sm" onClick={copyToClipboard}>
              {copied ? (
                <Check className="h-4 w-4 mr-2" />
              ) : (
                <Copy className="h-4 w-4 mr-2" />
              )}
              {copied ? "Copied!" : "Copy as Text"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="h-4 w-4 mr-2" />
              Print
            </Button>
          </div>

          {/* Participants */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-center gap-8">
                <div className="text-center">
                  <Avatar className="h-14 w-14 mx-auto mb-2">
                    <AvatarImage src={member1.avatarUrl || undefined} />
                    <AvatarFallback className="bg-primary text-primary-foreground">{getInitials(member1.name)}</AvatarFallback>
                  </Avatar>
                  <p className="font-semibold">{member1.name}</p>
                  <div className="flex justify-center gap-1 mt-1">
                    {member1.topStrengths.slice(0, 3).map((s) => (
                      <DomainIcon key={s.slug} domain={s.domain as DomainSlug} size="sm" />
                    ))}
                  </div>
                </div>

                <div className="text-muted-foreground">
                  <Clock className="h-6 w-6" />
                </div>

                <div className="text-center">
                  <Avatar className="h-14 w-14 mx-auto mb-2">
                    <AvatarImage src={member2.avatarUrl || undefined} />
                    <AvatarFallback className="bg-primary text-primary-foreground">{getInitials(member2.name)}</AvatarFallback>
                  </Avatar>
                  <p className="font-semibold">{member2.name}</p>
                  <div className="flex justify-center gap-1 mt-1">
                    {member2.topStrengths.slice(0, 3).map((s) => (
                      <DomainIcon key={s.slug} domain={s.domain as DomainSlug} size="sm" />
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Agenda sections */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <MessageCircle className="h-5 w-5 text-primary" />
                Opening (5 min)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {GENERAL_QUESTIONS.opening.slice(0, 2).map((q, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm">
                    <span className="text-primary">•</span>
                    {q}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-domain-executing">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <Users className="h-5 w-5 text-domain-executing" />
                For {member1.name.split(" ")[0]} (10 min)
              </CardTitle>
              <CardDescription>
                Based on: {member1.topStrengths.map((s) => s.name).join(", ")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {getStrengthQuestions(member1).map((q, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm">
                    <span className="text-domain-executing">•</span>
                    {q}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-domain-relationship">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <Users className="h-5 w-5 text-domain-relationship" />
                For {member2.name.split(" ")[0]} (10 min)
              </CardTitle>
              <CardDescription>
                Based on: {member2.topStrengths.map((s) => s.name).join(", ")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {getStrengthQuestions(member2).map((q, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm">
                    <span className="text-domain-relationship">•</span>
                    {q}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <Lightbulb className="h-5 w-5 text-domain-strategic" />
                Development & Growth (5 min)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {GENERAL_QUESTIONS.development.slice(0, 2).map((q, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm">
                    <span className="text-domain-strategic">•</span>
                    {q}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <Target className="h-5 w-5 text-domain-influencing" />
                Closing (5 min)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {GENERAL_QUESTIONS.closing.map((q, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm">
                    <span className="text-domain-influencing">•</span>
                    {q}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {/* Generate new */}
          <div className="text-center print:hidden">
            <Button
              variant="outline"
              onClick={() => {
                setMember1(null);
                setMember2(null);
              }}
            >
              Generate Another Template
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
