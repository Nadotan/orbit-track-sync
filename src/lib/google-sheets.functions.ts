import {
  createServerFn,
} from "@tanstack/react-start";

import {
  requireSupabaseAuth,
} from "@/integrations/supabase/auth-middleware";

export const syncGoogleSheetsNow =
  createServerFn({
    method:
      "POST",
  })
    .middleware([
      requireSupabaseAuth,
    ])
    .handler(
      async ({
        context,
      }) => {
        const {
          supabaseAdmin,
        } =
          await import(
            "@/integrations/supabase/client.server"
          );

        const {
          data:
            role,
          error:
            roleError,
        } =
          await supabaseAdmin
            .from(
              "user_roles",
            )
            .select(
              "role",
            )
            .eq(
              "user_id",
              context.userId,
            )
            .eq(
              "role",
              "admin",
            )
            .maybeSingle();

        if (
          roleError ||
          !role
        ) {
          throw new Error(
            "Only admins can manually sync Google Sheets.",
          );
        }

        const {
          syncGoogleSheetsSnapshot,
        } =
          await import(
            "./google-sheets.server"
          );

        return syncGoogleSheetsSnapshot();
      },
    );