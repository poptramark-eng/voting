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
      app_users: {
        Row: {
          auth_subject: string
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          updated_at: string
        }
        Insert: {
          auth_subject: string
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          updated_at?: string
        }
        Update: {
          auth_subject?: string
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
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
            foreignKeyName: "audit_events_actor_user_id_app_users_fk"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
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
      event_role_assignments: {
        Row: {
          assigned_by: string
          created_at: string
          event_id: string
          expires_at: string | null
          id: string
          organization_id: string
          role: Database["public"]["Enums"]["organization_member_role"]
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          assigned_by: string
          created_at?: string
          event_id: string
          expires_at?: string | null
          id?: string
          organization_id: string
          role: Database["public"]["Enums"]["organization_member_role"]
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          assigned_by?: string
          created_at?: string
          event_id?: string
          expires_at?: string | null
          id?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["organization_member_role"]
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_role_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_role_assignments_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "voting_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_role_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_role_assignments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_invitation_email_outbox: {
        Row: {
          attempt_count: number
          available_at: string
          created_at: string
          id: string
          invitation_id: string
          last_error: string | null
          lock_token: string | null
          locked_at: string | null
          provider_email_id: string | null
          sent_at: string | null
          status: string
        }
        Insert: {
          attempt_count?: number
          available_at?: string
          created_at?: string
          id?: string
          invitation_id: string
          last_error?: string | null
          lock_token?: string | null
          locked_at?: string | null
          provider_email_id?: string | null
          sent_at?: string | null
          status?: string
        }
        Update: {
          attempt_count?: number
          available_at?: string
          created_at?: string
          id?: string
          invitation_id?: string
          last_error?: string | null
          lock_token?: string | null
          locked_at?: string | null
          provider_email_id?: string | null
          sent_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_invitation_email_outbox_invitation_id_fkey"
            columns: ["invitation_id"]
            isOneToOne: true
            referencedRelation: "organization_invitations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          organization_id: string
          revoked_at: string | null
          revoked_by: string | null
          role: Database["public"]["Enums"]["organization_member_role"]
          status: string
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          expires_at: string
          id?: string
          invited_by: string
          organization_id: string
          revoked_at?: string | null
          revoked_by?: string | null
          role: Database["public"]["Enums"]["organization_member_role"]
          status?: string
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          organization_id?: string
          revoked_at?: string | null
          revoked_by?: string | null
          role?: Database["public"]["Enums"]["organization_member_role"]
          status?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_invitations_accepted_by_fkey"
            columns: ["accepted_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_invitations_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "app_users"
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
          {
            foreignKeyName: "organization_memberships_user_id_app_users_fk"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
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
        Relationships: [
          {
            foreignKeyName: "organizations_created_by_app_users_fk"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_transactions: {
        Row: {
          amount_minor: number
          checkout_url: string | null
          created_at: string
          currency: string
          id: string
          idempotency_key: string
          initiated_by: string
          organization_id: string
          price_code: string
          provider: string
          provider_reference: string
          provider_transaction_id: string | null
          status: Database["public"]["Enums"]["payment_transaction_status"]
          updated_at: string
          verified_at: string | null
        }
        Insert: {
          amount_minor: number
          checkout_url?: string | null
          created_at?: string
          currency: string
          id?: string
          idempotency_key: string
          initiated_by: string
          organization_id: string
          price_code: string
          provider?: string
          provider_reference: string
          provider_transaction_id?: string | null
          status?: Database["public"]["Enums"]["payment_transaction_status"]
          updated_at?: string
          verified_at?: string | null
        }
        Update: {
          amount_minor?: number
          checkout_url?: string | null
          created_at?: string
          currency?: string
          id?: string
          idempotency_key?: string
          initiated_by?: string
          organization_id?: string
          price_code?: string
          provider?: string
          provider_reference?: string
          provider_transaction_id?: string | null
          status?: Database["public"]["Enums"]["payment_transaction_status"]
          updated_at?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_transactions_initiated_by_fkey"
            columns: ["initiated_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_transactions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_webhook_events: {
        Row: {
          attempt_count: number
          event_data: Json
          event_key: string
          event_type: string
          last_error: string | null
          next_attempt_at: string | null
          processed_at: string | null
          processing_started_at: string | null
          provider: string
          provider_reference: string | null
          received_at: string
          status: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          event_data?: Json
          event_key: string
          event_type: string
          last_error?: string | null
          next_attempt_at?: string | null
          processed_at?: string | null
          processing_started_at?: string | null
          provider?: string
          provider_reference?: string | null
          received_at?: string
          status?: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          event_data?: Json
          event_key?: string
          event_type?: string
          last_error?: string | null
          next_attempt_at?: string | null
          processed_at?: string | null
          processing_started_at?: string | null
          provider?: string
          provider_reference?: string | null
          received_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      process_lifecycle_events: {
        Row: {
          action: string
          actor_user_id: string
          evidence: Json
          from_status: Database["public"]["Enums"]["process_status"]
          id: string
          occurred_at: string
          organization_id: string
          process_id: string
          reason: string
          to_status: Database["public"]["Enums"]["process_status"]
          workflow_request_id: string | null
        }
        Insert: {
          action: string
          actor_user_id: string
          evidence?: Json
          from_status: Database["public"]["Enums"]["process_status"]
          id?: string
          occurred_at?: string
          organization_id: string
          process_id: string
          reason: string
          to_status: Database["public"]["Enums"]["process_status"]
          workflow_request_id?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string
          evidence?: Json
          from_status?: Database["public"]["Enums"]["process_status"]
          id?: string
          occurred_at?: string
          organization_id?: string
          process_id?: string
          reason?: string
          to_status?: Database["public"]["Enums"]["process_status"]
          workflow_request_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "process_lifecycle_events_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "process_lifecycle_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "process_lifecycle_events_process_id_fkey"
            columns: ["process_id"]
            isOneToOne: false
            referencedRelation: "voting_processes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "process_lifecycle_events_workflow_request_fk"
            columns: ["workflow_request_id"]
            isOneToOne: false
            referencedRelation: "process_workflow_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      process_role_assignments: {
        Row: {
          assigned_by: string
          created_at: string
          event_id: string
          expires_at: string | null
          id: string
          organization_id: string
          process_id: string
          role: Database["public"]["Enums"]["organization_member_role"]
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          assigned_by: string
          created_at?: string
          event_id: string
          expires_at?: string | null
          id?: string
          organization_id: string
          process_id: string
          role: Database["public"]["Enums"]["organization_member_role"]
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          assigned_by?: string
          created_at?: string
          event_id?: string
          expires_at?: string | null
          id?: string
          organization_id?: string
          process_id?: string
          role?: Database["public"]["Enums"]["organization_member_role"]
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "process_role_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "process_role_assignments_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "voting_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "process_role_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "process_role_assignments_process_id_fkey"
            columns: ["process_id"]
            isOneToOne: false
            referencedRelation: "voting_processes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "process_role_assignments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      process_workflow_approvals: {
        Row: {
          approver_user_id: string
          comment: string | null
          decided_at: string
          decision: string
          id: string
          request_id: string
        }
        Insert: {
          approver_user_id: string
          comment?: string | null
          decided_at?: string
          decision: string
          id?: string
          request_id: string
        }
        Update: {
          approver_user_id?: string
          comment?: string | null
          decided_at?: string
          decision?: string
          id?: string
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "process_workflow_approvals_approver_user_id_fkey"
            columns: ["approver_user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "process_workflow_approvals_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "process_workflow_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      process_workflow_requests: {
        Row: {
          action: string
          assurance_tier: Database["public"]["Enums"]["assurance_tier"]
          id: string
          organization_id: string
          process_id: string
          process_updated_at: string
          reason: string
          request_data: Json
          requested_at: string
          requested_by: string
          required_approvals: number
          resolved_at: string | null
          status: string
        }
        Insert: {
          action: string
          assurance_tier: Database["public"]["Enums"]["assurance_tier"]
          id?: string
          organization_id: string
          process_id: string
          process_updated_at: string
          reason: string
          request_data?: Json
          requested_at?: string
          requested_by: string
          required_approvals: number
          resolved_at?: string | null
          status?: string
        }
        Update: {
          action?: string
          assurance_tier?: Database["public"]["Enums"]["assurance_tier"]
          id?: string
          organization_id?: string
          process_id?: string
          process_updated_at?: string
          reason?: string
          request_data?: Json
          requested_at?: string
          requested_by?: string
          required_approvals?: number
          resolved_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "process_workflow_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "process_workflow_requests_process_id_fkey"
            columns: ["process_id"]
            isOneToOne: false
            referencedRelation: "voting_processes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "process_workflow_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      voter_pii_access_approvals: {
        Row: {
          approver_user_id: string
          comment: string | null
          decided_at: string
          decision: string
          id: string
          request_id: string
          request_snapshot: Json
        }
        Insert: {
          approver_user_id: string
          comment?: string | null
          decided_at?: string
          decision: string
          id?: string
          request_id: string
          request_snapshot: Json
        }
        Update: {
          approver_user_id?: string
          comment?: string | null
          decided_at?: string
          decision?: string
          id?: string
          request_id?: string
          request_snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "voter_pii_access_approvals_approver_user_id_fkey"
            columns: ["approver_user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voter_pii_access_approvals_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "voter_pii_access_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      voter_pii_access_requests: {
        Row: {
          assurance_tier: Database["public"]["Enums"]["assurance_tier"]
          created_at: string
          event_id: string
          expires_at: string | null
          granted_at: string | null
          id: string
          organization_id: string
          permitted_categories: string[]
          process_id: string | null
          purpose: string
          recipient_user_id: string
          requested_by: string
          requested_expires_at: string
          required_approvals: number
          resolved_at: string | null
          revocation_reason: string | null
          revoked_at: string | null
          revoked_by: string | null
          scope_type: string
          status: string
          updated_at: string
        }
        Insert: {
          assurance_tier: Database["public"]["Enums"]["assurance_tier"]
          created_at?: string
          event_id: string
          expires_at?: string | null
          granted_at?: string | null
          id?: string
          organization_id: string
          permitted_categories: string[]
          process_id?: string | null
          purpose: string
          recipient_user_id: string
          requested_by: string
          requested_expires_at: string
          required_approvals: number
          resolved_at?: string | null
          revocation_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          scope_type: string
          status?: string
          updated_at?: string
        }
        Update: {
          assurance_tier?: Database["public"]["Enums"]["assurance_tier"]
          created_at?: string
          event_id?: string
          expires_at?: string | null
          granted_at?: string | null
          id?: string
          organization_id?: string
          permitted_categories?: string[]
          process_id?: string | null
          purpose?: string
          recipient_user_id?: string
          requested_by?: string
          requested_expires_at?: string
          required_approvals?: number
          resolved_at?: string | null
          revocation_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          scope_type?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "voter_pii_access_requests_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "voting_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voter_pii_access_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voter_pii_access_requests_process_id_fkey"
            columns: ["process_id"]
            isOneToOne: false
            referencedRelation: "voting_processes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voter_pii_access_requests_recipient_user_id_fkey"
            columns: ["recipient_user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voter_pii_access_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voter_pii_access_requests_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
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
            foreignKeyName: "voter_register_entries_created_by_app_users_fk"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voter_register_entries_process_id_fkey"
            columns: ["process_id"]
            isOneToOne: false
            referencedRelation: "voting_processes"
            referencedColumns: ["id"]
          },
        ]
      }
      voter_register_snapshot_approvals: {
        Row: {
          approver_user_id: string
          comment: string | null
          decided_at: string
          decision: string
          id: string
          snapshot_id: string
        }
        Insert: {
          approver_user_id: string
          comment?: string | null
          decided_at?: string
          decision: string
          id?: string
          snapshot_id: string
        }
        Update: {
          approver_user_id?: string
          comment?: string | null
          decided_at?: string
          decision?: string
          id?: string
          snapshot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "voter_register_snapshot_approvals_approver_user_id_fkey"
            columns: ["approver_user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voter_register_snapshot_approvals_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "voter_register_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      voter_register_snapshot_entries: {
        Row: {
          eligibility_status: string
          identity_payload: Json
          ordinal: number
          snapshot_id: string
          voter_register_entry_id: string
        }
        Insert: {
          eligibility_status: string
          identity_payload: Json
          ordinal: number
          snapshot_id: string
          voter_register_entry_id: string
        }
        Update: {
          eligibility_status?: string
          identity_payload?: Json
          ordinal?: number
          snapshot_id?: string
          voter_register_entry_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "voter_register_snapshot_entries_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "voter_register_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voter_register_snapshot_entries_voter_register_entry_id_fkey"
            columns: ["voter_register_entry_id"]
            isOneToOne: false
            referencedRelation: "voter_register_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      voter_register_snapshots: {
        Row: {
          assurance_tier: Database["public"]["Enums"]["assurance_tier"]
          created_at: string
          eligible_count: number
          event_id: string
          finalized_at: string | null
          id: string
          integrity_digest: string
          organization_id: string
          process_id: string
          register_revision: number
          rejected_count: number
          reopen_reason: string | null
          reopened_at: string | null
          reopened_by: string | null
          requested_by: string
          required_approvals: number
          resolved_at: string | null
          revoked_count: number
          status: string
          total_entry_count: number
          version: number
        }
        Insert: {
          assurance_tier: Database["public"]["Enums"]["assurance_tier"]
          created_at?: string
          eligible_count: number
          event_id: string
          finalized_at?: string | null
          id?: string
          integrity_digest: string
          organization_id: string
          process_id: string
          register_revision: number
          rejected_count: number
          reopen_reason?: string | null
          reopened_at?: string | null
          reopened_by?: string | null
          requested_by: string
          required_approvals: number
          resolved_at?: string | null
          revoked_count: number
          status?: string
          total_entry_count: number
          version: number
        }
        Update: {
          assurance_tier?: Database["public"]["Enums"]["assurance_tier"]
          created_at?: string
          eligible_count?: number
          event_id?: string
          finalized_at?: string | null
          id?: string
          integrity_digest?: string
          organization_id?: string
          process_id?: string
          register_revision?: number
          rejected_count?: number
          reopen_reason?: string | null
          reopened_at?: string | null
          reopened_by?: string | null
          requested_by?: string
          required_approvals?: number
          resolved_at?: string | null
          revoked_count?: number
          status?: string
          total_entry_count?: number
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "voter_register_snapshots_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "voting_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voter_register_snapshots_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voter_register_snapshots_process_id_fkey"
            columns: ["process_id"]
            isOneToOne: false
            referencedRelation: "voting_processes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voter_register_snapshots_reopened_by_fkey"
            columns: ["reopened_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voter_register_snapshots_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "app_users"
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
            foreignKeyName: "voting_events_created_by_app_users_fk"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
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
          assurance_tier: Database["public"]["Enums"]["assurance_tier"]
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
          voter_register_revision: number
        }
        Insert: {
          assurance_tier?: Database["public"]["Enums"]["assurance_tier"]
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
          voter_register_revision?: number
        }
        Update: {
          assurance_tier?: Database["public"]["Enums"]["assurance_tier"]
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
          voter_register_revision?: number
        }
        Relationships: [
          {
            foreignKeyName: "voting_processes_created_by_app_users_fk"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
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
      accept_organization_invitation: {
        Args: { target_token: string }
        Returns: Json
      }
      approve_process_workflow_request: {
        Args: { comment?: string; decision: string; target_request: string }
        Returns: string
      }
      assign_event_role: {
        Args: {
          target_event: string
          target_expires_at?: string
          target_role: Database["public"]["Enums"]["organization_member_role"]
          target_user: string
        }
        Returns: string
      }
      assign_process_role: {
        Args: {
          target_expires_at?: string
          target_process: string
          target_role: Database["public"]["Enums"]["organization_member_role"]
          target_user: string
        }
        Returns: string
      }
      claim_organization_invitation_email_outbox: {
        Args: { target_limit?: number }
        Returns: {
          email: string
          invitation_id: string
          lock_token: string
          organization_name: string
          outbox_id: string
          role: Database["public"]["Enums"]["organization_member_role"]
          token: string
        }[]
      }
      claim_paystack_webhook_event: {
        Args: { target_event_key: string }
        Returns: Json
      }
      close_expired_process: {
        Args: { target_process: string }
        Returns: string
      }
      complete_organization_invitation_email_outbox: {
        Args: {
          target_lock_token: string
          target_outbox: string
          target_provider_email_id: string
        }
        Returns: boolean
      }
      complete_paystack_payment: {
        Args: {
          target_amount_minor: number
          target_currency: string
          target_event_key: string
          target_event_type: string
          target_provider_transaction_id: string
          target_reference: string
        }
        Returns: boolean
      }
      create_organization: {
        Args: { org_name: string; org_slug: string }
        Returns: string
      }
      create_organization_invitation: {
        Args: {
          target_email: string
          target_org: string
          target_role: Database["public"]["Enums"]["organization_member_role"]
        }
        Returns: Json
      }
      decide_voter_pii_access_request: {
        Args: {
          target_comment?: string
          target_decision: string
          target_request: string
        }
        Returns: Json
      }
      decide_voter_register_finalization: {
        Args: {
          target_comment?: string
          target_decision: string
          target_snapshot: string
        }
        Returns: string
      }
      emergency_suspend_process: {
        Args: { evidence?: Json; reason: string; target_process: string }
        Returns: string
      }
      fail_organization_invitation_email_outbox: {
        Args: {
          target_error: string
          target_lock_token: string
          target_outbox: string
        }
        Returns: string
      }
      fail_paystack_webhook_event: {
        Args: { error_message: string; target_event_key: string }
        Returns: boolean
      }
      has_current_event_permission: {
        Args: { target_event: string; target_permission: string }
        Returns: boolean
      }
      has_current_process_permission: {
        Args: { target_permission: string; target_process: string }
        Returns: boolean
      }
      is_organization_invitation_email_lease_valid: {
        Args: { target_lock_token: string; target_outbox: string }
        Returns: boolean
      }
      list_organization_invitations: {
        Args: { target_org: string }
        Returns: {
          created_at: string
          email: string
          expires_at: string
          id: string
          role: Database["public"]["Enums"]["organization_member_role"]
          status: string
        }[]
      }
      list_organization_members: {
        Args: { target_org: string }
        Returns: {
          created_at: string
          display_name: string
          email: string
          membership_id: string
          role: Database["public"]["Enums"]["organization_member_role"]
          status: Database["public"]["Enums"]["organization_member_status"]
          user_id: string
        }[]
      }
      open_scheduled_process: {
        Args: { target_process: string }
        Returns: string
      }
      read_voter_register_entries: {
        Args: {
          target_access_mode?: string
          target_limit?: number
          target_offset?: number
          target_process: string
        }
        Returns: Json
      }
      read_voter_register_snapshot_summaries: {
        Args: { target_process: string }
        Returns: {
          approval_count: number
          assurance_tier: string
          created_at: string
          eligible_count: number
          finalized_at: string
          id: string
          register_revision: number
          rejected_count: number
          reopen_reason: string
          reopened_at: string
          requested_by_is_current_user: boolean
          required_approvals: number
          resolved_at: string
          revoked_count: number
          status: string
          total_entry_count: number
          version: number
        }[]
      }
      reopen_voter_register_snapshot: {
        Args: { target_reason: string; target_snapshot: string }
        Returns: string
      }
      request_process_resumption: {
        Args: {
          corrective_actions?: Json
          reason: string
          review_outcome: string
          target_process: string
        }
        Returns: string
      }
      request_process_termination: {
        Args: { evidence?: Json; reason: string; target_process: string }
        Returns: string
      }
      request_voter_pii_access: {
        Args: {
          target_categories: string[]
          target_event: string
          target_expires_at: string
          target_process: string
          target_purpose: string
          target_recipient: string
          target_scope: string
        }
        Returns: string
      }
      request_voter_register_finalization: {
        Args: { target_process: string; target_reason: string }
        Returns: string
      }
      revoke_event_role: {
        Args: { target_event: string; target_user: string }
        Returns: boolean
      }
      revoke_organization_invitation: {
        Args: { target_invitation: string }
        Returns: boolean
      }
      revoke_process_role: {
        Args: { target_process: string; target_user: string }
        Returns: boolean
      }
      revoke_voter_pii_access: {
        Args: { target_reason: string; target_request: string }
        Returns: boolean
      }
      submit_process_for_approval: {
        Args: { target_process: string }
        Returns: string
      }
      update_organization_membership: {
        Args: {
          target_org: string
          target_role: Database["public"]["Enums"]["organization_member_role"]
          target_status: Database["public"]["Enums"]["organization_member_status"]
          target_user: string
        }
        Returns: Json
      }
      update_voter_register_eligibility: {
        Args: {
          target_entry: string
          target_process: string
          target_reason: string
          target_status: string
        }
        Returns: Json
      }
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
      payment_transaction_status:
        | "INITIALIZING"
        | "PENDING"
        | "SUCCEEDED"
        | "FAILED"
        | "ABANDONED"
        | "REFUNDED"
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
      payment_transaction_status: [
        "INITIALIZING",
        "PENDING",
        "SUCCEEDED",
        "FAILED",
        "ABANDONED",
        "REFUNDED",
      ],
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
