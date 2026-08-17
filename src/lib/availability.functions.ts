import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

async function assertAdmin(context: {
  supabase: {
    from: (table: "user_roles") => any;
  };
  userId: string;
}) {
  const { data, error } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId)
    .eq("role", "admin")
    .maybeSingle();

  if (error || !data) {
    throw new Error("Forbidden");
  }
}

export interface AdminAvailabilityRow {
  userId: string;
  name: string;
  email: string;
  team: string;
  date: string;
  createdAt: string;
}

export const getOwnAvailability = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const client = context.supabase as any;

    const { data, error } = await client
      .from("user_unavailability")
      .select("date")
      .eq("user_id", context.userId)
      .order("date", { ascending: true });

    if (error) {
      throw new Error("Unable to load availability.");
    }

    return {
      dates: (data ?? []).map((row: { date: string }) => row.date),
    };
  });

export const setOwnAvailability = createServerFn({ method: "POST" })
  .validator(
    z.object({
      dates: z.array(dateSchema).min(1).max(62),
      unavailable: z.boolean(),
    }),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const client = context.supabase as any;
    const dates = Array.from(new Set(data.dates));

    if (data.unavailable) {
      const { error } = await client.from("user_unavailability").upsert(
        dates.map((date) => ({
          user_id: context.userId,
          date,
        })),
        {
          onConflict: "user_id,date",
          ignoreDuplicates: true,
        },
      );

      if (error) {
        throw new Error("Unable to save availability.");
      }
    } else {
      const { error } = await client
        .from("user_unavailability")
        .delete()
        .eq("user_id", context.userId)
        .in("date", dates);

      if (error) {
        throw new Error("Unable to save availability.");
      }
    }

    return { ok: true };
  });

export const getAdminAvailability = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context as never);

    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    const admin = supabaseAdmin as any;

    const [
      { data: availability, error: availabilityError },
      { data: profiles, error: profilesError },
      { data: memberships, error: membershipsError },
      { data: teams, error: teamsError },
    ] = await Promise.all([
      admin
        .from("user_unavailability")
        .select("user_id, date, created_at")
        .order("date", { ascending: true }),

      admin.from("profiles").select("id, name, email, team_id"),

      admin.from("team_members").select("user_id, team_id"),

      admin.from("teams").select("id, name"),
    ]);

    if (
      availabilityError ||
      profilesError ||
      membershipsError ||
      teamsError
    ) {
      throw new Error("Unable to load availability.");
    }

    const profileMap = new Map<string, any>(
      (profiles ?? []).map((profile: any) => [profile.id, profile]),
    );

    const teamMap = new Map<string, string>(
      (teams ?? []).map((team: any) => [team.id, team.name]),
    );

    const membershipsByUser = new Map<string, string[]>();

    for (const membership of memberships ?? []) {
      const current = membershipsByUser.get(membership.user_id) ?? [];

      current.push(membership.team_id);

      membershipsByUser.set(membership.user_id, current);
    }

    const rows: AdminAvailabilityRow[] = (availability ?? []).map(
      (row: any) => {
        const profile = profileMap.get(row.user_id);

        const membershipTeamIds =
          membershipsByUser.get(row.user_id) ?? [];

        const teamIds =
          membershipTeamIds.length > 0
            ? membershipTeamIds
            : profile?.team_id
              ? [profile.team_id]
              : [];

        const teamNames = Array.from(
          new Set(
            teamIds
              .map((teamId) => teamMap.get(teamId))
              .filter((name): name is string => Boolean(name)),
          ),
        );

        return {
          userId: row.user_id,
          name: profile?.name ?? "Unknown member",
          email: profile?.email ?? "",
          team:
            teamNames.length > 0 ? teamNames.join(", ") : "Unassigned",
          date: row.date,
          createdAt: row.created_at,
        };
      },
    );

    rows.sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.name.localeCompare(b.name),
    );

    return { rows };
  });