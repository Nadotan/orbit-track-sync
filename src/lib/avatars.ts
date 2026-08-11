import { supabase } from "@/integrations/supabase/client";

/*
 * Avatars live in a private storage bucket, so profiles store the
 * object path (e.g. "<user-id>/avatar-123.jpg") and the client
 * resolves a short-lived signed URL for display.
 */
export const AVATAR_BUCKET = "avatars";

const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7;

/*
 * Legacy rows stored public-object URLs for what is actually a
 * private bucket; those 400 in the browser, so convert them back
 * into object paths that can be signed.
 */
function toObjectPath(value: string): string {
  const marker = `/storage/v1/object/public/${AVATAR_BUCKET}/`;
  const index = value.indexOf(marker);
  return index === -1
    ? value
    : value.slice(index + marker.length);
}

export function isRemoteUrl(value: string | null | undefined) {
  return Boolean(
    value &&
      /^https?:\/\//i.test(value) &&
      toObjectPath(value) === value,
  );
}

export async function signAvatarPath(
  path: string | null | undefined,
): Promise<string | null> {
  if (!path) return null;
  if (isRemoteUrl(path)) return path;

  const { data, error } = await supabase.storage
    .from(AVATAR_BUCKET)
    .createSignedUrl(toObjectPath(path), SIGNED_URL_TTL_SECONDS);

  if (error) return null;
  return data?.signedUrl ?? null;
}

export async function signAvatarPaths(
  paths: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const originals = paths.filter(
    (p): p is string => Boolean(p) && !isRemoteUrl(p),
  );

  const unique = Array.from(
    new Set(originals.map(toObjectPath)),
  );

  const map = new Map<string, string>();
  if (unique.length === 0) return map;

  const { data, error } = await supabase.storage
    .from(AVATAR_BUCKET)
    .createSignedUrls(unique, SIGNED_URL_TTL_SECONDS);

  if (error || !data) return map;

  const byPath = new Map<string, string>();
  for (const item of data) {
    if (item.signedUrl && item.path) {
      byPath.set(item.path, item.signedUrl);
    }
  }

  for (const original of originals) {
    const signed = byPath.get(toObjectPath(original));
    if (signed) map.set(original, signed);
  }

  return map;
}
