"use client";

import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  XCircle,
  FileText,
  Plus,
} from "lucide-react";
import type { ImportRowResult, BulkImportResponse } from "@/lib/validation/bulk-import";

interface ImportResultsProps {
  response: BulkImportResponse;
  onReset: () => void;
}

export function ImportResults({ response, onReset }: ImportResultsProps) {
  const successCount = response.successful;
  const failCount = response.failed;
  const newUsers = response.results.filter((r) => r.success && r.data?.isNewUser).length;
  const withStrengths = response.results.filter((r) => r.success && r.data?.strengthsImported).length;

  return (
    <div className="space-y-6">
      {/* Summary Card */}
      <Card className={cn(failCount === 0 ? "border-green-500/50" : "border-amber-500/50")}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            {failCount === 0 ? (
              <>
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                Import Completed Successfully
              </>
            ) : (
              <>
                <XCircle className="h-5 w-5 text-amber-500" />
                Import Completed with Issues
              </>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center p-3 rounded-lg bg-muted/50">
              <p className="text-2xl font-bold text-green-600">{successCount}</p>
              <p className="text-sm text-muted-foreground">Imported</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-muted/50">
              <p className="text-2xl font-bold text-red-600">{failCount}</p>
              <p className="text-sm text-muted-foreground">Failed</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-muted/50">
              <p className="text-2xl font-bold text-domain-executing">{newUsers}</p>
              <p className="text-sm text-muted-foreground">New Users</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-muted/50">
              <p className="text-2xl font-bold text-domain-strategic">{withStrengths}</p>
              <p className="text-sm text-muted-foreground">With Strengths</p>
            </div>
          </div>

          <p className="mt-4 text-sm text-muted-foreground">Invited members verify their email and choose their own password before joining.</p>
        </CardContent>
      </Card>

      {/* Results List */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground">Import Details</h3>
        <div className="space-y-2">
          {response.results.map((result, index) => (
            <ResultRow
              key={index}
              result={result}
            />
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <Button variant="outline" onClick={onReset}>
          <Plus className="h-4 w-4 mr-2" />
          Import More Members
        </Button>
      </div>
    </div>
  );
}

interface ResultRowProps {
  result: ImportRowResult;
}

function ResultRow({ result }: ResultRowProps) {
  if (result.success) {
    return (
      <div className="flex items-center gap-3 p-3 border border-border rounded-lg bg-green-500/5">
        <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="font-medium truncate">{result.email}</p>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Invitation pending</span>
            {result.data?.strengthsImported && (
              <span className="flex items-center gap-1 text-domain-executing">
                <FileText className="h-3 w-3" />
                {result.data.themesFound} themes
              </span>
            )}
          </div>
          {result.data?.message && <p className="text-sm text-muted-foreground">{result.data.message}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 p-3 border border-destructive/50 rounded-lg bg-destructive/5">
      <XCircle className="h-5 w-5 text-destructive flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">{result.email}</p>
        <p className="text-sm text-destructive">{result.error}</p>
      </div>
    </div>
  );
}
