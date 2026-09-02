export const WORK_UPDATE_MIN_WORDS = 30;

export function countWorkUpdateWords(value: string) {
  return (
    value.match(
      /[\p{L}\p{N}]+(?:['’\-־][\p{L}\p{N}]+)*/gu,
    )?.length ?? 0
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function containsNamedMention(
  value: string,
  name: string,
) {
  const cleanName = name.trim();

  if (!cleanName) {
    return false;
  }

  const pattern = new RegExp(
    `(^|[\\s\\p{P}])@${escapeRegExp(cleanName)}(?=$|[\\s\\p{P}])`,
    "iu",
  );

  return pattern.test(value);
}