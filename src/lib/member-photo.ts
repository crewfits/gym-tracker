export const memberPhotoBucket = "member-photos";

export function memberPhotoPath(gymId: string, memberId: string) {
  return `${gymId}/${memberId}/profile`;
}

export async function signedMemberPhotoUrl(
  supabase: { storage: { from: (bucket: string) => { createSignedUrl: (path: string, expiresIn: number) => Promise<{ data: { signedUrl: string } | null; error: unknown }> } } },
  path: string | null | undefined,
) {
  if (!path) return null;
  const { data } = await supabase.storage.from(memberPhotoBucket).createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? null;
}

export async function signedMemberPhotoUrls(
  supabase: { storage: { from: (bucket: string) => { createSignedUrl: (path: string, expiresIn: number) => Promise<{ data: { signedUrl: string } | null; error: unknown }> } } },
  paths: Array<string | null | undefined>,
) {
  const entries = await Promise.all([...new Set(paths.filter(Boolean) as string[])].map(async (path) => [path, await signedMemberPhotoUrl(supabase, path)] as const));
  return new Map(entries);
}
