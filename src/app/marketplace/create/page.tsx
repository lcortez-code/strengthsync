"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { DomainIcon } from "@/components/strengths/DomainIcon";
import {
  ShoppingBag,
  ArrowLeft,
  Send,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { DomainSlug } from "@/constants/strengths-data";

interface Theme {
  id: string;
  name: string;
  slug: string;
  domain: {
    slug: string;
    colorHex: string;
  };
}

const DOMAINS: { slug: DomainSlug; name: string }[] = [
  { slug: "executing", name: "Executing" },
  { slug: "influencing", name: "Influencing" },
  { slug: "relationship", name: "Relationship Building" },
  { slug: "strategic", name: "Strategic Thinking" },
];

const URGENCY_OPTIONS = [
  { value: "LOW", label: "Low", description: "No rush, whenever someone has time" },
  { value: "NORMAL", label: "Normal", description: "Within a week or so" },
  { value: "HIGH", label: "High", description: "Within a few days" },
  { value: "URGENT", label: "Urgent", description: "As soon as possible" },
];

export default function CreateRequestPage() {
  const router = useRouter();
  const [themes, setThemes] = useState<Theme[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const [selectedTheme, setSelectedTheme] = useState<string | null>(null);
  const [urgency, setUrgency] = useState("NORMAL");
  const [deadline, setDeadline] = useState("");

  useEffect(() => {
    fetchThemes();
  }, []);

  const fetchThemes = async () => {
    try {
      const res = await fetch("/api/themes");
      if (res.ok) {
        const result = await res.json();
        setThemes(result.data || []);
      }
    } catch (err) {
      console.error("Failed to fetch themes:", err);
    }
  };

  const filteredThemes = selectedDomain
    ? themes.filter((t) => t.domain.slug === selectedDomain)
    : themes;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!title.trim() || title.length < 5) {
      setError("Title must be at least 5 characters");
      return;
    }
    if (!description.trim() || description.length < 20) {
      setError("Description must be at least 20 characters");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/skill-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          themeId: selectedTheme || undefined,
          domainNeeded: selectedDomain || undefined,
          urgency,
          deadline: deadline || undefined,
        }),
      });

      const result = await res.json();

      if (!res.ok) {
        setError(result.error?.message || "Failed to create request");
        return;
      }

      router.push(`/marketplace/${result.data.id}`);
    } catch (err) {
      setError("An unexpected error occurred");
      console.error("Create request error:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/marketplace">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShoppingBag className="h-6 w-6 text-domain-influencing" />
            Create Skill Request
          </CardTitle>
          <CardDescription>
            Describe what help you need and which strengths would be most useful
          </CardDescription>
        </CardHeader>

        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-6">
            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-50 text-red-600 rounded-lg text-sm">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                {error}
              </div>
            )}

            {/* Title */}
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="title">
                Title <span className="text-red-500">*</span>
              </label>
              <input
                id="title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Need help with strategic planning for Q2"
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                maxLength={200}
              />
              <p className="text-xs text-muted-foreground">
                {title.length}/200 characters
              </p>
            </div>

            {/* Description */}
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="description">
                Description <span className="text-red-500">*</span>
              </label>
              <textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe what you're working on, what kind of help you need, and any relevant context..."
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary min-h-[120px]"
                maxLength={2000}
              />
              <p className="text-xs text-muted-foreground">
                {description.length}/2000 characters (minimum 20)
              </p>
            </div>

            {/* Domain Filter */}
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Domain Needed (optional)
              </label>
              <p className="text-xs text-muted-foreground mb-2">
                What type of thinking would be most helpful?
              </p>
              <div className="flex flex-wrap gap-2">
                {DOMAINS.map((domain) => (
                  <button
                    key={domain.slug}
                    type="button"
                    onClick={() => {
                      setSelectedDomain(selectedDomain === domain.slug ? null : domain.slug);
                      setSelectedTheme(null);
                    }}
                    className={cn(
                      "flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors",
                      selectedDomain === domain.slug
                        ? `bg-domain-${domain.slug}-light border-domain-${domain.slug}`
                        : "hover:bg-muted"
                    )}
                  >
                    <DomainIcon domain={domain.slug} size="sm" />
                    <span className="text-sm">{domain.name}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Theme Selection */}
            {selectedDomain && (
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Specific Theme (optional)
                </label>
                <p className="text-xs text-muted-foreground mb-2">
                  Select a specific CliftonStrength if you know what you need
                </p>
                <div className="flex flex-wrap gap-2">
                  {filteredThemes.map((theme) => (
                    <button
                      key={theme.id}
                      type="button"
                      onClick={() =>
                        setSelectedTheme(selectedTheme === theme.id ? null : theme.id)
                      }
                      className={cn(
                        "px-3 py-1 text-sm rounded-full border transition-colors",
                        selectedTheme === theme.id
                          ? `bg-domain-${theme.domain.slug} text-white border-domain-${theme.domain.slug}`
                          : "hover:bg-muted"
                      )}
                    >
                      {theme.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Urgency */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Urgency</label>
              <div className="grid grid-cols-2 gap-2">
                {URGENCY_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setUrgency(option.value)}
                    className={cn(
                      "p-3 text-left rounded-lg border transition-colors",
                      urgency === option.value
                        ? "border-primary bg-primary/5"
                        : "hover:bg-muted"
                    )}
                  >
                    <div className="font-medium text-sm">{option.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {option.description}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Deadline */}
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="deadline">
                Deadline (optional)
              </label>
              <input
                id="deadline"
                type="datetime-local"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                min={new Date().toISOString().slice(0, 16)}
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>
          </CardContent>

          <CardFooter className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              asChild
            >
              <Link href="/marketplace">Cancel</Link>
            </Button>
            <Button
              type="submit"
              className="flex-1"
              disabled={loading || !title.trim() || !description.trim()}
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Post Request
                </>
              )}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
