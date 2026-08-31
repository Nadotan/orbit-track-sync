import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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

/** Admin-only directory: emails and role assignments for every member. */
export const getAdminDirectory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context as never);

    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    const [
      { data: profiles, error: profilesError },
      { data: roles, error: rolesError },
    ] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, email"),
      supabaseAdmin.from("user_roles").select("user_id, role"),
    ]);

    if (profilesError || rolesError) {
      throw new Error("Unable to load the member directory.");
    }

    return {
      emails: (profiles ?? []).map((profile) => ({
        id: profile.id,
        email: profile.email,
      })),

      roles: (roles ?? []).map((role) => ({
        userId: role.user_id,
        role: role.role,
      })),
    };
  });

/** Admin-only role assignment. Role changes never happen from the browser. */
export const setUserRole = createServerFn({ method: "POST" })
  .validator(
    z.object({
      userId: z.string().uuid(),
      role: z.enum(["admin", "user"]),
    }),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdmin(context as never);

    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    const { error: deleteError } = await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", data.userId);

    if (deleteError) {
      throw new Error("Unable to update the role.");
    }

    const { error: insertError } = await supabaseAdmin
      .from("user_roles")
      .insert({
        user_id: data.userId,
        role: data.role,
      });

    if (insertError) {
      throw new Error("Unable to update the role.");
    }

    return {
      ok: true,
    };
  });

/**
 * Creates a one-time announcement for every member.
 *
 * The creator also receives a history row, but it is
 * already marked read/dismissed so the admin does not
 * immediately receive their own pop-up.
 */
export const createPopupAnnouncement = createServerFn({
  method: "POST",
})
  .validator(
    z.object({
      title: z.string().trim().min(1).max(120),
      message: z.string().trim().min(1).max(2000),
    }),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdmin(context as never);

    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    const admin = supabaseAdmin as any;

    const {
      data: profiles,
      error: profilesError,
    } = await admin
      .from("profiles")
      .select("id");

    if (profilesError) {
      throw new Error("Unable to load members.");
    }

    const userIds = Array.from(
      new Set<string>(
        (profiles ?? []).map(
          (profile: any) =>
            profile.id as string,
        ),
      ),
    );

    if (userIds.length === 0) {
      return {
        sent: 0,
      };
    }

    const now =
      new Date().toISOString();

    const {
      error: insertError,
    } = await admin
      .from("user_notifications")
      .insert(
        userIds.map((userId) => {
          const isCreator =
            userId === context.userId;

          return {
            user_id: userId,
            kind: "announcement",
            title: data.title.trim(),
            message: data.message.trim(),
            task_id: null,
            created_by: context.userId,
            requires_ack: false,
            read_at: isCreator
              ? now
              : null,
            acknowledged_at: null,
            popup_dismissed_at:
              isCreator
                ? now
                : null,
          };
        }),
      );

    if (insertError) {
      throw new Error(
        "Unable to publish the pop-up.",
      );
    }

    return {
      sent: userIds.filter(
        (userId) =>
          userId !== context.userId,
      ).length,
    };
  });