"use client";

import { useState, useCallback } from "react";

interface UseAIGenerateOptions {
  endpoint: string;
  onSuccess?: (data: unknown) => void;
  onError?: (error: string) => void;
}

interface UseAIGenerateState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

interface UseAIGenerateReturn<T, P> {
  data: T | null;
  loading: boolean;
  error: string | null;
  generate: (payload: P) => Promise<T | null>;
  reset: () => void;
}

export function useAIGenerate<T = unknown, P = Record<string, unknown>>({
  endpoint,
  onSuccess,
  onError,
}: UseAIGenerateOptions): UseAIGenerateReturn<T, P> {
  const [state, setState] = useState<UseAIGenerateState<T>>({
    data: null,
    loading: false,
    error: null,
  });

  const generate = useCallback(
    async (payload: P): Promise<T | null> => {
      setState((prev) => ({ ...prev, loading: true, error: null }));

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
          const errorMessage = result.error?.message || "Failed to generate";
          throw new Error(errorMessage);
        }

        const data = result.data as T;
        setState({ data, loading: false, error: null });
        onSuccess?.(data);
        return data;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "An error occurred";
        setState({ data: null, loading: false, error: errorMessage });
        onError?.(errorMessage);
        return null;
      }
    },
    [endpoint, onSuccess, onError]
  );

  const reset = useCallback(() => {
    setState({ data: null, loading: false, error: null });
  }, []);

  return {
    data: state.data,
    loading: state.loading,
    error: state.error,
    generate,
    reset,
  };
}

// Specialized hook for text generation
export function useAITextGenerate(endpoint: string) {
  return useAIGenerate<{ text: string }, Record<string, unknown>>({ endpoint });
}

// Specialized hook for structured data generation
export function useAIStructuredGenerate<T>(endpoint: string) {
  return useAIGenerate<T, Record<string, unknown>>({ endpoint });
}
