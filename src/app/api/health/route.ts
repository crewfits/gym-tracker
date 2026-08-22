import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  try {
    const { error } = await createAdminClient().from("gyms").select("id", { head: true, count: "exact" });
    if (error) throw error;
    return Response.json({ status: "ok", database: "reachable" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "degraded", database: "unreachable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
