import { afterEach, describe, expect, test, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

const signing = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { storage: { from: () => ({ createSignedUrls: signing }) } } }));
import { getCachedAvatarPaths } from "./avatars";
import { loadOverdueRecipients } from "./reminder-recipients.server";

afterEach(() => vi.clearAllMocks());

describe("avatar request reuse", () => {
  test("a failed signing attempt is retried on the next refresh", async () => {
    signing.mockResolvedValueOnce({ data: null, error: { message: "temporary failure" } });
    signing.mockResolvedValueOnce({ data: [{ path: "a/photo.jpg", signedUrl: "https://example.test/photo" }], error: null });
    const client = new QueryClient();
    expect((await getCachedAvatarPaths(client, "a", ["a/photo.jpg"])).size).toBe(0);
    expect((await getCachedAvatarPaths(client, "a", ["a/photo.jpg"])).size).toBe(1);
    expect(signing).toHaveBeenCalledTimes(2);
    client.clear();
  });
  test("unchanged paths reuse one request but new paths and different users do not", async () => {
    signing.mockImplementation(async (paths: string[]) => ({ data: paths.map((path) => ({ path, signedUrl: `https://example.test/${path}` })), error: null }));
    const client = new QueryClient();
    await getCachedAvatarPaths(client, "a", ["a/photo.jpg"]);
    const second = await getCachedAvatarPaths(client, "a", ["a/photo.jpg", "a/photo.jpg"]);
    expect(second.get("a/photo.jpg")).toBe("https://example.test/a/photo.jpg");
    expect(signing).toHaveBeenCalledTimes(1);
    await getCachedAvatarPaths(client, "a", ["a/new-photo.jpg"]);
    await getCachedAvatarPaths(client, "b", ["a/photo.jpg"]);
    expect(signing).toHaveBeenCalledTimes(3);
    client.clear();
  });
});

describe("batched overdue recipients", () => {
  test("multiple tasks share two reads and preserve recipients and successful-send exclusions", async () => {
    const from = vi.fn((table: string) => {
      const result = { data: table === "user_notifications" ? [
        { task_id: "one", user_id: "a" }, { task_id: "one", user_id: "a" },
        { task_id: "two", user_id: "a" }, { task_id: "two", user_id: "b" },
      ] : [{ kind: "task_overdue:two", user_id: "a" }], error: null };
      const query = { select: vi.fn(), in: vi.fn(), eq: vi.fn(), order: vi.fn(), range: vi.fn(), then: Promise.resolve(result).then.bind(Promise.resolve(result)) };
      query.select.mockReturnValue(query); query.in.mockReturnValue(query); query.eq.mockReturnValue(query);
      query.order.mockReturnValue(query); query.range.mockReturnValue(query);
      return query;
    });
    const result = await loadOverdueRecipients({ from }, ["one", "two"]);
    expect(from).toHaveBeenCalledTimes(2);
    expect([...result.mentions.get("one") ?? []]).toEqual(["a"]);
    const pending = [...result.mentions.get("two") ?? []].filter((id) => !result.notified.get("task_overdue:two")?.has(id));
    expect(pending).toEqual(["b"]);
  });
  test("empty overdue list performs no recipient reads", async () => {
    const from = vi.fn();
    await loadOverdueRecipients({ from }, []);
    expect(from).not.toHaveBeenCalled();
  });
  test("failed recipient reads never lead to duplicate pushes", async () => {
    const query = { select: () => query, in: () => query, eq: () => query, order: () => query, range: () => query, then: Promise.resolve({ data: null, error: { message: "unavailable" } }).then.bind(Promise.resolve({ data: null, error: { message: "unavailable" } })) };
    await expect(loadOverdueRecipients({ from: () => query }, ["one"])).rejects.toThrow("unavailable");
  });
});