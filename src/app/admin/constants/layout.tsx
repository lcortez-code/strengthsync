import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { isPlatformAdmin } from "@/lib/auth/platform-admin";

export default async function AdminConstantsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/auth/login");
  }

  // Check admin role
  if (!isPlatformAdmin(session.user.id)) {
    redirect("/dashboard");
  }

  return <DashboardLayout>{children}</DashboardLayout>;
}
