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
      bookings: {
        Row: {
          counts_in_subscription: boolean
          created_at: string
          id: string
          slot_date: string
          slot_time: string
          status: Database["public"]["Enums"]["booking_status"]
          subscription_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          counts_in_subscription?: boolean
          created_at?: string
          id?: string
          slot_date: string
          slot_time: string
          status?: Database["public"]["Enums"]["booking_status"]
          subscription_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          counts_in_subscription?: boolean
          created_at?: string
          id?: string
          slot_date?: string
          slot_time?: string
          status?: Database["public"]["Enums"]["booking_status"]
          subscription_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      cancellation_requests: {
        Row: {
          admin_decision_counts: boolean | null
          booking_id: string
          created_at: string
          decided_at: string | null
          id: string
          makeup_deadline: string | null
          reason: string
          sickness: boolean
          status: Database["public"]["Enums"]["cancel_status"]
          user_id: string
        }
        Insert: {
          admin_decision_counts?: boolean | null
          booking_id: string
          created_at?: string
          decided_at?: string | null
          id?: string
          makeup_deadline?: string | null
          reason: string
          sickness?: boolean
          status?: Database["public"]["Enums"]["cancel_status"]
          user_id: string
        }
        Update: {
          admin_decision_counts?: boolean | null
          booking_id?: string
          created_at?: string
          decided_at?: string | null
          id?: string
          makeup_deadline?: string | null
          reason?: string
          sickness?: boolean
          status?: Database["public"]["Enums"]["cancel_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cancellation_requests_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      day_notes: {
        Row: {
          added_by: string
          created_at: string
          id: string
          label: string | null
          link: string
          note_date: string
        }
        Insert: {
          added_by: string
          created_at?: string
          id?: string
          label?: string | null
          link: string
          note_date: string
        }
        Update: {
          added_by?: string
          created_at?: string
          id?: string
          label?: string | null
          link?: string
          note_date?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          body: string
          created_at: string
          from_admin: boolean
          id: string
          parent_id: string | null
          read_by_admin: boolean
          read_by_user: boolean
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          from_admin?: boolean
          id?: string
          parent_id?: string | null
          read_by_admin?: boolean
          read_by_user?: boolean
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          from_admin?: boolean
          id?: string
          parent_id?: string | null
          read_by_admin?: boolean
          read_by_user?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      permanent_slots: {
        Row: {
          created_at: string
          day_of_week: number
          id: string
          slot_time: string
          user_id: string
        }
        Insert: {
          created_at?: string
          day_of_week: number
          id?: string
          slot_time: string
          user_id: string
        }
        Update: {
          created_at?: string
          day_of_week?: number
          id?: string
          slot_time?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          full_name: string
          id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          full_name: string
          id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          full_name?: string
          id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      slot_overrides: {
        Row: {
          created_at: string
          id: string
          max_capacity: number
          slot_date: string
          slot_time: string
        }
        Insert: {
          created_at?: string
          id?: string
          max_capacity: number
          slot_date: string
          slot_time: string
        }
        Update: {
          created_at?: string
          id?: string
          max_capacity?: number
          slot_date?: string
          slot_time?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          lessons_total: number
          lessons_used: number
          paid: boolean
          price: number
          purchase_date: string
          sickness_credits: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          lessons_total: number
          lessons_used?: number
          paid?: boolean
          price: number
          purchase_date: string
          sickness_credits?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          lessons_total?: number
          lessons_used?: number
          paid?: boolean
          price?: number
          purchase_date?: string
          sickness_credits?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      time_slots: {
        Row: {
          active: boolean
          created_at: string
          day_of_week: number
          id: string
          is_permanent_for: string | null
          max_capacity: number
          one_off_date: string | null
          slot_time: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          day_of_week: number
          id?: string
          is_permanent_for?: string | null
          max_capacity?: number
          one_off_date?: string | null
          slot_time: string
        }
        Update: {
          active?: boolean
          created_at?: string
          day_of_week?: number
          id?: string
          is_permanent_for?: string | null
          max_capacity?: number
          one_off_date?: string | null
          slot_time?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      waiting_list: {
        Row: {
          created_at: string
          id: string
          slot_date: string
          slot_time: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          slot_date: string
          slot_time: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          slot_date?: string
          slot_time?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cleanup_old_bookings: { Args: never; Returns: number }
      cleanup_old_day_notes: { Args: never; Returns: number }
      delete_user_data: { Args: { _user_id: string }; Returns: undefined }
      expire_makeup_cancellations: { Args: never; Returns: number }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      materialize_permanent_bookings: {
        Args: { _end: string; _start: string }
        Returns: number
      }
    }
    Enums: {
      app_role: "admin" | "user"
      booking_status: "active" | "cancelled" | "completed" | "pending_cancel"
      cancel_status: "pending" | "approved" | "declined"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
      app_role: ["admin", "user"],
      booking_status: ["active", "cancelled", "completed", "pending_cancel"],
      cancel_status: ["pending", "approved", "declined"],
    },
  },
} as const
