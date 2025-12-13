"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/Avatar";
import { DomainIcon } from "@/components/strengths/DomainIcon";
import { ThemeBadge } from "@/components/strengths/ThemeBadge";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  HandshakeIcon,
  Sparkles,
  AlertTriangle,
  Lightbulb,
  Users,
  CheckCircle2,
  Printer,
  Search,
  Loader2,
  ArrowRight,
} from "lucide-react";
import Link from "next/link";
import type { DomainSlug } from "@/constants/strengths-data";

interface PartnershipGuide {
  member1: {
    id: string;
    name: string;
    avatarUrl: string | null;
    jobTitle: string | null;
    topStrengths: { name: string; domain: string }[];
    dominantDomain: string;
  };
  member2: {
    id: string;
    name: string;
    avatarUrl: string | null;
    jobTitle: string | null;
    topStrengths: { name: string; domain: string }[];
    dominantDomain: string;
  };
  complementaryStrengths: { theme1: string; theme2: string; reason: string }[];
  potentialFriction: { theme1: string; theme2: string; tip: string }[];
  collaborationTips: string[];
  sharedStrengths: string[];
}

interface Member {
  id: string;
  name: string;
  avatarUrl: string | null;
  jobTitle: string | null;
}

function getInitials(name: string): string {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
}

export default function PartnershipGuidePage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const member1Id = searchParams.get("member1");
  const member2Id = searchParams.get("member2");

  const [guide, setGuide] = useState<PartnershipGuide | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Member selection state
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedMember1, setSelectedMember1] = useState<string | null>(member1Id);
  const [selectedMember2, setSelectedMember2] = useState<string | null>(member2Id);
  const [memberSearch, setMemberSearch] = useState("");

  // Fetch members for selection
  useEffect(() => {
    fetchMembers();
  }, []);

  // Fetch guide when both members are selected
  useEffect(() => {
    if (member1Id && member2Id) {
      setSelectedMember1(member1Id);
      setSelectedMember2(member2Id);
      fetchGuide(member1Id, member2Id);
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

  const fetchGuide = async (m1: string, m2: string) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/partnerships/guide?member1=${m1}&member2=${m2}`);
      if (!response.ok) {
        const data = await response.json();
        setError(data.error?.message || "Failed to generate guide");
        return;
      }
      const result = await response.json();
      setGuide(result.data);
    } catch (err) {
      setError("Failed to generate partnership guide");
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateGuide = () => {
    if (selectedMember1 && selectedMember2) {
      router.push(`/partnerships/guide?member1=${selectedMember1}&member2=${selectedMember2}`);
      fetchGuide(selectedMember1, selectedMember2);
    }
  };

  const filteredMembers = members.filter(
    (m) =>
      m.name.toLowerCase().includes(memberSearch.toLowerCase()) ||
      m.jobTitle?.toLowerCase().includes(memberSearch.toLowerCase())
  );

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/team">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Team
          </Link>
        </Button>
      </div>

      <div>
        <h1 className="font-display text-3xl font-bold flex items-center gap-2">
          <HandshakeIcon className="h-8 w-8 text-domain-relationship" />
          Partnership Guide
        </h1>
        <p className="text-muted-foreground mt-1">
          Personalized collaboration guide based on CliftonStrengths
        </p>
      </div>

      {/* Member selection */}
      {!guide && !loading && (
        <Card>
          <CardHeader>
            <CardTitle>Select Two Team Members</CardTitle>
            <CardDescription>
              Generate a personalized guide for how they can work together effectively
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              {/* Member 1 */}
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

              {/* Member 2 */}
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
              onClick={handleGenerateGuide}
              disabled={!selectedMember1 || !selectedMember2}
              className="w-full"
            >
              <Sparkles className="h-4 w-4 mr-2" />
              Generate Partnership Guide
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
              <p className="text-muted-foreground">Analyzing strengths and generating guide...</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error */}
      {error && (
        <Card className="border-destructive">
          <CardContent className="py-6">
            <div className="text-center text-destructive">
              <AlertTriangle className="h-8 w-8 mx-auto mb-2" />
              <p>{error}</p>
              <Button variant="outline" className="mt-4" onClick={() => setGuide(null)}>
                Try Again
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Partnership Guide */}
      {guide && (
        <div className="space-y-6 print:space-y-4">
          {/* Print button */}
          <div className="flex justify-end print:hidden">
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="h-4 w-4 mr-2" />
              Print Guide
            </Button>
          </div>

          {/* Partner profiles */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between gap-4">
                {/* Member 1 */}
                <Link href={`/team/${guide.member1.id}`} className="flex-1 text-center hover:opacity-80">
                  <Avatar className="h-16 w-16 mx-auto mb-2">
                    <AvatarImage src={guide.member1.avatarUrl || undefined} />
                    <AvatarFallback className={`bg-domain-${guide.member1.dominantDomain}/20 dark:bg-domain-${guide.member1.dominantDomain}/30`}>
                      {getInitials(guide.member1.name)}
                    </AvatarFallback>
                  </Avatar>
                  <p className="font-semibold">{guide.member1.name}</p>
                  <p className="text-sm text-muted-foreground">{guide.member1.jobTitle}</p>
                  <div className="flex justify-center gap-1 mt-2">
                    {guide.member1.topStrengths.slice(0, 3).map((s) => (
                      <DomainIcon key={s.name} domain={s.domain as DomainSlug} size="sm" />
                    ))}
                  </div>
                </Link>

                {/* Arrow */}
                <div className="flex flex-col items-center">
                  <HandshakeIcon className="h-8 w-8 text-domain-relationship" />
                  <ArrowRight className="h-4 w-4 text-muted-foreground -mt-1 rotate-180" />
                  <ArrowRight className="h-4 w-4 text-muted-foreground -mt-1" />
                </div>

                {/* Member 2 */}
                <Link href={`/team/${guide.member2.id}`} className="flex-1 text-center hover:opacity-80">
                  <Avatar className="h-16 w-16 mx-auto mb-2">
                    <AvatarImage src={guide.member2.avatarUrl || undefined} />
                    <AvatarFallback className={`bg-domain-${guide.member2.dominantDomain}/20 dark:bg-domain-${guide.member2.dominantDomain}/30`}>
                      {getInitials(guide.member2.name)}
                    </AvatarFallback>
                  </Avatar>
                  <p className="font-semibold">{guide.member2.name}</p>
                  <p className="text-sm text-muted-foreground">{guide.member2.jobTitle}</p>
                  <div className="flex justify-center gap-1 mt-2">
                    {guide.member2.topStrengths.slice(0, 3).map((s) => (
                      <DomainIcon key={s.name} domain={s.domain as DomainSlug} size="sm" />
                    ))}
                  </div>
                </Link>
              </div>
            </CardContent>
          </Card>

          {/* Shared Strengths */}
          {guide.sharedStrengths.length > 0 && (
            <Card className="border-domain-relationship/30 bg-domain-relationship/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2 text-domain-relationship">
                  <Users className="h-5 w-5" />
                  Shared Strengths
                </CardTitle>
                <CardDescription>Themes you both have in your top 10</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {guide.sharedStrengths.map((s) => (
                    <span
                      key={s}
                      className="px-3 py-1 rounded-full bg-domain-relationship/20 text-domain-relationship text-sm"
                    >
                      {s}
                    </span>
                  ))}
                </div>
                <p className="text-sm text-muted-foreground mt-3">
                  Shared strengths create natural understanding and common ground for collaboration.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Complementary Strengths */}
          {guide.complementaryStrengths.length > 0 && (
            <Card className="border-domain-strategic/30 bg-domain-strategic/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2 text-domain-strategic">
                  <Sparkles className="h-5 w-5" />
                  Complementary Strengths
                </CardTitle>
                <CardDescription>How your strengths enhance each other</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {guide.complementaryStrengths.map((cs, idx) => (
                    <div key={idx} className="flex items-start gap-3 p-3 rounded-lg bg-white/50 dark:bg-background/50">
                      <CheckCircle2 className="h-5 w-5 text-domain-strategic flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium text-sm">
                          <span className="text-domain-strategic">{cs.theme1}</span>
                          {" + "}
                          <span className="text-domain-strategic">{cs.theme2}</span>
                        </p>
                        <p className="text-sm text-muted-foreground">{cs.reason}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Potential Friction */}
          {guide.potentialFriction.length > 0 && (
            <Card className="border-amber-200 bg-amber-50/50 dark:bg-amber-950/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2 text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-5 w-5" />
                  Watch Out For
                </CardTitle>
                <CardDescription>Areas where you may need extra communication</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {guide.potentialFriction.map((pf, idx) => (
                    <div key={idx} className="flex items-start gap-3 p-3 rounded-lg bg-white/50 dark:bg-background/50">
                      <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium text-sm">
                          {pf.theme1} ↔ {pf.theme2}
                        </p>
                        <p className="text-sm text-muted-foreground">{pf.tip}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Collaboration Tips */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <Lightbulb className="h-5 w-5 text-domain-influencing" />
                Collaboration Tips
              </CardTitle>
              <CardDescription>
                How to work together effectively based on your dominant domains
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {guide.collaborationTips.map((tip, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm">
                    <CheckCircle2 className="h-4 w-4 text-domain-executing mt-0.5 flex-shrink-0" />
                    {tip}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {/* Generate new guide */}
          <div className="text-center print:hidden">
            <Button variant="outline" onClick={() => { setGuide(null); setError(null); }}>
              Generate Another Guide
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
