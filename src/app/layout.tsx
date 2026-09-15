import type { Metadata, Viewport } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { SessionProvider } from "@/components/providers/SessionProvider";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { BadgeCelebrationProvider } from "@/components/providers/BadgeCelebrationProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "StrengthSync | Team Strengths & Collaboration",
    template: "%s | StrengthSync",
  },
  description:
    "Discover your team's unique strengths with CliftonStrengths. Connect, collaborate, and grow together through insights, recognition, and playful engagement.",
  keywords: [
    "CliftonStrengths",
    "team strengths",
    "team collaboration",
    "strengths finder",
    "team analytics",
    "peer recognition",
  ],
  authors: [{ name: "StrengthSync" }],
  creator: "StrengthSync",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://strengthsync.app",
    title: "StrengthSync | Team Strengths & Collaboration",
    description:
      "Discover your team's unique strengths with CliftonStrengths. Connect, collaborate, and grow together.",
    siteName: "StrengthSync",
  },
  twitter: {
    card: "summary_large_image",
    title: "StrengthSync | Team Strengths & Collaboration",
    description:
      "Discover your team's unique strengths with CliftonStrengths. Connect, collaborate, and grow together.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FAFAF8" },
    { media: "(prefers-color-scheme: dark)", color: "#1A1D24" },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getServerSession(authOptions);

  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background antialiased">
        <SessionProvider session={session}>
          <ThemeProvider defaultTheme="light" storageKey="strengthsync-theme">
            <BadgeCelebrationProvider>
              {children}
            </BadgeCelebrationProvider>
          </ThemeProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
