import { DashboardLayout } from "@/components/layout/DashboardLayout";

export default function AdminAIPromptsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DashboardLayout>{children}</DashboardLayout>;
}
