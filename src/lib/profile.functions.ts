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

  avatarUrl: z
    .string()
    .url()
    .refine(
      (value) =>
        value.startsWith("https://") ||
        value.startsWith("http://"),
      "Invalid avatar URL.",
    )
    .nullable(),
});

export const completeOnboardingProfile = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .validator(onboardingSchema)
  .handler(async ({ data, context }) => {
    /*
     * Important:
     * client.server.ts is server-only and contains the
     * Lovable-managed privileged Supabase connection.
     *
     * It is dynamically imported so none of the privileged
     * server implementation can enter the browser bundle.
     */
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    /*
     * The user ID is NOT supplied by the browser.
     * requireSupabaseAuth verified the access token and supplied
     * context.userId.
     */
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

    /*
     * Do not allow a fake/non-existing team ID to be written
     * using the privileged server client.
     */
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
     * Upsert instead of update:
     *
     * - Existing profile -> update it
     * - Missing profile -> create it
     *
     * This fixes the current onboarding bug where a user can
     * authenticate successfully but has no row in public.profiles.
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
          onboarded: true,
        },
        {
          onConflict: "id",
        },
      )
      .select(
        "id, name, email, team_id, avatar_url, onboarded",
      )
      .single();

    if (profileError) {
      console.error(
        "Failed to save onboarding profile:",
        profileError,
      );

      throw new Error(profileError.message);
    }

    if (!profile?.onboarded) {
      throw new Error(
        "Your profile could not be completed. Please try again.",
      );
    }

    return profile;
  });