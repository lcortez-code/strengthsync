"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/Avatar";
import { DomainIcon } from "@/components/strengths/DomainIcon";
import { ThemeBadge } from "@/components/strengths/ThemeBadge";
import {
  ShoppingBag,
  Plus,
  RefreshCw,
  Clock,
  AlertCircle,
  CheckCircle2,
  MessageCircle,
  User,
  Calendar,
  Filter,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { DomainSlug } from "@/constants/strengths-data";

interface SkillRequest {
  id: string;
  title: string;
  description: string;
  status: string;
  urgency: string;
  deadline: string | null;
  domainNeeded: string | null;
  theme: {
    id: string;
    name: string;
    domain: string;
    domainColor: string;
  } | null;
  creator: {
    id: string;
    name: string;
    avatarUrl: string | null;
    jobTitle: string | null;
  };
  responseCount: number;
  isOwner: boolean;
  createdAt: string;
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function getUrgencyBadge(urgency: string) {
  switch (urgency) {
    case "URGENT":
      return (
        <span className="flex items-center gap-1 text-xs font-medium text-red-600 bg-red-50 dark:text-red-400 dark:bg-red-900/30 px-2 py-0.5 rounded-full">
          <AlertCircle className="h-3 w-3" />
          Urgent
        </span>
      );
    case "HIGH":
      return (
        <span className="flex items-center gap-1 text-xs font-medium text-orange-600 bg-orange-50 dark:text-orange-400 dark:bg-orange-900/30 px-2 py-0.5 rounded-full">
          <Clock className="h-3 w-3" />
          High Priority
        </span>
      );
    case "NORMAL":
      return (
        <span className="flex items-center gap-1 text-xs font-medium text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-900/30 px-2 py-0.5 rounded-full">
          Normal
        </span>
      );
    case "LOW":
      return (
        <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
          Low Priority
        </span>
      );
    default:
      return null;
  }
}

function getStatusBadge(status: string) {
  switch (status) {
    case "OPEN":
      return (
        <span className="flex items-center gap-1 text-xs font-medium text-green-600 bg-green-50 dark:text-green-400 dark:bg-green-900/30 px-2 py-0.5 rounded-full">
          <CheckCircle2 className="h-3 w-3" />
          Open
        </span>
      );
    case "IN_PROGRESS":
      return (
        <span className="flex items-center gap-1 text-xs font-medium text-domain-strategic bg-domain-strategic-light dark:bg-domain-strategic/20 dark:text-domain-strategic-muted px-2 py-0.5 rounded-full">
          <Clock className="h-3 w-3" />
          In Progress
        </span>
      );
    case "FULFILLED":
      return (
        <span className="flex items-center gap-1 text-xs font-medium text-domain-executing bg-domain-executing-light dark:bg-domain-executing/20 dark:text-domain-executing-muted px-2 py-0.5 rounded-full">
          <CheckCircle2 className="h-3 w-3" />
          Fulfilled
        </span>
      );
    case "CLOSED":
      return (
        <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
          Closed
        </span>
      );
    default:
      return null;
  }
}

export default function MarketplacePage() {
  const [requests, setRequests] = useState<SkillRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("OPEN");
  const [showMyRequests, setShowMyRequests] = useState(false);

  useEffect(() => {
    fetchRequests();
  }, [statusFilter, showMyRequests]);

  const fetchRequests = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter && statusFilter !== "ALL") {
        params.append("status", statusFilter);
      }
      if (showMyRequests) {
        params.append("mine", "true");
      }
      params.append("limit", "20");

      const res = await fetch(`/api/skill-requests?${params}`);
      if (res.ok) {
        const result = await res.json();
        setRequests(result.data || []);
      }
    } catch (err) {
      console.error("Failed to fetch requests:", err);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffHours < 1) return "Just now";
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold flex items-center gap-2">
            <ShoppingBag className="h-8 w-8 text-domain-influencing" />
            Skills Marketplace
          </h1>
          <p className="text-muted-foreground mt-1">
            Request help from teammates with specific strengths
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchRequests}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button asChild>
            <Link href="/marketplace/create">
              <Plus className="h-4 w-4 mr-2" />
              New Request
            </Link>
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Filters:</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {["ALL", "OPEN", "IN_PROGRESS", "FULFILLED", "CLOSED"].map((status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={cn(
                    "px-3 py-1 text-sm rounded-full transition-colors",
                    statusFilter === status
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted hover:bg-muted/80"
                  )}
                >
                  {status === "ALL" ? "All" : status.replace("_", " ").toLowerCase().replace(/^\w/, c => c.toUpperCase())}
                </button>
              ))}
            </div>
            <div className="ml-auto">
              <button
                onClick={() => setShowMyRequests(!showMyRequests)}
                className={cn(
                  "px-3 py-1 text-sm rounded-full transition-colors",
                  showMyRequests
                    ? "bg-domain-relationship text-white"
                    : "bg-muted hover:bg-muted/80"
                )}
              >
                My Requests
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Requests Grid */}
      {loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardContent className="pt-6">
                <div className="animate-pulse space-y-4">
                  <div className="flex items-center gap-4">
                    <div className="h-10 w-10 rounded-full bg-muted" />
                    <div className="space-y-2 flex-1">
                      <div className="h-4 bg-muted rounded w-3/4" />
                      <div className="h-3 bg-muted rounded w-1/2" />
                    </div>
                  </div>
                  <div className="h-16 bg-muted rounded" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : requests.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2">
          {requests.map((request) => (
            <Link key={request.id} href={`/marketplace/${request.id}`}>
              <Card className="h-full hover:shadow-md transition-all cursor-pointer">
                <CardContent className="pt-6">
                  <div className="flex items-start gap-4 mb-4">
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={request.creator.avatarUrl || undefined} />
                      <AvatarFallback className="bg-primary text-primary-foreground">
                        {getInitials(request.creator.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        {getStatusBadge(request.status)}
                        {getUrgencyBadge(request.urgency)}
                        {request.isOwner && (
                          <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                            Your request
                          </span>
                        )}
                      </div>
                      <h3 className="font-semibold truncate">{request.title}</h3>
                      <p className="text-sm text-muted-foreground">
                        {request.creator.name}
                        {request.creator.jobTitle && ` · ${request.creator.jobTitle}`}
                      </p>
                    </div>
                  </div>

                  <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
                    {request.description}
                  </p>

                  {/* Theme/Domain needed */}
                  <div className="flex flex-wrap gap-2 mb-4">
                    {request.theme && (
                      <ThemeBadge
                        themeName={request.theme.name}
                        domainSlug={request.theme.domain as DomainSlug}
                        size="sm"
                      />
                    )}
                    {request.domainNeeded && !request.theme && (
                      <div className="flex items-center gap-1 text-xs bg-muted px-2 py-1 rounded">
                        <DomainIcon domain={request.domainNeeded as DomainSlug} size="sm" />
                        <span className="capitalize">{request.domainNeeded}</span>
                      </div>
                    )}
                  </div>

                  {/* Footer */}
                  <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t">
                    <div className="flex items-center gap-1">
                      <MessageCircle className="h-3 w-3" />
                      {request.responseCount} {request.responseCount === 1 ? "response" : "responses"}
                    </div>
                    <div className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {formatDate(request.createdAt)}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center py-8">
              <ShoppingBag className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold">No Requests Found</h3>
              <p className="text-sm text-muted-foreground mt-1 mb-4">
                {showMyRequests
                  ? "You haven't created any skill requests yet"
                  : "No one has requested help yet. Be the first!"}
              </p>
              <Button asChild>
                <Link href="/marketplace/create">
                  <Plus className="h-4 w-4 mr-2" />
                  Create Request
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* How it works */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">How the Marketplace Works</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid sm:grid-cols-3 gap-6">
            {[
              {
                step: 1,
                title: "Post a Request",
                description:
                  "Describe what skill or expertise you need. Tag specific strengths or domains for better matching.",
                icon: Plus,
              },
              {
                step: 2,
                title: "Get Responses",
                description:
                  "Team members with matching strengths can offer to help. Review their profiles and strengths.",
                icon: MessageCircle,
              },
              {
                step: 3,
                title: "Collaborate",
                description:
                  "Accept help and work together. Both parties earn points for successful collaboration.",
                icon: User,
              },
            ].map((item) => (
              <div key={item.step} className="text-center">
                <div className="flex items-center justify-center gap-2 mb-3">
                  <span className="h-6 w-6 rounded-full bg-domain-influencing text-white text-sm font-bold flex items-center justify-center">
                    {item.step}
                  </span>
                  <item.icon className="h-5 w-5 text-domain-influencing" />
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
