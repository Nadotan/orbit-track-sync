type RecipientRow = { user_id: string; task_id?: string | null; kind?: string };
type RecipientQuery = PromiseLike<{ data: RecipientRow[] | null; error: { message: string } | null }> & {
  select: (columns: string) => RecipientQuery;
  in: (column: string, values: string[]) => RecipientQuery;
  eq: (column: string, value: string) => RecipientQuery;
};
type RecipientClient = { from: (table: string) => RecipientQuery };

/** One pair of reads per sweep, regardless of the number of overdue tasks. */
export async function loadOverdueRecipients(client: RecipientClient, taskIds: string[]) {
  const mentions = new Map<string, Set<string>>();
  const notified = new Map<string, Set<string>>();
  if (taskIds.length === 0) return { mentions, notified };

  const [mentionResult, sentResult] = await Promise.all([
    client.from("user_notifications").select("task_id, user_id").in("task_id", taskIds).eq("title", "You were mentioned"),
    client.from("push_reminders_sent").select("kind, user_id").in("kind", taskIds.map((id) => `task_overdue:${id}`)),
  ]);
  const error = mentionResult.error ?? sentResult.error;
  if (error) throw new Error(error.message);

  for (const row of mentionResult.data ?? []) {
    if (!row.task_id) continue;
    const users = mentions.get(row.task_id) ?? new Set<string>();
    users.add(row.user_id);
    mentions.set(row.task_id, users);
  }
  for (const row of sentResult.data ?? []) {
    if (!row.kind) continue;
    const users = notified.get(row.kind) ?? new Set<string>();
    users.add(row.user_id);
    notified.set(row.kind, users);
  }
  return { mentions, notified };
}