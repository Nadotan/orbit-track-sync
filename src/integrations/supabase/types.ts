export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      active_timers: {
        Row: {
          closed_notified_at: string | null
          created_at: string
          last_reminded_at: string | null
          started_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          closed_notified_at?: string | null
          created_at?: string
          last_reminded_at?: string | null
          started_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          closed_notified_at?: string | null
          created_at?: string
          last_reminded_at?: string | null
          started_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      meetings: {
        Row: {
          created_at: string
          date: string
          id: string
          locked: boolean
          recurrence: string
          team_id: string | null
          time: string
          title: string
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          locked?: boolean
          recurrence?: string
          team_id?: string | null
          time: string
          title: string
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          locked?: boolean
          recurrence?: string
          team_id?: string | null
          time?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "meetings_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          actor_id: string | null
          created_at: string
          id: string
          message: string
          read: boolean
          tone: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          id?: string
          message: string
          read?: boolean
          tone?: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          id?: string
          message?: string
          read?: boolean
          tone?: string
        }
        Relationships: []
      }
      poll_options: {
        Row: {
          created_at: string
          id: string
          label: string
          poll_id: string
          position: number
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          poll_id: string
          position: number
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          poll_id?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "poll_options_poll_id_fkey"
            columns: ["poll_id"]
            isOneToOne: false
            referencedRelation: "polls"
            referencedColumns: ["id"]
          },
        ]
      }
      poll_votes: {
        Row: {
          created_at: string
          option_id: string
          poll_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          option_id: string
          poll_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          option_id?: string
          poll_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "poll_votes_option_belongs_to_poll"
            columns: ["poll_id", "option_id"]
            isOneToOne: false
            referencedRelation: "poll_options"
            referencedColumns: ["poll_id", "id"]
          },
          {
            foreignKeyName: "poll_votes_poll_id_fkey"
            columns: ["poll_id"]
            isOneToOne: false
            referencedRelation: "polls"
            referencedColumns: ["id"]
          },
        ]
      }
      polls: {
        Row: {
          closes_at: string
          created_at: string
          created_by: string
          description: string
          id: string
          label: string
          published_at: string
          question: string
          updated_at: string
        }
        Insert: {
          closes_at: string
          created_at?: string
          created_by: string
          description?: string
          id?: string
          label?: string
          published_at?: string
          question: string
          updated_at?: string
        }
        Update: {
          closes_at?: string
          created_at?: string
          created_by?: string
          description?: string
          id?: string
          label?: string
          published_at?: string
          question?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          id: string
          name: string
          team_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          id: string
          name?: string
          team_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          id?: string
          name?: string
          team_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          archived_at: string | null
          blocked_reason: string
          created_at: string
          created_by: string
          deadline: string | null
          deleted_at: string | null
          description: string
          id: string
          name: string
          owner_id: string
          priority: string
          status: string
          team_id: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          blocked_reason?: string
          created_at?: string
          created_by: string
          deadline?: string | null
          deleted_at?: string | null
          description?: string
          id?: string
          name: string
          owner_id: string
          priority?: string
          status?: string
          team_id?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          blocked_reason?: string
          created_at?: string
          created_by?: string
          deadline?: string | null
          deleted_at?: string | null
          description?: string
          id?: string
          name?: string
          owner_id?: string
          priority?: string
          status?: string
          team_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      push_clients: {
        Row: {
          client_id: string
          created_at: string
          endpoint: string | null
          ever_registered_at: string | null
          id: string
          last_seen_at: string
          permission: string
          user_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          endpoint?: string | null
          ever_registered_at?: string | null
          id?: string
          last_seen_at?: string
          permission: string
          user_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          endpoint?: string | null
          ever_registered_at?: string | null
          id?: string
          last_seen_at?: string
          permission?: string
          user_id?: string
        }
        Relationships: []
      }
      push_reminders_sent: {
        Row: {
          created_at: string
          id: string
          kind: string
          meeting_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          meeting_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          meeting_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_reminders_sent_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          last_attempt_at: string | null
          last_failure_at: string | null
          last_failure_message: string | null
          last_failure_status: number | null
          last_success_at: string | null
          p256dh: string
          updated_at: string
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          last_attempt_at?: string | null
          last_failure_at?: string | null
          last_failure_message?: string | null
          last_failure_status?: number | null
          last_success_at?: string | null
          p256dh: string
          updated_at?: string
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          last_attempt_at?: string | null
          last_failure_at?: string | null
          last_failure_message?: string | null
          last_failure_status?: number | null
          last_success_at?: string | null
          p256dh?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      rsvps: {
        Row: {
          cancelled: boolean
          created_at: string
          id: string
          meeting_id: string
          status: string
          user_id: string
        }
        Insert: {
          cancelled?: boolean
          created_at?: string
          id?: string
          meeting_id: string
          status: string
          user_id: string
        }
        Update: {
          cancelled?: boolean
          created_at?: string
          id?: string
          meeting_id?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rsvps_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      task_assignees: {
        Row: {
          assigned_at: string
          task_id: string
          user_id: string
        }
        Insert: {
          assigned_at?: string
          task_id: string
          user_id: string
        }
        Update: {
          assigned_at?: string
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_assignees_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          archived_at: string | null
          blocked_reason: string
          created_at: string
          created_by: string
          deadline: string
          deleted_at: string | null
          description: string
          id: string
          owner_id: string
          priority: string
          project_id: string | null
          status: string
          team_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          blocked_reason?: string
          created_at?: string
          created_by: string
          deadline: string
          deleted_at?: string | null
          description?: string
          id?: string
          owner_id: string
          priority?: string
          project_id?: string | null
          status?: string
          team_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          blocked_reason?: string
          created_at?: string
          created_by?: string
          deadline?: string
          deleted_at?: string | null
          description?: string
          id?: string
          owner_id?: string
          priority?: string
          project_id?: string | null
          status?: string
          team_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          created_at: string
          id: string
          team_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          team_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          team_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      time_entries: {
        Row: {
          created_at: string
          description: string
          duration_ms: number
          end_time: string
          id: string
          start_time: string
          task_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string
          duration_ms: number
          end_time: string
          id?: string
          start_time: string
          task_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string
          duration_ms?: number
          end_time?: string
          id?: string
          start_time?: string
          task_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_entries_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      user_notifications: {
        Row: {
          acknowledged_at: string | null
          created_at: string
          created_by: string | null
          id: string
          kind: string
          message: string
          popup_dismissed_at: string | null
          read_at: string | null
          requires_ack: boolean
          task_id: string | null
          title: string
          user_id: string
        }
        Insert: {
          acknowledged_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          kind: string
          message?: string
          popup_dismissed_at?: string | null
          read_at?: string | null
          requires_ack?: boolean
          task_id?: string | null
          title: string
          user_id: string
        }
        Update: {
          acknowledged_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          message?: string
          popup_dismissed_at?: string | null
          read_at?: string | null
          requires_ack?: boolean
          task_id?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_notifications_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      user_preferences: {
        Row: {
          enabled: boolean
          preference_key: string
          updated_at: string
          user_id: string
        }
        Insert: {
          enabled: boolean
          preference_key: string
          updated_at?: string
          user_id: string
        }
        Update: {
          enabled?: boolean
          preference_key?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_unavailability: {
        Row: {
          created_at: string
          date: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      work_updates: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          duration_ms: number | null
          id: string
          project_id: string | null
          source: string
          source_time_entry_id: string | null
          task_id: string | null
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          duration_ms?: number | null
          id?: string
          project_id?: string | null
          source?: string
          source_time_entry_id?: string | null
          task_id?: string | null
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          duration_ms?: number | null
          id?: string
          project_id?: string | null
          source?: string
          source_time_entry_id?: string | null
          task_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_updates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_updates_source_time_entry_id_fkey"
            columns: ["source_time_entry_id"]
            isOneToOne: true
            referencedRelation: "time_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_updates_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      workshop_status: {
        Row: {
          id: number
          is_open: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: number
          is_open?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: number
          is_open?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      app_role: "admin" | "user" | "team_lead"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user", "team_lead"],
    },
  },
} as const
