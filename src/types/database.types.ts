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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      audit_events: {
        Row: {
          action: string
          actor_user_id: string | null
          event_data: Json
          id: number
          occurred_at: string
          organization_id: string
          resource_id: string | null
          resource_type: string
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          event_data?: Json
          id?: never
          occurred_at?: string
          organization_id: string
          resource_id?: string | null
          resource_type: string
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          event_data?: Json
          id?: never
          occurred_at?: string
          organization_id?: string
          resource_id?: string | null
          resource_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ballot_items: {
        Row: {
          contest_id: string
          created_at: string
          description: string | null
          display_order: number
          id: string
          item_type: string
          label: string
          metadata: Json
          updated_at: string
        }
        Insert: {
          contest_id: string
          created_at?: string
          description?: string | null
          display_order?: number
          id?: string
          item_type: string
          label: string
          metadata?: Json
          updated_at?: string
        }
        Update: {
          contest_id?: string
          created_at?: string
          description?: string | null
          display_order?: number
          id?: string
          item_type?: string
          label?: string
          metadata?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ballot_items_contest_id_fkey"
            columns: ["contest_id"]
            isOneToOne: false
            referencedRelation: "contests"
            referencedColumns: ["id"]
          },
        ]
      }
      contests: {
        Row: {
          created_at: string
          description: string | null
          display_order: number
          id: string
          process_id: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          display_order?: number
          id?: string
          process_id: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          display_order?: number
          id?: string
          process_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contests_process_id_fkey"
            columns: ["process_id"]
            isOneToOne: false
            referencedRelation: "voting_processes"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_memberships: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          role: Database["public"]["Enums"]["organization_member_role"]
          status: Database["public"]["Enums"]["organization_member_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          role?: Database["public"]["Enums"]["organization_member_role"]
          status?: Database["public"]["Enums"]["organization_member_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["organization_member_role"]
          status?: Database["public"]["Enums"]["organization_member_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          country_code: string
          created_at: string
          created_by: string
          default_currency: string
          id: string
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          country_code?: string
          created_at?: string
          created_by: string
          default_currency?: string
          id?: string
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          country_code?: string
          created_at?: string
          created_by?: string
          default_currency?: string
          id?: string
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      voter_register_entries: {
        Row: {
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          created_by: string
          display_name: string | null
          eligibility_status: string
          external_reference: string | null
          id: string
          process_id: string
          source: string
          updated_at: string
        }
        Insert: {
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by: string
          display_name?: string | null
          eligibility_status?: string
          external_reference?: string | null
          id?: string
          process_id: string
          source?: string
          updated_at?: string
        }
        Update: {
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string
          display_name?: string | null
          eligibility_status?: string
          external_reference?: string | null
          id?: string
          process_id?: string
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "voter_register_entries_process_id_fkey"
            columns: ["process_id"]
            isOneToOne: false
            referencedRelation: "voting_processes"
            referencedColumns: ["id"]
          },
        ]
      }
      voting_events: {
        Row: {
          assurance_tier: Database["public"]["Enums"]["assurance_tier"]
          category: Database["public"]["Enums"]["voting_category"]
          created_at: string
          created_by: string
          description: string | null
          id: string
          organization_id: string
          status: Database["public"]["Enums"]["process_status"]
          title: string
          updated_at: string
        }
        Insert: {
          assurance_tier?: Database["public"]["Enums"]["assurance_tier"]
          category: Database["public"]["Enums"]["voting_category"]
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          organization_id: string
          status?: Database["public"]["Enums"]["process_status"]
          title: string
          updated_at?: string
        }
        Update: {
          assurance_tier?: Database["public"]["Enums"]["assurance_tier"]
          category?: Database["public"]["Enums"]["voting_category"]
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          organization_id?: string
          status?: Database["public"]["Enums"]["process_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "voting_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      voting_processes: {
        Row: {
          ballot_format: Database["public"]["Enums"]["ballot_format"]
          closes_at: string | null
          created_at: string
          created_by: string
          eligibility_mode: string
          event_id: string
          id: string
          opens_at: string | null
          results_disclosure: Json
          status: Database["public"]["Enums"]["process_status"]
          title: string
          updated_at: string
          vote_change_policy: Json
        }
        Insert: {
          ballot_format: Database["public"]["Enums"]["ballot_format"]
          closes_at?: string | null
          created_at?: string
          created_by: string
          eligibility_mode: string
          event_id: string
          id?: string
          opens_at?: string | null
          results_disclosure?: Json
          status?: Database["public"]["Enums"]["process_status"]
          title: string
          updated_at?: string
          vote_change_policy?: Json
        }
        Update: {
          ballot_format?: Database["public"]["Enums"]["ballot_format"]
          closes_at?: string | null
          created_at?: string
          created_by?: string
          eligibility_mode?: string
          event_id?: string
          id?: string
          opens_at?: string | null
          results_disclosure?: Json
          status?: Database["public"]["Enums"]["process_status"]
          title?: string
          updated_at?: string
          vote_change_policy?: Json
        }
        Relationships: [
          {
            foreignKeyName: "voting_processes_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "voting_events"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_organization: {
        Args: { org_name: string; org_slug: string }
        Returns: string
      }
      has_org_role: {
        Args: {
          allowed_roles: Database["public"]["Enums"]["organization_member_role"][]
          target_org: string
        }
        Returns: boolean
      }
      is_active_org_member: { Args: { target_org: string }; Returns: boolean }
    }
    Enums: {
      assurance_tier: "STANDARD" | "ENHANCED" | "HIGH" | "CRITICAL"
      ballot_format:
        | "SINGLE_CHOICE"
        | "MULTIPLE_CHOICE"
        | "RANKED_CHOICE"
        | "YES_NO"
        | "APPROVAL"
        | "SCORED"
      organization_member_role:
        | "OWNER"
        | "ADMIN"
        | "ELECTION_MANAGER"
        | "AUDITOR"
        | "OBSERVER"
        | "BILLING_MANAGER"
        | "MEMBER"
      organization_member_status: "INVITED" | "ACTIVE" | "SUSPENDED" | "REMOVED"
      process_status:
        | "DRAFT"
        | "PENDING_APPROVAL"
        | "SCHEDULED"
        | "OPEN"
        | "SUSPENDED"
        | "CLOSED"
        | "TERMINATED"
        | "UNDER_REVIEW"
        | "CERTIFIED"
      voting_category:
        | "GENERAL_POLL"
        | "CONTEST"
        | "ORGANIZATIONAL_ELECTION"
        | "PUBLIC_ELECTION"
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
      assurance_tier: ["STANDARD", "ENHANCED", "HIGH", "CRITICAL"],
      ballot_format: [
        "SINGLE_CHOICE",
        "MULTIPLE_CHOICE",
        "RANKED_CHOICE",
        "YES_NO",
        "APPROVAL",
        "SCORED",
      ],
      organization_member_role: [
        "OWNER",
        "ADMIN",
        "ELECTION_MANAGER",
        "AUDITOR",
        "OBSERVER",
        "BILLING_MANAGER",
        "MEMBER",
      ],
      organization_member_status: ["INVITED", "ACTIVE", "SUSPENDED", "REMOVED"],
      process_status: [
        "DRAFT",
        "PENDING_APPROVAL",
        "SCHEDULED",
        "OPEN",
        "SUSPENDED",
        "CLOSED",
        "TERMINATED",
        "UNDER_REVIEW",
        "CERTIFIED",
      ],
      voting_category: [
        "GENERAL_POLL",
        "CONTEST",
        "ORGANIZATIONAL_ELECTION",
        "PUBLIC_ELECTION",
      ],
    },
  },
} as const
