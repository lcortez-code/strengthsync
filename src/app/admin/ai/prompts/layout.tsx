import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth/config";
import { isPlatformAdmin } from "@/lib/auth/platform-admin";

export const dynamic = "force-dynamic";

export default async function AdminAIPromptsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/auth/login");
  if (!isPlatformAdmin(session.user.id)) redirect("/dashboard");
  return <DashboardLayout>{children}</DashboardLayout>;
}
