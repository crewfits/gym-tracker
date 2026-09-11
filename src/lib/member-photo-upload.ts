import { requireGym } from "@/lib/auth";
import { memberPhotoBucket, memberPhotoPath } from "@/lib/member-photo";
const allowedPhotoMimeTypes = new Set(["image/webp", "image/jpeg", "image/png"]);
const maxPhotoBytes = 512 * 1024;
export function decodePhotoDataUrl(dataUrl: string) {
  if (!dataUrl) return null;
  const match = /^data:(image\/(?:webp|jpeg|png));base64,([a-z0-9+/=]+)$/i.exec(dataUrl);
  if (!match) throw new Error("Photo must be a compressed WebP, JPEG, or PNG image");
  const [, contentType, base64] = match;
  if (!allowedPhotoMimeTypes.has(contentType)) throw new Error("Unsupported photo type");
  const binary = atob(base64);
  if (binary.length > maxPhotoBytes) throw new Error("Photo must be under 512 KB after compression");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return { blob: new Blob([bytes], { type: contentType }), contentType };
}

export async function saveMemberPhoto(supabase: Awaited<ReturnType<typeof requireGym>>["supabase"], gymId: string, memberId: string, dataUrl: string, existingPath?: string | null) {
  const decoded = decodePhotoDataUrl(dataUrl);
  if (!decoded) return existingPath ?? null;
  const nextPath = memberPhotoPath(gymId, memberId);
  const { error: uploadError } = await supabase.storage.from(memberPhotoBucket).upload(nextPath, decoded.blob, { contentType: decoded.contentType, upsert: true });
  if (uploadError) throw uploadError;
  if (existingPath && existingPath !== nextPath) await supabase.storage.from(memberPhotoBucket).remove([existingPath]);
  return nextPath;
}

