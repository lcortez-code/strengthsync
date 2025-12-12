"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Sparkles, Mail, Lock, User, Building2, AlertCircle, CheckCircle2 } from "lucide-react";

export default function RegisterPage() {
  const router = useRouter();

  const [formData, setFormData] = useState({
    fullName: "",
    email: "",
    password: "",
    confirmPassword: "",
    organizationName: "ISG",
  });

  const ORGANIZATIONS = [
    { value: "ISG", label: "ISG" },
  ];
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const passwordRequirements = [
    { label: "At least 8 characters", met: formData.password.length >= 8 },
    { label: "Contains a number", met: /\d/.test(formData.password) },
    { label: "Contains a letter", met: /[a-zA-Z]/.test(formData.password) },
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    // Validate passwords match
    if (formData.password !== formData.confirmPassword) {
      setError("Passwords do not match");
      setIsLoading(false);
      return;
    }

    // Validate password requirements
    if (!passwordRequirements.every((req) => req.met)) {
      setError("Password does not meet requirements");
      setIsLoading(false);
      return;
    }

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: formData.email,
          password: formData.password,
          fullName: formData.fullName,
          organizationName: formData.organizationName,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error?.message || "Failed to create account");
        setIsLoading(false);
        return;
      }

      // Sign in automatically after registration
      const result = await signIn("credentials", {
        email: formData.email,
        password: formData.password,
        redirect: false,
      });

      if (result?.error) {
        // Registration succeeded but sign in failed - redirect to login
        router.push("/auth/login?registered=true");
        return;
      }

      router.push("/dashboard?welcome=true");
      router.refresh();
    } catch (err) {
      setError("An unexpected error occurred");
      setIsLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 mesh-gradient">
      {/* Floating orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="floating-orb w-[400px] h-[400px] -top-24 -right-24 bg-domain-strategic opacity-30" />
        <div className="floating-orb w-[300px] h-[300px] top-1/3 -left-20 bg-domain-relationship opacity-30" style={{ animationDelay: "2s" }} />
        <div className="floating-orb w-[350px] h-[350px] -bottom-24 right-1/4 bg-domain-executing opacity-30" style={{ animationDelay: "4s" }} />
      </div>

      <div className="relative w-full max-w-md">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <Sparkles className="h-8 w-8 text-primary" />
          <span className="font-display font-bold text-2xl">StrengthSync</span>
        </div>

        <Card className="shadow-soft-lg dark:shadow-soft-lg-dark">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Create your account</CardTitle>
            <CardDescription>Start your team&apos;s strengths journey</CardDescription>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
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
                  value={formData.fullName}
                  onChange={handleChange}
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
                  value={formData.email}
                  onChange={handleChange}
                  icon={<Mail className="h-4 w-4" />}
                  required
                  autoComplete="email"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="organizationName" className="text-sm font-medium">
                  Organization
                </label>
                <div className="relative">
                  <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    <Building2 className="h-4 w-4" />
                  </div>
                  <select
                    id="organizationName"
                    name="organizationName"
                    value={formData.organizationName}
                    onChange={handleChange}
                    className="flex w-full h-11 rounded-xl border border-input bg-background text-foreground pl-10 pr-10 py-2 text-sm transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 appearance-none cursor-pointer"
                    required
                  >
                    {ORGANIZATIONS.map((org) => (
                      <option key={org.value} value={org.value}>
                        {org.label}
                      </option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
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
                  value={formData.password}
                  onChange={handleChange}
                  icon={<Lock className="h-4 w-4" />}
                  required
                  autoComplete="new-password"
                />
                {formData.password && (
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
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  icon={<Lock className="h-4 w-4" />}
                  required
                  autoComplete="new-password"
                  error={
                    formData.confirmPassword !== "" &&
                    formData.password !== formData.confirmPassword
                  }
                />
              </div>

              <Button type="submit" className="w-full" size="lg" isLoading={isLoading}>
                Create Account
              </Button>
            </form>

            <div className="mt-6 text-center text-sm">
              <span className="text-muted-foreground">Already have an account? </span>
              <Link href="/auth/login" className="text-primary font-medium hover:underline">
                Sign in
              </Link>
            </div>

            <div className="mt-4 text-center">
              <Link
                href="/auth/join"
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Have an invite code? Join an existing organization
              </Link>
            </div>
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          By creating an account, you agree to our Terms of Service and Privacy Policy.
        </p>
      </div>
    </div>
  );
}
