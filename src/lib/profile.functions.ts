import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const onboardingSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Please enter your name.")
    .max(120, "Name is too long."),

  teamId: z.string().uuid().nullable(),

  /*
   * Either a storage object path inside the private avatars
   * bucket ("<user-id>/avatar-123.jpg") or an absolute URL.
   */
  avatarUrl: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .refine(
      (value) =>
        /^https?:\/\//i.test(value) ||
        /^[A-Za-z0-9._\-/]+$/.test(value),
      "Invalid avatar reference.",
    )
    .nullable(),
});

export const completeOnboardingProfile = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .validator(onboardingSchema)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    const {
      data: { user },
      error: userError,
    } = await context.supabase.auth.getUser();

    if (userError || !user) {
      throw new Error(
        "Your session is no longer valid. Please sign in again.",
      );
    }

    if (user.id !== context.userId) {
      throw new Error("Authenticated user mismatch.");
    }

    if (!user.email) {
      throw new Error(
        "Your account does not have an email address.",
      );
    }

    if (data.teamId) {
      const {
        data: team,
        error: teamError,
      } = await supabaseAdmin
        .from("teams")
        .select("id")
        .eq("id", data.teamId)
        .maybeSingle();

      if (teamError) {
        throw new Error(teamError.message);
      }

      if (!team) {
        throw new Error(
          "The selected team no longer exists. Please choose another team.",
        );
      }
    }

    /*
     * Save normal profile data.
     *
     * Do NOT use profiles.onboarded because that column does
     * not exist in the actual database.
     */
    const {
      data: profile,
      error: profileError,
    } = await supabaseAdmin
      .from("profiles")
      .upsert(
        {
          id: context.userId,
          email: user.email,
          name: data.name,
          team_id: data.teamId,
          avatar_url: data.avatarUrl,
        },
        {
          onConflict: "id",
        },
      )
      .select(
        "id, name, email, team_id, avatar_url",
      )
      .single();

    if (profileError) {
      console.error(
        "Failed to save onboarding profile:",
        profileError,
      );

      throw new Error(profileError.message);
    }

    /*
     * Keep the multi-team membership list in sync with the
     * team picked during onboarding.
     */
    if (data.teamId) {
      const { error: membershipError } =
        await supabaseAdmin
          .from("team_members")
          .upsert(
            {
              user_id: context.userId,
              team_id: data.teamId,
            },
            { onConflict: "user_id,team_id" },
          );

      if (membershipError) {
        console.error(
          "Failed to save team membership:",
          membershipError,
        );
      }
    }


    /*
     * Store onboarding completion in Supabase Auth app_metadata.
     *
     * This can only be changed here using the server-side
     * admin client.
     */
    const { error: metadataError } =
      await supabaseAdmin.auth.admin.updateUserById(
        context.userId,
        {
          app_metadata: {
            ...(user.app_metadata ?? {}),
            onboarded: true,
          },
        },
      );

    if (metadataError) {
      console.error(
        "Failed to save onboarding status:",
        metadataError,
      );

      throw new Error(
        `Profile was saved, but onboarding status failed: ${metadataError.message}`,
      );
    }

    return {
      ...profile,
      onboarded: true,
    };
  });