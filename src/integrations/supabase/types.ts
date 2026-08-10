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
      booking_cancellations: {
        Row: {
          booking_id: string | null
          cancelled_by: string | null
          cancelled_by_role: string
          created_at: string
          guest_name: string | null
          id: string
          reason: string | null
          restored_at: string | null
          slot_date: string
          slot_time: string
          user_id: string
        }
        Insert: {
          booking_id?: string | null
          cancelled_by?: string | null
          cancelled_by_role?: string
          created_at?: string
          guest_name?: string | null
          id?: string
          reason?: string | null
          restored_at?: string | null
          slot_date: string
          slot_time: string
          user_id: string
        }
        Update: {
          booking_id?: string | null
          cancelled_by?: string | null
          cancelled_by_role?: string
          created_at?: string
          guest_name?: string | null
          id?: string
          reason?: string | null
          restored_at?: string | null
          slot_date?: string
          slot_time?: string
          user_id?: string
        }
        Relationships: []
      }
      bookings: {
        Row: {
          counts_in_subscription: boolean
          created_at: string
          guest_name: string | null
          id: string
          is_guest: boolean
          is_individual: boolean
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
          guest_name?: string | null
          id?: string
          is_guest?: boolean
          is_individual?: boolean
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
          guest_name?: string | null
          id?: string
          is_guest?: boolean
          is_individual?: boolean
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
          document_deadline: string | null
          document_uploaded_at: string | null
          document_url: string | null
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
          document_deadline?: string | null
          document_uploaded_at?: string | null
          document_url?: string | null
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
          document_deadline?: string | null
          document_uploaded_at?: string | null
          document_url?: string | null
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
      day_cancellations: {
        Row: {
          created_at: string
          created_by: string | null
          note: string | null
          note_date: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          note?: string | null
          note_date: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          note?: string | null
          note_date?: string
        }
        Relationships: []
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
      horse_assignments: {
        Row: {
          assigned_by: string
          booking_id: string | null
          created_at: string
          guest_name: string | null
          horse_id: string
          id: string
          slot_date: string
          slot_time: string
          user_id: string | null
        }
        Insert: {
          assigned_by: string
          booking_id?: string | null
          created_at?: string
          guest_name?: string | null
          horse_id: string
          id?: string
          slot_date: string
          slot_time: string
          user_id?: string | null
        }
        Update: {
          assigned_by?: string
          booking_id?: string | null
          created_at?: string
          guest_name?: string | null
          horse_id?: string
          id?: string
          slot_date?: string
          slot_time?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "horse_assignments_horse_id_fkey"
            columns: ["horse_id"]
            isOneToOne: false
            referencedRelation: "horses"
            referencedColumns: ["id"]
          },
        ]
      }
      horse_requests: {
        Row: {
          created_at: string
          id: string
          slot_date: string
          slot_time: string
          user_id: string
          wished_horse: string
        }
        Insert: {
          created_at?: string
          id?: string
          slot_date: string
          slot_time: string
          user_id: string
          wished_horse: string
        }
        Update: {
          created_at?: string
          id?: string
          slot_date?: string
          slot_time?: string
          user_id?: string
          wished_horse?: string
        }
        Relationships: []
      }
      horses: {
        Row: {
          active: boolean
          created_at: string
          id: string
          max_daily_rides: number
          name: string
          notes: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          max_daily_rides?: number
          name: string
          notes?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          max_daily_rides?: number
          name?: string
          notes?: string | null
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
      permanent_booking_exceptions: {
        Row: {
          created_at: string
          slot_date: string
          slot_time: string
          user_id: string
        }
        Insert: {
          created_at?: string
          slot_date: string
          slot_time: string
          user_id: string
        }
        Update: {
          created_at?: string
          slot_date?: string
          slot_time?: string
          user_id?: string
        }
        Relationships: []
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
      profile_links: {
        Row: {
          created_at: string
          display_name: string
          id: string
          linked_profile_id: string
          parent_user_id: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id?: string
          linked_profile_id: string
          parent_user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          linked_profile_id?: string
          parent_user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          full_name: string
          id: string
          notify_lesson_reminders: boolean
          notify_schedule_changes: boolean
          notify_school_news: boolean
          onboarding_accepted_at: string | null
          onboarding_version: number | null
          phone: string | null
          rules_version: string | null
          theme: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          full_name: string
          id: string
          notify_lesson_reminders?: boolean
          notify_schedule_changes?: boolean
          notify_school_news?: boolean
          onboarding_accepted_at?: string | null
          onboarding_version?: number | null
          phone?: string | null
          rules_version?: string | null
          theme?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          full_name?: string
          id?: string
          notify_lesson_reminders?: boolean
          notify_schedule_changes?: boolean
          notify_school_news?: boolean
          onboarding_accepted_at?: string | null
          onboarding_version?: number | null
          phone?: string | null
          rules_version?: string | null
          theme?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      public_registration_requests: {
        Row: {
          admin_note: string | null
          age: number
          client_note: string | null
          created_at: string
          duration_minutes: number
          email: string
          emergency_contact: string
          experience_level: string
          experience_notes: string | null
          facebook_name: string | null
          first_name: string
          id: string
          last_name: string
          phone: string
          preferred_times: string | null
          price_eur: number
          proposed_date: string | null
          proposed_time: string | null
          public_token: string
          requested_date: string | null
          requested_time: string | null
          service_type: string
          status: string
          updated_at: string
        }
        Insert: {
          admin_note?: string | null
          age: number
          client_note?: string | null
          created_at?: string
          duration_minutes?: number
          email: string
          emergency_contact: string
          experience_level: string
          experience_notes?: string | null
          facebook_name?: string | null
          first_name: string
          id?: string
          last_name: string
          phone: string
          preferred_times?: string | null
          price_eur?: number
          proposed_date?: string | null
          proposed_time?: string | null
          public_token?: string
          requested_date?: string | null
          requested_time?: string | null
          service_type?: string
          status?: string
          updated_at?: string
        }
        Update: {
          admin_note?: string | null
          age?: number
          client_note?: string | null
          created_at?: string
          duration_minutes?: number
          email?: string
          emergency_contact?: string
          experience_level?: string
          experience_notes?: string | null
          facebook_name?: string | null
          first_name?: string
          id?: string
          last_name?: string
          phone?: string
          preferred_times?: string | null
          price_eur?: number
          proposed_date?: string | null
          proposed_time?: string | null
          public_token?: string
          requested_date?: string | null
          requested_time?: string | null
          service_type?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      public_reviews: {
        Row: {
          author_name: string | null
          body: string
          created_at: string
          id: string
          rating: number
          show_name: boolean
          status: string
        }
        Insert: {
          author_name?: string | null
          body: string
          created_at?: string
          id?: string
          rating: number
          show_name?: boolean
          status?: string
        }
        Update: {
          author_name?: string | null
          body?: string
          created_at?: string
          id?: string
          rating?: number
          show_name?: boolean
          status?: string
        }
        Relationships: []
      }
      slot_notes: {
        Row: {
          created_at: string
          created_by: string
          day_of_week: number | null
          id: string
          note: string
          note_date: string
          recurrence: string
          slot_time: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          day_of_week?: number | null
          id?: string
          note: string
          note_date: string
          recurrence?: string
          slot_time?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          day_of_week?: number | null
          id?: string
          note?: string
          note_date?: string
          recurrence?: string
          slot_time?: string | null
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
          lesson_type: string
          lessons_total: number
          lessons_used: number
          paid: boolean
          price: number
          purchase_date: string
          sickness_credits: number
          start_from_date: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          lesson_type?: string
          lessons_total: number
          lessons_used?: number
          paid?: boolean
          price: number
          purchase_date: string
          sickness_credits?: number
          start_from_date?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          lesson_type?: string
          lessons_total?: number
          lessons_used?: number
          paid?: boolean
          price?: number
          purchase_date?: string
          sickness_credits?: number
          start_from_date?: string | null
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
      vacations: {
        Row: {
          created_at: string
          ends_on: string
          id: string
          note: string | null
          starts_on: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          ends_on: string
          id?: string
          note?: string | null
          starts_on: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          ends_on?: string
          id?: string
          note?: string | null
          starts_on?: string
          updated_at?: string
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
      add_vacation_and_cancel: {
        Args: {
          _ends_on: string
          _note?: string
          _starts_on: string
          _user_id: string
        }
        Returns: Json
      }
      admin_propose_public_registration_time: {
        Args: {
          _date: string
          _note?: string
          _request_id: string
          _time: string
        }
        Returns: undefined
      }
      admin_set_public_registration_status: {
        Args: { _note?: string; _request_id: string; _status: string }
        Returns: undefined
      }
      cancel_all_nonpermanent_duplicate_candidates: {
        Args: { _user_id?: string }
        Returns: Json
      }
      cancel_all_possible_duplicate_bookings: {
        Args: { _user_id?: string }
        Returns: Json
      }
      cancel_booking_occurrence: {
        Args: { _booking_id: string }
        Returns: Json
      }
      cancel_duplicate_booking_candidate: {
        Args: { _booking_id: string }
        Returns: Json
      }
      cancel_possible_duplicate_booking: {
        Args: { _booking_id: string }
        Returns: Json
      }
      cleanup_old_bookings: { Args: never; Returns: number }
      cleanup_old_conversations: { Args: never; Returns: number }
      cleanup_old_day_notes: { Args: never; Returns: number }
      cleanup_old_public_registrations: { Args: never; Returns: number }
      cleanup_old_subscriptions: { Args: never; Returns: number }
      delete_user_data: { Args: { _user_id: string }; Returns: undefined }
      expire_makeup_cancellations: { Args: never; Returns: number }
      get_approved_reviews: {
        Args: never
        Returns: {
          author_name: string | null
          body: string
          created_at: string
          id: string
          rating: number
          show_name: boolean
          status: string
        }[]
        SetofOptions: {
          from: "*"
          to: "public_reviews"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_duplicate_booking_candidates: {
        Args: { _user_id?: string }
        Returns: {
          booking_id: string
          is_current_permanent: boolean
          permanent_times: string[]
          profile_name: string
          slot_date: string
          slot_time: string
          total_bookings: number
          user_id: string
        }[]
      }
      get_possible_duplicate_bookings: {
        Args: { _user_id?: string }
        Returns: {
          permanent_time: string
          proper_booking_id: string
          slot_date: string
          suspect_booking_id: string
          suspect_time: string
        }[]
      }
      get_public_registration_request: {
        Args: { _token: string }
        Returns: {
          admin_note: string | null
          age: number
          client_note: string | null
          created_at: string
          duration_minutes: number
          email: string
          emergency_contact: string
          experience_level: string
          experience_notes: string | null
          facebook_name: string | null
          first_name: string
          id: string
          last_name: string
          phone: string
          preferred_times: string | null
          price_eur: number
          proposed_date: string | null
          proposed_time: string | null
          public_token: string
          requested_date: string | null
          requested_time: string | null
          service_type: string
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "public_registration_requests"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_public_registration_slots: {
        Args: { _days?: number }
        Returns: {
          active_count: number
          lesson_type: string
          max_capacity: number
          slot_date: string
          slot_time: string
        }[]
      }
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
      owns_profile: { Args: { _pid: string; _uid: string }; Returns: boolean }
      remove_permanent_slot: {
        Args: {
          _day_of_week: number
          _from_date: string
          _slot_time: string
          _user_id: string
        }
        Returns: Json
      }
      respond_to_public_registration: {
        Args: { _action: string; _message?: string; _token: string }
        Returns: Json
      }
      respond_to_public_registration_proposal: {
        Args: { _accept: boolean; _token: string }
        Returns: undefined
      }
      submit_public_registration: {
        Args: {
          _age: number
          _email: string
          _emergency_contact: string
          _experience_level: string
          _experience_notes?: string
          _facebook_name?: string
          _first_name: string
          _last_name: string
          _phone: string
          _preferred_times?: string
          _requested_date?: string
          _requested_time?: string
        }
        Returns: {
          id: string
          public_token: string
        }[]
      }
      submit_public_registration_v2: {
        Args: {
          _age: number
          _email: string
          _emergency_contact: string
          _experience_level: string
          _experience_notes?: string
          _facebook_name?: string
          _first_name: string
          _last_name: string
          _phone: string
          _preferred_times?: string
          _requested_date?: string
          _requested_time?: string
          _service_type: string
        }
        Returns: {
          id: string
          public_token: string
        }[]
      }
      submit_public_review: {
        Args: {
          _author_name?: string
          _body: string
          _rating: number
          _show_name?: boolean
        }
        Returns: string
      }
    }
    Enums: {
      app_role: "admin" | "user" | "trainer"
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
      app_role: ["admin", "user", "trainer"],
      booking_status: ["active", "cancelled", "completed", "pending_cancel"],
      cancel_status: ["pending", "approved", "declined"],
    },
  },
} as const
