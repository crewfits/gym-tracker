import { AppShell } from "@/components/app-shell";import { requireGym } from "@/lib/auth";
export default async function DashboardLayout({children}:{children:React.ReactNode}){const {gym}=await requireGym();return <AppShell gymName={gym.name}>{children}</AppShell>}
