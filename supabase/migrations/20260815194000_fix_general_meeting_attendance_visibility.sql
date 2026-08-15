/*
 * RSVP visibility
 *
 * Normal users:
 * - can always read their own RSVP
 * - can see who is Attending a General meeting, across ALL teams
 * - can see who is Attending a team meeting if they belong to that team
 * - cannot read other people's Declined RSVPs
 *
 * Admins:
 * - can read every RSVP
 */

DROP POLICY IF EXISTS
  "Read rsvps scoped to team or self"
ON public.rsvps;

DROP POLICY IF EXISTS
  "Read rsvps for own team meetings"
ON public.rsvps;

DROP POLICY IF EXISTS
  "Signed in can read rsvps"
ON public.rsvps;

CREATE POLICY
  "Read visible meeting rsvps"
ON public.rsvps
FOR SELECT
TO authenticated
USING (
  /*
   * Everyone can read their own RSVP.
   */
  user_id = auth.uid()

  OR

  /*
   * Admins can read all RSVP states.
   */
  EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role = 'admin'::public.app_role
  )

  OR

  /*
   * Normal users may see other people's
   * RSVP only when they are Attending.
   */
  (
    status = 'Attending'

    AND EXISTS (
      SELECT 1
      FROM public.meetings m
      WHERE m.id = rsvps.meeting_id

        AND (
          /*
           * General meeting:
           * every signed-in POM member can
           * see everyone who is attending.
           */
          m.team_id IS NULL

          OR

          /*
           * Team meeting:
           * viewer must belong to that team.
           */
          EXISTS (
            SELECT 1
            FROM public.team_members viewer
            WHERE viewer.user_id = auth.uid()
              AND viewer.team_id = m.team_id
          )
        )
    )
  )
);