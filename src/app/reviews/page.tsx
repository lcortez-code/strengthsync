"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/Avatar";
import {
  ClipboardList,
  Calendar,
  CheckCircle2,
  Clock,
  AlertCircle,
  ChevronRight,
  Target,
  FileText,
  Star,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Review {
  id: string;
  status: string;
  overallRating: string | null;
  isMyReview: boolean;
  isReviewer: boolean;
  cycle: {
    id: string;
    name: string;
    cycleType: string;
    startsAt: string;
    endsAt: string;
    status: string;
  };
  member: {
    id: string;
    name: string;
    avatarUrl: string | null;
    jobTitle: string | null;
  };
  reviewer: {
    id: string;
    name: string;
    avatarUrl: string | null;
  } | null;
  goalCount: number;
  evidenceCount: number;
  selfAssessmentAt: string | null;
  completedAt: string | null;
}

interface ReviewsResponse {
  myReviews: Review[];
  reviewsToConduct: Review[];
  total: number;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  NOT_STARTED: { label: "Not Started", color: "text-gray-500 bg-gray-100 dark:text-gray-400 dark:bg-gray-800", icon: Clock },
  SELF_ASSESSMENT: { label: "Self-Assessment", color: "text-blue-600 bg-blue-100 dark:text-blue-400 dark:bg-blue-900/30", icon: FileText },
  MANAGER_REVIEW: { label: "Manager Review", color: "text-orange-600 bg-orange-100 dark:text-orange-400 dark:bg-orange-900/30", icon: Users },
  COMPLETED: { label: "Completed", color: "text-green-600 bg-green-100 dark:text-green-400 dark:bg-green-900/30", icon: CheckCircle2 },
  ACKNOWLEDGED: { label: "Acknowledged", color: "text-purple-600 bg-purple-100 dark:text-purple-400 dark:bg-purple-900/30", icon: Star },
};

const RATING_LABELS: Record<string, { label: string; color: string }> = {
  EXCEEDS_EXPECTATIONS: { label: "Exceeds Expectations", color: "text-green-600 dark:text-green-400" },
  MEETS_EXPECTATIONS: { label: "Meets Expectations", color: "text-blue-600 dark:text-blue-400" },
  DEVELOPING: { label: "Developing", color: "text-orange-600 dark:text-orange-400" },
  NEEDS_IMPROVEMENT: { label: "Needs Improvement", color: "text-red-600 dark:text-red-400" },
};

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function ReviewCard({ review, perspective }: { review: Review; perspective: "subject" | "reviewer" }) {
  const status = STATUS_CONFIG[review.status] || STATUS_CONFIG.NOT_STARTED;
  const StatusIcon = status.icon;
  const rating = review.overallRating ? RATING_LABELS[review.overallRating] : null;

  return (
    <Link href={`/reviews/${review.id}`}>
      <Card className="hover:shadow-md transition-shadow cursor-pointer">
        <CardContent className="p-4">
          <div className="flex items-start gap-4">
            {/* Avatar */}
            <Avatar className="h-12 w-12">
              <AvatarImage src={review.member.avatarUrl || undefined} />
              <AvatarFallback className="bg-primary text-primary-foreground">
                {getInitials(review.member.name)}
              </AvatarFallback>
            </Avatar>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-foreground">
                    {perspective === "reviewer" ? review.member.name : review.cycle.name}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {perspective === "reviewer" ? review.member.jobTitle : review.cycle.cycleType.replace("_", " ")}
                  </p>
                </div>
                <div className={cn("flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium", status.color)}>
                  <StatusIcon className="h-3 w-3" />
                  {status.label}
                </div>
              </div>

              {/* Meta info */}
              <div className="flex flex-wrap items-center gap-4 mt-3 text-sm text-muted-foreground">
                <div className="flex items-center gap-1">
                  <Calendar className="h-4 w-4" />
                  <span>
                    {formatDate(review.cycle.startsAt)} - {formatDate(review.cycle.endsAt)}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Target className="h-4 w-4" />
                  <span>{review.goalCount} goals</span>
                </div>
                <div className="flex items-center gap-1">
                  <FileText className="h-4 w-4" />
                  <span>{review.evidenceCount} evidence</span>
                </div>
              </div>

              {/* Rating if completed */}
              {rating && (
                <div className={cn("mt-2 text-sm font-medium", rating.color)}>
                  {rating.label}
                </div>
              )}

              {/* Reviewer info for subject view */}
              {perspective === "subject" && review.reviewer && (
                <div className="flex items-center gap-2 mt-2 text-sm text-muted-foreground">
                  <span>Reviewer:</span>
                  <Avatar className="h-5 w-5">
                    <AvatarImage src={review.reviewer.avatarUrl || undefined} />
                    <AvatarFallback className="text-xs bg-muted dark:bg-muted/50">
                      {getInitials(review.reviewer.name)}
                    </AvatarFallback>
                  </Avatar>
                  <span>{review.reviewer.name}</span>
                </div>
              )}
            </div>

            <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export default function ReviewsPage() {
  const [data, setData] = useState<ReviewsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"my" | "conduct">("my");

  useEffect(() => {
    fetchReviews();
  }, []);

  const fetchReviews = async () => {
    try {
      const res = await fetch("/api/reviews");
      if (res.ok) {
        const result = await res.json();
        setData(result.data);
      }
    } catch (error) {
      console.error("Failed to fetch reviews:", error);
    } finally {
      setLoading(false);
    }
  };

  const myReviews = data?.myReviews || [];
  const reviewsToConduct = data?.reviewsToConduct || [];
  const activeReviews = activeTab === "my" ? myReviews : reviewsToConduct;

  // Count pending actions
  const pendingSelfAssessment = myReviews.filter(
    (r) => r.status === "NOT_STARTED" || r.status === "SELF_ASSESSMENT"
  ).length;
  const pendingManagerReview = reviewsToConduct.filter(
    (r) => r.status === "MANAGER_REVIEW"
  ).length;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-display text-3xl font-bold flex items-center gap-2">
          <ClipboardList className="h-8 w-8 text-primary" />
          Performance Reviews
        </h1>
        <p className="text-muted-foreground mt-1">
          Track your performance reviews and goals
        </p>
      </div>

      {/* Action Alerts */}
      {(pendingSelfAssessment > 0 || pendingManagerReview > 0) && (
        <div className="space-y-2">
          {pendingSelfAssessment > 0 && (
            <div className="flex items-center gap-3 p-3 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 rounded-lg">
              <AlertCircle className="h-5 w-5 flex-shrink-0" />
              <span>
                You have <strong>{pendingSelfAssessment}</strong> self-assessment
                {pendingSelfAssessment > 1 ? "s" : ""} to complete
              </span>
            </div>
          )}
          {pendingManagerReview > 0 && (
            <div className="flex items-center gap-3 p-3 bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300 rounded-lg">
              <AlertCircle className="h-5 w-5 flex-shrink-0" />
              <span>
                You have <strong>{pendingManagerReview}</strong> review
                {pendingManagerReview > 1 ? "s" : ""} to conduct
              </span>
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      {reviewsToConduct.length > 0 && (
        <div className="flex gap-2 border-b">
          <button
            onClick={() => setActiveTab("my")}
            className={cn(
              "flex items-center gap-2 px-4 py-2 border-b-2 -mb-px transition-colors",
              activeTab === "my"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <FileText className="h-4 w-4" />
            My Reviews ({myReviews.length})
          </button>
          <button
            onClick={() => setActiveTab("conduct")}
            className={cn(
              "flex items-center gap-2 px-4 py-2 border-b-2 -mb-px transition-colors",
              activeTab === "conduct"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <Users className="h-4 w-4" />
            Reviews to Conduct ({reviewsToConduct.length})
            {pendingManagerReview > 0 && (
              <span className="ml-1 px-1.5 py-0.5 text-xs bg-orange-500 text-white rounded-full">
                {pendingManagerReview}
              </span>
            )}
          </button>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <div className="animate-pulse flex items-start gap-4">
                  <div className="h-12 w-12 rounded-full bg-muted" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-muted rounded w-1/3" />
                    <div className="h-3 bg-muted rounded w-1/4" />
                    <div className="h-3 bg-muted rounded w-1/2" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : activeReviews.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <ClipboardList className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-2">
              {activeTab === "my" ? "No Reviews Yet" : "No Reviews to Conduct"}
            </h3>
            <p className="text-muted-foreground max-w-sm mx-auto">
              {activeTab === "my"
                ? "You don't have any performance reviews assigned yet. When a review cycle starts, your reviews will appear here."
                : "You don't have any team member reviews to conduct at this time."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {activeReviews.map((review) => (
            <ReviewCard
              key={review.id}
              review={review}
              perspective={activeTab === "my" ? "subject" : "reviewer"}
            />
          ))}
        </div>
      )}
    </div>
  );
}
