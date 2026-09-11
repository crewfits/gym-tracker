import { redirect } from "next/navigation";

export default async function Renew({ params, searchParams }: PageProps<"/members/[id]/renew">) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const next = new URLSearchParams({ view: "membership" });
  if (typeof query.error === "string") next.set("error", query.error);
  redirect(`/members/${id}?${next}`);
}
