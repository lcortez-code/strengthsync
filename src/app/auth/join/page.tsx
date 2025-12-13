"use client";

import { Suspense, useState, useEffect } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import {
  Mail,
  Lock,
  User,
  Users,
  AlertCircle,
  CheckCircle2,
  ArrowLeft,
  Building2,
  Loader2,
} from "lucide-react";
import { Logo } from "@/components/brand/Logo";

interface OrganizationInfo {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  logoUrl: string | null;
  memberCount: number;
}

type JoinStep = "code" | "register" | "login";

function JoinOrganizationForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialCode = searchParams.get("code") || "";

  const [step, setStep] = useState<JoinStep>("code");
  const [inviteCode, setInviteCode] = useState(initialCode);
  const [orgInfo, setOrgInfo] = useState<OrganizationInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Register form
  const [registerData, setRegisterData] = useState({
    fullName: "",
    email: "",
    password: "",
    confirmPassword: "",
  });

  // Login form
  const [loginData, setLoginData] = useState({
    email: "",
    password: "",
  });

  const passwordRequirements = [
    { label: "At least 8 characters", met: registerData.password.length >= 8 },
    { label: "Contains a number", met: /\d/.test(registerData.password) },
    { label: "Contains a letter", met: /[a-zA-Z]/.test(registerData.password) },
  ];

  // Auto-validate if code provided in URL
  useEffect(() => {
    if (initialCode) {
      handleValidateCode();
    }
  }, []);

  const handleValidateCode = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inviteCode.trim()) {
      setError("Please enter an invite code");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/auth/join?code=${encodeURIComponent(inviteCode)}`);
      const data = await res.json();

      if (!res.ok) {
        setError(data.error?.message || "Invalid invite code");
        setIsLoading(false);
        return;
      }

      setOrgInfo(data.data);
      setStep("register");
    } catch (err) {
      setError("Failed to validate invite code");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    if (registerData.password !== registerData.confirmPassword) {
      setError("Passwords do not match");
      setIsLoading(false);
      return;
    }

    if (!passwordRequirements.every((req) => req.met)) {
      setError("Password does not meet requirements");
      setIsLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/auth/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inviteCode,
          email: registerData.email,
          password: registerData.password,
          fullName: registerData.fullName,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.error?.message?.includes("already exists")) {
          setError("An account with this email exists. Please login instead.");
          setLoginData((prev) => ({ ...prev, email: registerData.email }));
          setStep("login");
        } else {
          setError(data.error?.message || "Failed to create account");
        }
        setIsLoading(false);
        return;
      }

      // Auto sign in
      const result = await signIn("credentials", {
        email: registerData.email,
        password: registerData.password,
        redirect: false,
      });

      if (result?.error) {
        router.push("/auth/login?joined=true");
        return;
      }

      router.push("/dashboard?welcome=true");
      router.refresh();
    } catch (err) {
      setError("An unexpected error occurred");
      setIsLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const result = await signIn("credentials", {
        email: loginData.email,
        password: loginData.password,
        redirect: false,
      });

      if (result?.error) {
        setError("Invalid email or password");
        setIsLoading(false);
        return;
      }

      // After login, join the organization
      const joinRes = await fetch("/api/organizations/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode }),
      });

      if (!joinRes.ok) {
        const data = await joinRes.json();
        if (data.error?.message?.includes("already a member")) {
          // Already a member, just redirect
          router.push("/dashboard");
          router.refresh();
          return;
        }
      }

      router.push("/dashboard?welcome=true");
      router.refresh();
    } catch (err) {
      setError("An unexpected error occurred");
      setIsLoading(false);
    }
  };

  const handleRegisterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRegisterData((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
  };

  const handleLoginChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLoginData((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 mesh-gradient">
      {/* Floating orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="floating-orb w-[400px] h-[400px] -top-24 -right-24 bg-domain-relationship opacity-30" />
        <div className="floating-orb w-[300px] h-[300px] top-1/3 -left-20 bg-domain-influencing opacity-30" style={{ animationDelay: "2s" }} />
        <div className="floating-orb w-[350px] h-[350px] -bottom-24 right-1/4 bg-domain-strategic opacity-30" style={{ animationDelay: "4s" }} />
      </div>

      <div className="relative w-full max-w-md">
        {/* Logo */}
        <div className="flex items-center justify-center mb-8">
          <Logo size="lg" showText />
        </div>

        <Card className="shadow-soft-lg dark:shadow-soft-lg-dark">
          {/* Step 1: Enter Invite Code */}
          {step === "code" && (
            <>
              <CardHeader className="text-center">
                <CardTitle className="text-2xl">Join an Organization</CardTitle>
                <CardDescription>
                  Enter the invite code shared by your team
                </CardDescription>
              </CardHeader>

              <CardContent>
                <form onSubmit={handleValidateCode} className="space-y-4">
                  {error && (
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                      <AlertCircle className="h-4 w-4 flex-shrink-0" />
                      <span>{error}</span>
                    </div>
                  )}

                  <div className="space-y-2">
                    <label htmlFor="inviteCode" className="text-sm font-medium">
                      Invite Code
                    </label>
                    <Input
                      id="inviteCode"
                      type="text"
                      placeholder="Enter 8-character code"
                      value={inviteCode}
                      onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                      icon={<Users className="h-4 w-4" />}
                      className="text-center font-mono text-lg tracking-widest uppercase"
                      maxLength={8}
                      required
                    />
                  </div>

                  <Button type="submit" className="w-full" size="lg" isLoading={isLoading}>
                    Continue
                  </Button>
                </form>

                <div className="mt-6 text-center text-sm">
                  <span className="text-muted-foreground">Don&apos;t have a code? </span>
                  <Link href="/auth/register" className="text-primary font-medium hover:underline">
                    Create your account
                  </Link>
                </div>
              </CardContent>
            </>
          )}

          {/* Step 2: Register or Login */}
          {step === "register" && orgInfo && (
            <>
              <CardHeader className="text-center">
                <div className="flex justify-center mb-4">
                  <Building2 className="h-10 w-10 text-domain-relationship" />
                </div>
                <CardTitle className="text-2xl">Join {orgInfo.organizationName}</CardTitle>
                <CardDescription>
                  {orgInfo.memberCount} team member{orgInfo.memberCount !== 1 ? "s" : ""} already here
                </CardDescription>
              </CardHeader>

              <CardContent>
                <form onSubmit={handleRegister} className="space-y-4">
                  {error && (
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                      <AlertCircle className="h-4 w-4 flex-shrink-0" />
                      <span>{error}</span>
                    </div>
                  )}

                  <div className="space-y-2">
                    <label htmlFor="fullName" className="text-sm font-medium">
                      Your Name
                    </label>
                    <Input
                      id="fullName"
                      name="fullName"
                      type="text"
                      placeholder="Jane Smith"
                      value={registerData.fullName}
                      onChange={handleRegisterChange}
                      icon={<User className="h-4 w-4" />}
                      required
                      autoComplete="name"
                    />
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="email" className="text-sm font-medium">
                      Email
                    </label>
                    <Input
                      id="email"
                      name="email"
                      type="email"
                      placeholder="you@company.com"
                      value={registerData.email}
                      onChange={handleRegisterChange}
                      icon={<Mail className="h-4 w-4" />}
                      required
                      autoComplete="email"
                    />
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="password" className="text-sm font-medium">
                      Password
                    </label>
                    <Input
                      id="password"
                      name="password"
                      type="password"
                      placeholder="Create a password"
                      value={registerData.password}
                      onChange={handleRegisterChange}
                      icon={<Lock className="h-4 w-4" />}
                      required
                      autoComplete="new-password"
                    />
                    {registerData.password && (
                      <div className="space-y-1 mt-2">
                        {passwordRequirements.map((req) => (
                          <div
                            key={req.label}
                            className={`flex items-center gap-2 text-xs ${
                              req.met ? "text-domain-strategic" : "text-muted-foreground"
                            }`}
                          >
                            <CheckCircle2 className={`h-3 w-3 ${req.met ? "opacity-100" : "opacity-30"}`} />
                            <span>{req.label}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="confirmPassword" className="text-sm font-medium">
                      Confirm Password
                    </label>
                    <Input
                      id="confirmPassword"
                      name="confirmPassword"
                      type="password"
                      placeholder="Confirm your password"
                      value={registerData.confirmPassword}
                      onChange={handleRegisterChange}
                      icon={<Lock className="h-4 w-4" />}
                      required
                      autoComplete="new-password"
                      error={
                        registerData.confirmPassword !== "" &&
                        registerData.password !== registerData.confirmPassword
                      }
                    />
                  </div>

                  <Button type="submit" className="w-full" size="lg" isLoading={isLoading}>
                    Create Account & Join
                  </Button>
                </form>

                <div className="mt-6 text-center text-sm">
                  <span className="text-muted-foreground">Already have an account? </span>
                  <button
                    onClick={() => setStep("login")}
                    className="text-primary font-medium hover:underline"
                  >
                    Sign in to join
                  </button>
                </div>

                <button
                  onClick={() => {
                    setStep("code");
                    setOrgInfo(null);
                    setError(null);
                  }}
                  className="mt-4 flex items-center justify-center gap-1 text-sm text-muted-foreground hover:text-foreground w-full"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Use a different code
                </button>
              </CardContent>
            </>
          )}

          {/* Step 3: Login to join */}
          {step === "login" && orgInfo && (
            <>
              <CardHeader className="text-center">
                <div className="flex justify-center mb-4">
                  <Building2 className="h-10 w-10 text-domain-relationship" />
                </div>
                <CardTitle className="text-2xl">Sign in to Join</CardTitle>
                <CardDescription>
                  Login with your existing account to join {orgInfo.organizationName}
                </CardDescription>
              </CardHeader>

              <CardContent>
                <form onSubmit={handleLogin} className="space-y-4">
                  {error && (
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                      <AlertCircle className="h-4 w-4 flex-shrink-0" />
                      <span>{error}</span>
                    </div>
                  )}

                  <div className="space-y-2">
                    <label htmlFor="loginEmail" className="text-sm font-medium">
                      Email
                    </label>
                    <Input
                      id="loginEmail"
                      name="email"
                      type="email"
                      placeholder="you@company.com"
                      value={loginData.email}
                      onChange={handleLoginChange}
                      icon={<Mail className="h-4 w-4" />}
                      required
                      autoComplete="email"
                    />
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="loginPassword" className="text-sm font-medium">
                      Password
                    </label>
                    <Input
                      id="loginPassword"
                      name="password"
                      type="password"
                      placeholder="Your password"
                      value={loginData.password}
                      onChange={handleLoginChange}
                      icon={<Lock className="h-4 w-4" />}
                      required
                      autoComplete="current-password"
                    />
                  </div>

                  <Button type="submit" className="w-full" size="lg" isLoading={isLoading}>
                    Sign In & Join
                  </Button>
                </form>

                <div className="mt-6 text-center text-sm">
                  <span className="text-muted-foreground">Need an account? </span>
                  <button
                    onClick={() => setStep("register")}
                    className="text-primary font-medium hover:underline"
                  >
                    Create one
                  </button>
                </div>

                <button
                  onClick={() => {
                    setStep("code");
                    setOrgInfo(null);
                    setError(null);
                  }}
                  className="mt-4 flex items-center justify-center gap-1 text-sm text-muted-foreground hover:text-foreground w-full"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Use a different code
                </button>
              </CardContent>
            </>
          )}
        </Card>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          By joining, you agree to our Terms of Service and Privacy Policy.
        </p>
      </div>
    </div>
  );
}

function JoinFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 mesh-gradient">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="floating-orb w-[400px] h-[400px] -top-24 -right-24 bg-domain-relationship opacity-30" />
        <div className="floating-orb w-[300px] h-[300px] top-1/3 -left-20 bg-domain-influencing opacity-30" style={{ animationDelay: "2s" }} />
        <div className="floating-orb w-[350px] h-[350px] -bottom-24 right-1/4 bg-domain-strategic opacity-30" style={{ animationDelay: "4s" }} />
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

export default function JoinOrganizationPage() {
  return (
    <Suspense fallback={<JoinFallback />}>
      <JoinOrganizationForm />
    </Suspense>
  );
}
