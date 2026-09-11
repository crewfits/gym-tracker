import { AppShell } from "@/components/app-shell";import { requireGym } from "@/lib/auth";
export default async function DashboardLayout({children}:{children:React.ReactNode}){const {gym,viewer}=await requireGym();return <AppShell gymName={gym.name} viewer={viewer}>{children}</AppShell>}
