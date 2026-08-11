import { supabase } from "@/integrations/supabase/client";

/*
 * Avatars live in a private storage bucket, so profiles store the
 * object path (e.g. "<user-id>/avatar-123.jpg") and the client
 * resolves a short-lived signed URL for display.
 */
export const AVATAR_BUCKET = "avatars";

const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7;

export function isRemoteUrl(value: string | null | undefined) {
  return Boolean(value && /^https?:\/\//i.test(value));
}

export async function signAvatarPath(
  path: string | null | undefined,
): Promise<string | null> {
  if (!path) return null;
  if (isRemoteUrl(path)) return path;

  const { data, error } = await supabase.storage
    .from(AVATAR_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);

  if (error) return null;
  return data?.signedUrl ?? null;
}

export async function signAvatarPaths(
  paths: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const unique = Array.from(
    new Set(
      paths.filter(
        (p): p is string => Boolean(p) && !isRemoteUrl(p),
      ),
    ),
  );

  const map = new Map<string, string>();
  if (unique.length === 0) return map;

  const { data, error } = await supabase.storage
    .from(AVATAR_BUCKET)
    .createSignedUrls(unique, SIGNED_URL_TTL_SECONDS);

  if (error || !data) return map;

  for (const item of data) {
    if (item.signedUrl && item.path) {
      map.set(item.path, item.signedUrl);
    }
  }

  return map;
}
