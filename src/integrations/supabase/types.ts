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
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      complaints: {
        Row: {
          category: string
          created_at: string
          date: string
          description: string
          id: string
          priority: string
          resolution_notes: string | null
          resolved_date: string | null
          status: string
          subscriber_id: string
          user_id: string
        }
        Insert: {
          category?: string
          created_at?: string
          date?: string
          description: string
          id?: string
          priority?: string
          resolution_notes?: string | null
          resolved_date?: string | null
          status?: string
          subscriber_id: string
          user_id: string
        }
        Update: {
          category?: string
          created_at?: string
          date?: string
          description?: string
          id?: string
          priority?: string
          resolution_notes?: string | null
          resolved_date?: string | null
          status?: string
          subscriber_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "complaints_subscriber_id_fkey"
            columns: ["subscriber_id"]
            isOneToOne: false
            referencedRelation: "subscribers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "complaints_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      packs: {
        Row: {
          billing_type: string
          channels: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          price: number
          provider_id: string | null
          service_type: string
          user_id: string
          validity_days: number | null
        }
        Insert: {
          billing_type?: string
          channels: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          price: number
          provider_id?: string | null
          service_type?: string
          user_id: string
          validity_days?: number | null
        }
        Update: {
          billing_type?: string
          channels?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          price?: number
          provider_id?: string | null
          service_type?: string
          user_id?: string
          validity_days?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "packs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      providers: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          notes: string | null
          service_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          service_type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          service_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      regions: {
        Row: {
          created_at: string
          id: string
          name: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "regions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      stb_inventory: {
        Row: {
          created_at: string
          device_type: string
          id: string
          notes: string | null
          serial_number: string
          service_type: string
          status: Database["public"]["Enums"]["stb_status"]
          subscriber_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_type?: string
          id?: string
          notes?: string | null
          serial_number: string
          service_type?: string
          status?: Database["public"]["Enums"]["stb_status"]
          subscriber_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_type?: string
          id?: string
          notes?: string | null
          serial_number?: string
          service_type?: string
          status?: Database["public"]["Enums"]["stb_status"]
          subscriber_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stb_inventory_subscriber_fk"
            columns: ["subscriber_id"]
            isOneToOne: false
            referencedRelation: "subscribers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stb_inventory_subscriber_id_fkey"
            columns: ["subscriber_id"]
            isOneToOne: false
            referencedRelation: "subscribers"
            referencedColumns: ["id"]
          },
        ]
      }
      subscribers: {
        Row: {
          cable_balance: number
          cable_provider_id: string | null
          created_at: string
          current_internet_pack: string | null
          current_pack: string | null
          current_subscription: Json | null
          id: string
          internet_balance: number
          internet_provider_id: string | null
          internet_subscription: Json | null
          internet_subscription_history: Json[] | null
          join_date: string
          latitude: number | null
          longitude: number | null
          mobile: string
          name: string
          region: string | null
          services: string[]
          stb_number: string | null
          subscriber_id: string
          subscription_history: Json[] | null
          updated_at: string
          user_id: string
        }
        Insert: {
          cable_balance?: number
          cable_provider_id?: string | null
          created_at?: string
          current_internet_pack?: string | null
          current_pack?: string | null
          current_subscription?: Json | null
          id?: string
          internet_balance?: number
          internet_provider_id?: string | null
          internet_subscription?: Json | null
          internet_subscription_history?: Json[] | null
          join_date?: string
          latitude?: number | null
          longitude?: number | null
          mobile: string
          name: string
          region?: string | null
          services?: string[]
          stb_number?: string | null
          subscriber_id: string
          subscription_history?: Json[] | null
          updated_at?: string
          user_id: string
        }
        Update: {
          cable_balance?: number
          cable_provider_id?: string | null
          created_at?: string
          current_internet_pack?: string | null
          current_pack?: string | null
          current_subscription?: Json | null
          id?: string
          internet_balance?: number
          internet_provider_id?: string | null
          internet_subscription?: Json | null
          internet_subscription_history?: Json[] | null
          join_date?: string
          latitude?: number | null
          longitude?: number | null
          mobile?: string
          name?: string
          region?: string | null
          services?: string[]
          stb_number?: string | null
          subscriber_id?: string
          subscription_history?: Json[] | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscribers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      transaction_notes: {
        Row: {
          author_id: string
          created_at: string
          id: string
          note: string
          transaction_id: string
          user_id: string
        }
        Insert: {
          author_id: string
          created_at?: string
          id?: string
          note: string
          transaction_id: string
          user_id: string
        }
        Update: {
          author_id?: string
          created_at?: string
          id?: string
          note?: string
          transaction_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transaction_notes_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          date: string
          description: string | null
          edited_at: string | null
          edited_by: string | null
          id: string
          provider_id: string | null
          reverses_transaction_id: string | null
          service_type: string
          source: Database["public"]["Enums"]["transaction_source"]
          status: Database["public"]["Enums"]["transaction_status"]
          subscriber_id: string
          type: string
          user_id: string
          void_reason: string | null
          void_reason_code:
            | Database["public"]["Enums"]["void_reason_code"]
            | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          date?: string
          description?: string | null
          edited_at?: string | null
          edited_by?: string | null
          id?: string
          provider_id?: string | null
          reverses_transaction_id?: string | null
          service_type?: string
          source?: Database["public"]["Enums"]["transaction_source"]
          status?: Database["public"]["Enums"]["transaction_status"]
          subscriber_id: string
          type: string
          user_id: string
          void_reason?: string | null
          void_reason_code?:
            | Database["public"]["Enums"]["void_reason_code"]
            | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          date?: string
          description?: string | null
          edited_at?: string | null
          edited_by?: string | null
          id?: string
          provider_id?: string | null
          reverses_transaction_id?: string | null
          service_type?: string
          source?: Database["public"]["Enums"]["transaction_source"]
          status?: Database["public"]["Enums"]["transaction_status"]
          subscriber_id?: string
          type?: string
          user_id?: string
          void_reason?: string | null
          void_reason_code?:
            | Database["public"]["Enums"]["void_reason_code"]
            | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_reverses_transaction_id_fkey"
            columns: ["reverses_transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_subscriber_id_fkey"
            columns: ["subscriber_id"]
            isOneToOne: false
            referencedRelation: "subscribers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      check_subscriber_deletable: {
        Args: { p_subscriber_id: string }
        Returns: Json
      }
      expire_lapsed_subscriptions: { Args: never; Returns: number }
      generate_subscriber_id: {
        Args: { p_region_name: string }
        Returns: string
      }
      is_pack_in_use: { Args: { pack_name: string }; Returns: boolean }
      is_provider_in_use: { Args: { provider_uuid: string }; Returns: boolean }
      is_region_in_use: { Args: { region_name: string }; Returns: boolean }
      recalc_subscriber_balance: {
        Args: { p_service_type: string; p_subscriber_id: string }
        Returns: undefined
      }
      reconcile_stb_inventory: { Args: never; Returns: Json }
      void_transaction: {
        Args: {
          p_reason: string
          p_reason_code: Database["public"]["Enums"]["void_reason_code"]
          p_transaction_id: string
        }
        Returns: string
      }
    }
    Enums: {
      stb_status: "available" | "assigned" | "faulty" | "decommissioned"
      transaction_source:
        | "manual_charge"
        | "manual_payment"
        | "subscription_charge"
        | "subscription_refund"
        | "reversal"
        | "adjustment"
      transaction_status: "posted" | "voided" | "reversal"
      void_reason_code:
        | "data_entry_error"
        | "duplicate"
        | "wrong_subscriber"
        | "wrong_amount"
        | "customer_dispute"
        | "other"
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
      stb_status: ["available", "assigned", "faulty", "decommissioned"],
      transaction_source: [
        "manual_charge",
        "manual_payment",
        "subscription_charge",
        "subscription_refund",
        "reversal",
        "adjustment",
      ],
      transaction_status: ["posted", "voided", "reversal"],
      void_reason_code: [
        "data_entry_error",
        "duplicate",
        "wrong_subscriber",
        "wrong_amount",
        "customer_dispute",
        "other",
      ],
    },
  },
} as const
