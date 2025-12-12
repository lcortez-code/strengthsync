"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import {
  Settings,
  User,
  Building2,
  Bell,
  Save,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Mail,
  MessageSquare,
  Users,
  Target,
  ShoppingBag,
  Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Preferences {
  weeklyDigestEnabled: boolean;
  shoutoutNotificationsEnabled: boolean;
  mentorshipNotificationsEnabled: boolean;
  challengeNotificationsEnabled: boolean;
  marketplaceNotificationsEnabled: boolean;
}

interface PreferenceToggleProps {
  icon: React.ElementType;
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

function PreferenceToggle({
  icon: Icon,
  title,
  description,
  checked,
  onChange,
  disabled,
}: PreferenceToggleProps) {
  return (
    <div className="flex items-start gap-4 p-4 rounded-lg border hover:bg-muted/50 transition-colors">
      <div className="p-2 rounded-lg bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium">{title}</div>
        <p className="text-sm text-muted-foreground mt-1">{description}</p>
      </div>
      <label className="relative inline-flex items-center cursor-pointer">
        <input
          type="checkbox"
          className="sr-only peer"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
        />
        <div
          className={cn(
            "w-11 h-6 rounded-full peer",
            "bg-muted peer-checked:bg-primary",
            "after:content-[''] after:absolute after:top-[2px] after:left-[2px]",
            "after:bg-background after:shadow-sm after:rounded-full after:h-5 after:w-5",
            "after:transition-transform peer-checked:after:translate-x-5",
            disabled && "opacity-50 cursor-not-allowed"
          )}
        />
      </label>
    </div>
  );
}

export default function NotificationSettingsPage() {
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const [preferences, setPreferences] = useState<Preferences>({
    weeklyDigestEnabled: true,
    shoutoutNotificationsEnabled: true,
    mentorshipNotificationsEnabled: true,
    challengeNotificationsEnabled: true,
    marketplaceNotificationsEnabled: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Handle unsubscribe query param
  const unsubscribeType = searchParams.get("unsubscribe");

  useEffect(() => {
    fetchPreferences();
  }, []);

  useEffect(() => {
    // Auto-unsubscribe if query param present
    if (unsubscribeType === "weekly" && !loading) {
      handleUnsubscribe();
    }
  }, [unsubscribeType, loading]);

  const fetchPreferences = async () => {
    try {
      const res = await fetch("/api/me/preferences");
      if (res.ok) {
        const result = await res.json();
        setPreferences(result.data.preferences);
      }
    } catch (err) {
      console.error("Failed to fetch preferences:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleUnsubscribe = async () => {
    setPreferences((prev) => ({ ...prev, weeklyDigestEnabled: false }));
    await savePreferences({ weeklyDigestEnabled: false });
  };

  const savePreferences = async (updates: Partial<Preferences>) => {
    setError(null);
    setSaving(true);

    try {
      const res = await fetch("/api/me/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      const result = await res.json();

      if (!res.ok) {
        setError(result.error?.message || "Failed to save preferences");
        return;
      }

      setPreferences(result.data.preferences);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError("An unexpected error occurred");
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = (key: keyof Preferences, value: boolean) => {
    const newPrefs = { ...preferences, [key]: value };
    setPreferences(newPrefs);
    savePreferences({ [key]: value });
  };

  const handlePreviewDigest = () => {
    setPreviewLoading(true);
    // Open in new tab
    window.open("/api/email/digest?format=html", "_blank");
    setTimeout(() => setPreviewLoading(false), 1000);
  };

  const isAdmin =
    session?.user?.role === "OWNER" || session?.user?.role === "ADMIN";

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-display text-3xl font-bold flex items-center gap-2">
          <Settings className="h-8 w-8 text-primary" />
          Settings
        </h1>
        <p className="text-muted-foreground mt-1">
          Manage your account and preferences
        </p>
      </div>

      {/* Navigation Tabs */}
      <div className="flex gap-2 border-b overflow-x-auto">
        <Link
          href="/settings/profile"
          className="flex items-center gap-2 px-4 py-2 border-b-2 -mb-px border-transparent text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap"
        >
          <User className="h-4 w-4" />
          Profile
        </Link>
        <Link
          href="/settings/notifications"
          className={cn(
            "flex items-center gap-2 px-4 py-2 border-b-2 -mb-px transition-colors whitespace-nowrap",
            "border-primary text-primary"
          )}
        >
          <Bell className="h-4 w-4" />
          Notifications
        </Link>
        {isAdmin && (
          <Link
            href="/settings/organization"
            className="flex items-center gap-2 px-4 py-2 border-b-2 -mb-px border-transparent text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap"
          >
            <Building2 className="h-4 w-4" />
            Organization
          </Link>
        )}
      </div>

      {/* Unsubscribe Banner */}
      {unsubscribeType === "weekly" && success && (
        <div className="flex items-center gap-2 p-4 bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400 rounded-lg">
          <CheckCircle2 className="h-5 w-5 flex-shrink-0" />
          <span>
            You have been unsubscribed from weekly digest emails. You can
            re-enable them below.
          </span>
        </div>
      )}

      {loading ? (
        <Card>
          <CardContent className="py-12">
            <div className="animate-pulse space-y-4">
              <div className="h-20 bg-muted rounded" />
              <div className="h-20 bg-muted rounded" />
              <div className="h-20 bg-muted rounded" />
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Feedback Messages */}
          {error && (
            <div className="flex items-center gap-2 p-3 bg-destructive/10 text-destructive rounded-lg text-sm">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {success && !unsubscribeType && (
            <div className="flex items-center gap-2 p-3 bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400 rounded-lg text-sm">
              <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
              Preferences saved successfully!
            </div>
          )}

          {/* Email Notifications */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5" />
                Email Notifications
              </CardTitle>
              <CardDescription>
                Manage the emails you receive from StrengthSync
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <PreferenceToggle
                icon={Mail}
                title="Weekly Digest"
                description="Receive a weekly summary of your shoutouts, points, badges, and team activity every Monday"
                checked={preferences.weeklyDigestEnabled}
                onChange={(checked) =>
                  handleToggle("weeklyDigestEnabled", checked)
                }
                disabled={saving}
              />

              <div className="flex items-center gap-2 pt-2 border-t">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePreviewDigest}
                  disabled={previewLoading}
                >
                  {previewLoading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Eye className="h-4 w-4 mr-2" />
                  )}
                  Preview Digest
                </Button>
                <span className="text-xs text-muted-foreground">
                  See what your weekly digest email looks like
                </span>
              </div>
            </CardContent>
          </Card>

          {/* In-App Notifications */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="h-5 w-5" />
                In-App Notifications
              </CardTitle>
              <CardDescription>
                Control which activities trigger notifications in the app
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <PreferenceToggle
                icon={MessageSquare}
                title="Shoutouts"
                description="Get notified when someone gives you a shoutout or recognizes your strengths"
                checked={preferences.shoutoutNotificationsEnabled}
                onChange={(checked) =>
                  handleToggle("shoutoutNotificationsEnabled", checked)
                }
                disabled={saving}
              />

              <PreferenceToggle
                icon={Users}
                title="Mentorship"
                description="Get notified about mentorship requests and updates"
                checked={preferences.mentorshipNotificationsEnabled}
                onChange={(checked) =>
                  handleToggle("mentorshipNotificationsEnabled", checked)
                }
                disabled={saving}
              />

              <PreferenceToggle
                icon={Target}
                title="Challenges"
                description="Get notified about new challenges, progress, and achievements"
                checked={preferences.challengeNotificationsEnabled}
                onChange={(checked) =>
                  handleToggle("challengeNotificationsEnabled", checked)
                }
                disabled={saving}
              />

              <PreferenceToggle
                icon={ShoppingBag}
                title="Marketplace"
                description="Get notified when someone responds to your skill requests"
                checked={preferences.marketplaceNotificationsEnabled}
                onChange={(checked) =>
                  handleToggle("marketplaceNotificationsEnabled", checked)
                }
                disabled={saving}
              />
            </CardContent>
          </Card>

          {/* Saving Indicator */}
          {saving && (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving...
            </div>
          )}
        </div>
      )}
    </div>
  );
}
