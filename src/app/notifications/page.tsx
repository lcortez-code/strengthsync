"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import {
  Bell,
  Award,
  MessageSquare,
  Handshake,
  Trophy,
  UserPlus,
  AlertCircle,
  Check,
  CheckCheck,
  Trash2,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  link: string | null;
  read: boolean;
  readAt: string | null;
  createdAt: string;
}

const NOTIFICATION_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  SHOUTOUT_RECEIVED: Award,
  SKILL_REQUEST_RESPONSE: MessageSquare,
  MENTORSHIP_REQUEST: Handshake,
  BADGE_EARNED: Trophy,
  CHALLENGE_INVITE: Trophy,
  NEW_MEMBER: UserPlus,
  SYSTEM: AlertCircle,
};

const NOTIFICATION_COLORS: Record<string, string> = {
  SHOUTOUT_RECEIVED: "bg-domain-influencing/10 text-domain-influencing",
  SKILL_REQUEST_RESPONSE: "bg-domain-strategic/10 text-domain-strategic",
  MENTORSHIP_REQUEST: "bg-domain-relationship/10 text-domain-relationship",
  BADGE_EARNED: "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400",
  CHALLENGE_INVITE: "bg-domain-executing/10 text-domain-executing",
  NEW_MEMBER: "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400",
  SYSTEM: "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400",
};

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [markingAll, setMarkingAll] = useState(false);

  useEffect(() => {
    fetchNotifications();
  }, [filter, page]);

  const fetchNotifications = async (reset = false) => {
    if (reset) {
      setPage(1);
    }
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter === "unread") {
        params.append("unread", "true");
      }
      params.append("page", reset ? "1" : String(page));
      params.append("limit", "20");

      const res = await fetch(`/api/notifications?${params}`);
      if (res.ok) {
        const result = await res.json();
        const responseData = result.data;
        if (reset || page === 1) {
          setNotifications(responseData?.data || []);
        } else {
          setNotifications((prev) => [...prev, ...(responseData?.data || [])]);
        }
        setHasMore(responseData?.pagination?.hasMore || false);
        setUnreadCount(responseData?.meta?.unreadCount || 0);
      }
    } catch (err) {
      console.error("Failed to fetch notifications:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleMarkAsRead = async (notificationId: string) => {
    try {
      const res = await fetch(`/api/notifications/${notificationId}`, {
        method: "PATCH",
      });

      if (res.ok) {
        setNotifications((prev) =>
          prev.map((n) =>
            n.id === notificationId ? { ...n, read: true } : n
          )
        );
        setUnreadCount((prev) => Math.max(0, prev - 1));
      }
    } catch (err) {
      console.error("Failed to mark notification as read:", err);
    }
  };

  const handleMarkAllAsRead = async () => {
    setMarkingAll(true);
    try {
      const res = await fetch("/api/notifications", {
        method: "PATCH",
      });

      if (res.ok) {
        setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
        setUnreadCount(0);
      }
    } catch (err) {
      console.error("Failed to mark all as read:", err);
    } finally {
      setMarkingAll(false);
    }
  };

  const handleDelete = async (notificationId: string) => {
    try {
      const res = await fetch(`/api/notifications/${notificationId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        const notification = notifications.find((n) => n.id === notificationId);
        setNotifications((prev) => prev.filter((n) => n.id !== notificationId));
        if (notification && !notification.read) {
          setUnreadCount((prev) => Math.max(0, prev - 1));
        }
      }
    } catch (err) {
      console.error("Failed to delete notification:", err);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffHours < 1) return "Just now";
    if (diffHours < 24) return `${diffHours} hours ago`;
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
    });
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold flex items-center gap-2">
            <Bell className="h-8 w-8 text-primary" />
            Notifications
          </h1>
          <p className="text-muted-foreground mt-1">
            {unreadCount > 0
              ? `You have ${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}`
              : "You're all caught up!"}
          </p>
        </div>
        <div className="flex gap-2">
          {unreadCount > 0 && (
            <Button
              variant="outline"
              onClick={handleMarkAllAsRead}
              disabled={markingAll}
            >
              {markingAll ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <CheckCheck className="h-4 w-4 mr-2" />
              )}
              Mark all read
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => fetchNotifications(true)}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        <button
          onClick={() => {
            setFilter("all");
            setPage(1);
          }}
          className={cn(
            "px-4 py-2 text-sm font-medium rounded-lg transition-colors",
            filter === "all"
              ? "bg-primary text-primary-foreground"
              : "bg-muted hover:bg-muted/80"
          )}
        >
          All
        </button>
        <button
          onClick={() => {
            setFilter("unread");
            setPage(1);
          }}
          className={cn(
            "px-4 py-2 text-sm font-medium rounded-lg transition-colors",
            filter === "unread"
              ? "bg-primary text-primary-foreground"
              : "bg-muted hover:bg-muted/80"
          )}
        >
          Unread {unreadCount > 0 && `(${unreadCount})`}
        </button>
      </div>

      {/* Notifications List */}
      {loading && notifications.length === 0 ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="py-4">
                <div className="animate-pulse flex gap-4">
                  <div className="h-10 w-10 rounded-full bg-muted" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-muted rounded w-3/4" />
                    <div className="h-3 bg-muted rounded w-1/2" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : notifications.length > 0 ? (
        <div className="space-y-2">
          {notifications.map((notification) => {
            const Icon = NOTIFICATION_ICONS[notification.type] || Bell;
            const colorClass = NOTIFICATION_COLORS[notification.type] || "bg-gray-100 text-gray-600";

            return (
              <Card
                key={notification.id}
                className={cn(
                  "transition-colors",
                  !notification.read && "bg-primary/5 border-primary/20"
                )}
              >
                <CardContent className="py-4">
                  <div className="flex gap-4">
                    <div
                      className={cn(
                        "flex-shrink-0 h-10 w-10 rounded-full flex items-center justify-center",
                        colorClass
                      )}
                    >
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          {notification.link ? (
                            <Link
                              href={notification.link}
                              onClick={() => {
                                if (!notification.read) {
                                  handleMarkAsRead(notification.id);
                                }
                              }}
                              className="font-semibold hover:text-primary transition-colors"
                            >
                              {notification.title}
                            </Link>
                          ) : (
                            <span className="font-semibold">{notification.title}</span>
                          )}
                          <p className="text-sm text-muted-foreground mt-0.5">
                            {notification.message}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {formatDate(notification.createdAt)}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          {!notification.read && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleMarkAsRead(notification.id)}
                              title="Mark as read"
                            >
                              <Check className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(notification.id)}
                            title="Delete"
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                    {!notification.read && (
                      <div className="flex-shrink-0 w-2 h-2 bg-primary rounded-full mt-2" />
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}

          {/* Load More */}
          {hasMore && (
            <div className="text-center pt-4">
              <Button
                variant="outline"
                onClick={() => setPage((p) => p + 1)}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Loading...
                  </>
                ) : (
                  "Load more"
                )}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <Bell className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold">No Notifications</h3>
            <p className="text-sm text-muted-foreground mt-1">
              {filter === "unread"
                ? "You've read all your notifications"
                : "You don't have any notifications yet"}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
