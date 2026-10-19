type RecipientRow = { user_id: string; task_id?: string | null; kind?: string };
type RecipientQuery = PromiseLike<{ data: RecipientRow[] | null; error: { message: string } | null }> & {
  select: (columns: string) => RecipientQuery;
  in: (column: string, values: string[]) => RecipientQuery;
  eq: (column: string, value: string) => RecipientQuery;
  order: (column: string) => RecipientQuery;
  range: (from: number, to: number) => RecipientQuery;
};
type RecipientClient = { from: (table: string) => RecipientQuery };

async function readAll(query: RecipientQuery) {
  const rows: RecipientRow[] = [];
  for (let offset = 0; ; offset += 500) {
    const result = await query.range(offset, offset + 499);
    if (result.error) throw new Error(result.error.message);
    const page = result.data ?? [];
    rows.push(...page);
    if (page.length < 500) return rows;
  }
}

/** One pair of reads per sweep, regardless of the number of overdue tasks. */
export async function loadOverdueRecipients(client: RecipientClient, taskIds: string[]) {
  const mentions = new Map<string, Set<string>>();
  const notified = new Map<string, Set<string>>();
  if (taskIds.length === 0) return { mentions, notified };

  const [mentionRows, sentRows] = await Promise.all([
    readAll(client.from("user_notifications").select("task_id, user_id").in("task_id", taskIds).eq("title", "You were mentioned").order("id")),
    readAll(client.from("push_reminders_sent").select("kind, user_id").in("kind", taskIds.map((id) => `task_overdue:${id}`)).order("id")),
  ]);

  for (const row of mentionRows) {
    if (!row.task_id) continue;
    const users = mentions.get(row.task_id) ?? new Set<string>();
    users.add(row.user_id);
    mentions.set(row.task_id, users);
  }
  for (const row of sentRows) {
    if (!row.kind) continue;
    const users = notified.get(row.kind) ?? new Set<string>();
    users.add(row.user_id);
    notified.set(row.kind, users);
  }
  return { mentions, notified };
}