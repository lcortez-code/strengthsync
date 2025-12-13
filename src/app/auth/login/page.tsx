"use client";

import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Mail, Lock, AlertCircle, Loader2 } from "lucide-react";
import { Logo } from "@/components/brand/Logo";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";
  const error = searchParams.get("error");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(
    error === "CredentialsSignin" ? "Invalid email or password" : null
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setLoginError(null);

    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        setLoginError("Invalid email or password");
        setIsLoading(false);
        return;
      }

      router.push(callbackUrl);
      router.refresh();
    } catch (err) {
      setLoginError("An unexpected error occurred");
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 mesh-gradient">
      {/* Floating orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="floating-orb w-[400px] h-[400px] -top-24 -left-24 bg-domain-executing opacity-30" />
        <div className="floating-orb w-[300px] h-[300px] top-1/2 -right-20 bg-domain-influencing opacity-30" style={{ animationDelay: "2s" }} />
        <div className="floating-orb w-[350px] h-[350px] -bottom-24 left-1/4 bg-domain-strategic opacity-30" style={{ animationDelay: "4s" }} />
      </div>

      <div className="relative w-full max-w-md">
        {/* Logo */}
        <div className="flex items-center justify-center mb-8">
          <Logo size="lg" showText />
        </div>

        <Card className="shadow-soft-lg dark:shadow-soft-lg-dark">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Welcome back</CardTitle>
            <CardDescription>Sign in to your account to continue</CardDescription>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {loginError && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                  <AlertCircle className="h-4 w-4 flex-shrink-0" />
                  <span>{loginError}</span>
                </div>
              )}

              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-medium">
                  Email
                </label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  icon={<Mail className="h-4 w-4" />}
                  required
                  autoComplete="email"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label htmlFor="password" className="text-sm font-medium">
                    Password
                  </label>
                  <Link
                    href="/auth/forgot-password"
                    className="text-sm text-primary hover:underline"
                  >
                    Forgot password?
                  </Link>
                </div>
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  icon={<Lock className="h-4 w-4" />}
                  required
                  autoComplete="current-password"
                />
              </div>

              <Button type="submit" className="w-full" size="lg" isLoading={isLoading}>
                Sign in
              </Button>
            </form>

            <div className="mt-6 text-center text-sm">
              <span className="text-muted-foreground">Don&apos;t have an account? </span>
              <Link href="/auth/register" className="text-primary font-medium hover:underline">
                Create one
              </Link>
            </div>

            <div className="mt-4 text-center">
              <Link
                href="/auth/join"
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Have an invite code? Join an organization
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function LoginFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 mesh-gradient">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="floating-orb w-[400px] h-[400px] -top-24 -left-24 bg-domain-executing opacity-30" />
        <div className="floating-orb w-[300px] h-[300px] top-1/2 -right-20 bg-domain-influencing opacity-30" style={{ animationDelay: "2s" }} />
        <div className="floating-orb w-[350px] h-[350px] -bottom-24 left-1/4 bg-domain-strategic opacity-30" style={{ animationDelay: "4s" }} />
      </div>
      <div className="relative w-full max-w-md">
        <div className="flex items-center justify-center mb-8">
          <Logo size="lg" showText />
        </div>
        <Card className="shadow-soft-lg dark:shadow-soft-lg-dark">
          <CardContent className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginForm />
    </Suspense>
  );
}
