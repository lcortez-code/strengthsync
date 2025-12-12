"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";
import Link from "next/link";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Application error:", error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="max-w-md w-full">
        <CardContent className="pt-6">
          <div className="text-center">
            <AlertTriangle className="h-10 w-10 text-red-600 mx-auto mb-4" />
            <h1 className="text-2xl font-bold mb-2">Something went wrong</h1>
            <p className="text-muted-foreground mb-6">
              We encountered an unexpected error. Please try again or return to the dashboard.
            </p>
            {process.env.NODE_ENV === "development" && (
              <pre className="text-left text-xs bg-muted p-4 rounded-lg mb-6 overflow-auto max-h-32">
                {error.message}
              </pre>
            )}
            <div className="flex gap-2 justify-center">
              <Button onClick={reset}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Try Again
              </Button>
              <Button variant="outline" asChild>
                <Link href="/dashboard">
                  <Home className="h-4 w-4 mr-2" />
                  Dashboard
                </Link>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
