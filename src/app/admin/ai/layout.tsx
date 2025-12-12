import { DashboardLayout } from "@/components/layout/DashboardLayout";

export default function AdminAILayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DashboardLayout>{children}</DashboardLayout>;
}
