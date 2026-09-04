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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      api_usage: {
        Row: {
          created_at: string | null
          id: string
          request_type: string | null
          tokens_used: number | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          request_type?: string | null
          tokens_used?: number | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          request_type?: string | null
          tokens_used?: number | null
          user_id?: string
        }
        Relationships: []
      }
      bids: {
        Row: {
          amount: number | null
          bidder_id: string | null
          bidder_org_id: number | null
          bidder_user_id: string | null
          created_at: string | null
          id: string
          listing_id: string | null
          notes: string | null
          price: number | null
          proposed_date: string | null
          question: string | null
          request_id: number | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          amount?: number | null
          bidder_id?: string | null
          bidder_org_id?: number | null
          bidder_user_id?: string | null
          created_at?: string | null
          id?: string
          listing_id?: string | null
          notes?: string | null
          price?: number | null
          proposed_date?: string | null
          question?: string | null
          request_id?: number | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          amount?: number | null
          bidder_id?: string | null
          bidder_org_id?: number | null
          bidder_user_id?: string | null
          created_at?: string | null
          id?: string
          listing_id?: string | null
          notes?: string | null
          price?: number | null
          proposed_date?: string | null
          question?: string | null
          request_id?: number | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bids_bidder_org_id_fkey"
            columns: ["bidder_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bids_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "marketplace_listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bids_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "marketplace_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          created_at: string | null
          email: string | null
          first_name: string
          id: number
          is_primary: boolean | null
          last_name: string | null
          notes: string | null
          organization_id: number | null
          phone: string | null
          site_id: number | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          first_name: string
          id?: number
          is_primary?: boolean | null
          last_name?: string | null
          notes?: string | null
          organization_id?: number | null
          phone?: string | null
          site_id?: number | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string | null
          first_name?: string
          id?: number
          is_primary?: boolean | null
          last_name?: string | null
          notes?: string | null
          organization_id?: number | null
          phone?: string | null
          site_id?: number | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      engineer_invitations: {
        Row: {
          accepted: boolean | null
          accepted_at: string | null
          created_at: string | null
          email: string
          expires_at: string | null
          first_name: string | null
          id: number
          invited_by: string
          last_name: string | null
          organization_id: number
          role: string | null
          token: string | null
        }
        Insert: {
          accepted?: boolean | null
          accepted_at?: string | null
          created_at?: string | null
          email: string
          expires_at?: string | null
          first_name?: string | null
          id?: number
          invited_by: string
          last_name?: string | null
          organization_id: number
          role?: string | null
          token?: string | null
        }
        Update: {
          accepted?: boolean | null
          accepted_at?: string | null
          created_at?: string | null
          email?: string
          expires_at?: string | null
          first_name?: string | null
          id?: number
          invited_by?: string
          last_name?: string | null
          organization_id?: number
          role?: string | null
          token?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "engineer_invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineer_invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment: {
        Row: {
          created_at: string | null
          customer_organization_id: number | null
          id: number
          manufacturer: string
          model: string
          notes: string | null
          serial_number: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          customer_organization_id?: number | null
          id?: number
          manufacturer: string
          model: string
          notes?: string | null
          serial_number: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          customer_organization_id?: number | null
          id?: number
          manufacturer?: string
          model?: string
          notes?: string | null
          serial_number?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "equipment_customer_organization_id_fkey"
            columns: ["customer_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment_serials: {
        Row: {
          asset_tag: string | null
          assigned_to: string | null
          created_at: string | null
          equipment_id: number
          id: number
          last_service_date: string | null
          location: string | null
          next_service_due: string | null
          notes: string | null
          organization_id: number | null
          purchase_date: string | null
          serial_number: string
          site_id: number | null
          status: string | null
          updated_at: string | null
          warranty_expiry: string | null
        }
        Insert: {
          asset_tag?: string | null
          assigned_to?: string | null
          created_at?: string | null
          equipment_id: number
          id?: number
          last_service_date?: string | null
          location?: string | null
          next_service_due?: string | null
          notes?: string | null
          organization_id?: number | null
          purchase_date?: string | null
          serial_number: string
          site_id?: number | null
          status?: string | null
          updated_at?: string | null
          warranty_expiry?: string | null
        }
        Update: {
          asset_tag?: string | null
          assigned_to?: string | null
          created_at?: string | null
          equipment_id?: number
          id?: number
          last_service_date?: string | null
          location?: string | null
          next_service_due?: string | null
          notes?: string | null
          organization_id?: number | null
          purchase_date?: string | null
          serial_number?: string
          site_id?: number | null
          status?: string | null
          updated_at?: string | null
          warranty_expiry?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "equipment_serials_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_serials_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_serials_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      fault_codes: {
        Row: {
          brand: string
          created_at: string | null
          description: string | null
          fault_code: string
          fault_title: string
          id: number
          manual_ref: string | null
          model: string
          model_group: string | null
          notes: string | null
          probable_cause: string | null
          remedy: string | null
          severity: string | null
          updated_at: string | null
          verified: boolean | null
        }
        Insert: {
          brand: string
          created_at?: string | null
          description?: string | null
          fault_code: string
          fault_title: string
          id?: number
          manual_ref?: string | null
          model: string
          model_group?: string | null
          notes?: string | null
          probable_cause?: string | null
          remedy?: string | null
          severity?: string | null
          updated_at?: string | null
          verified?: boolean | null
        }
        Update: {
          brand?: string
          created_at?: string | null
          description?: string | null
          fault_code?: string
          fault_title?: string
          id?: number
          manual_ref?: string | null
          model?: string
          model_group?: string | null
          notes?: string | null
          probable_cause?: string | null
          remedy?: string | null
          severity?: string | null
          updated_at?: string | null
          verified?: boolean | null
        }
        Relationships: []
      }
      forum_attachments: {
        Row: {
          created_at: string | null
          file_name: string
          file_size_bytes: number | null
          file_type: string | null
          id: number
          post_id: number | null
          public_url: string | null
          storage_path: string
          thread_id: number | null
          uploaded_by: string
        }
        Insert: {
          created_at?: string | null
          file_name: string
          file_size_bytes?: number | null
          file_type?: string | null
          id?: number
          post_id?: number | null
          public_url?: string | null
          storage_path: string
          thread_id?: number | null
          uploaded_by: string
        }
        Update: {
          created_at?: string | null
          file_name?: string
          file_size_bytes?: number | null
          file_type?: string | null
          id?: number
          post_id?: number | null
          public_url?: string | null
          storage_path?: string
          thread_id?: number | null
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "forum_attachments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "forum_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_attachments_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "forum_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      forum_bookmarks: {
        Row: {
          created_at: string | null
          id: number
          thread_id: number
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: number
          thread_id: number
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: number
          thread_id?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "forum_bookmarks_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "forum_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_bookmarks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      forum_categories: {
        Row: {
          created_at: string | null
          description: string | null
          display_order: number | null
          icon: string | null
          id: number
          is_active: boolean | null
          name: string
          slug: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          display_order?: number | null
          icon?: string | null
          id?: number
          is_active?: boolean | null
          name: string
          slug: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          display_order?: number | null
          icon?: string | null
          id?: number
          is_active?: boolean | null
          name?: string
          slug?: string
        }
        Relationships: []
      }
      forum_posts: {
        Row: {
          author_id: string
          body: string
          created_at: string | null
          deleted_at: string | null
          deleted_by: string | null
          edited_at: string | null
          id: number
          is_accepted_answer: boolean | null
          is_deleted: boolean | null
          is_edited: boolean | null
          reaction_count: number | null
          reply_to_post_id: number | null
          thread_id: number
          updated_at: string | null
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          edited_at?: string | null
          id?: number
          is_accepted_answer?: boolean | null
          is_deleted?: boolean | null
          is_edited?: boolean | null
          reaction_count?: number | null
          reply_to_post_id?: number | null
          thread_id: number
          updated_at?: string | null
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          edited_at?: string | null
          id?: number
          is_accepted_answer?: boolean | null
          is_deleted?: boolean | null
          is_edited?: boolean | null
          reaction_count?: number | null
          reply_to_post_id?: number | null
          thread_id?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "forum_posts_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_posts_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_posts_reply_to_post_id_fkey"
            columns: ["reply_to_post_id"]
            isOneToOne: false
            referencedRelation: "forum_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_posts_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "forum_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      forum_reactions: {
        Row: {
          created_at: string | null
          id: number
          post_id: number | null
          reaction_type: string | null
          thread_id: number | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: number
          post_id?: number | null
          reaction_type?: string | null
          thread_id?: number | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: number
          post_id?: number | null
          reaction_type?: string | null
          thread_id?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "forum_reactions_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "forum_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_reactions_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "forum_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_reactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      forum_threads: {
        Row: {
          accepted_post_id: number | null
          author_id: string
          body: string
          category_id: number
          created_at: string | null
          deleted_at: string | null
          deleted_by: string | null
          equipment_make: string | null
          equipment_model: string | null
          id: number
          is_deleted: boolean | null
          is_pinned: boolean | null
          is_solved: boolean | null
          last_post_at: string | null
          last_post_by: string | null
          reaction_count: number | null
          reply_count: number | null
          title: string
          updated_at: string | null
          view_count: number | null
        }
        Insert: {
          accepted_post_id?: number | null
          author_id: string
          body: string
          category_id: number
          created_at?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          equipment_make?: string | null
          equipment_model?: string | null
          id?: number
          is_deleted?: boolean | null
          is_pinned?: boolean | null
          is_solved?: boolean | null
          last_post_at?: string | null
          last_post_by?: string | null
          reaction_count?: number | null
          reply_count?: number | null
          title: string
          updated_at?: string | null
          view_count?: number | null
        }
        Update: {
          accepted_post_id?: number | null
          author_id?: string
          body?: string
          category_id?: number
          created_at?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          equipment_make?: string | null
          equipment_model?: string | null
          id?: number
          is_deleted?: boolean | null
          is_pinned?: boolean | null
          is_solved?: boolean | null
          last_post_at?: string | null
          last_post_by?: string | null
          reaction_count?: number | null
          reply_count?: number | null
          title?: string
          updated_at?: string | null
          view_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_accepted_post"
            columns: ["accepted_post_id"]
            isOneToOne: false
            referencedRelation: "forum_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_threads_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_threads_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "forum_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_threads_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_threads_last_post_by_fkey"
            columns: ["last_post_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_locations: {
        Row: {
          created_at: string | null
          description: string | null
          id: number
          is_active: boolean | null
          location_type: string
          name: string
          organization_id: number | null
          owner_user_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: number
          is_active?: boolean | null
          location_type: string
          name: string
          organization_id?: number | null
          owner_user_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: number
          is_active?: boolean | null
          location_type?: string
          name?: string
          organization_id?: number | null
          owner_user_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_locations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_stock: {
        Row: {
          id: number
          last_restocked: string | null
          location_id: number
          min_quantity: number | null
          notes: string | null
          part_id: number
          quantity: number
          unit_cost: number | null
          updated_at: string | null
        }
        Insert: {
          id?: number
          last_restocked?: string | null
          location_id: number
          min_quantity?: number | null
          notes?: string | null
          part_id: number
          quantity?: number
          unit_cost?: number | null
          updated_at?: string | null
        }
        Update: {
          id?: number
          last_restocked?: string | null
          location_id?: number
          min_quantity?: number | null
          notes?: string | null
          part_id?: number
          quantity?: number
          unit_cost?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_stock_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_stock_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "parts_catalog"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_transactions: {
        Row: {
          created_at: string | null
          from_location_id: number | null
          id: number
          notes: string | null
          part_id: number
          performed_by: string | null
          quantity: number
          reference_id: number | null
          reference_type: string | null
          to_location_id: number | null
          transaction_type: string
          unit_cost: number | null
        }
        Insert: {
          created_at?: string | null
          from_location_id?: number | null
          id?: number
          notes?: string | null
          part_id: number
          performed_by?: string | null
          quantity: number
          reference_id?: number | null
          reference_type?: string | null
          to_location_id?: number | null
          transaction_type: string
          unit_cost?: number | null
        }
        Update: {
          created_at?: string | null
          from_location_id?: number | null
          id?: number
          notes?: string | null
          part_id?: number
          performed_by?: string | null
          quantity?: number
          reference_id?: number | null
          reference_type?: string | null
          to_location_id?: number | null
          transaction_type?: string
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_transactions_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transactions_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "parts_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transactions_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      labor_log: {
        Row: {
          clock_in: string | null
          clock_out: string | null
          created_at: string | null
          duration_minutes: number | null
          engineer_id: string
          id: number
          notes: string | null
          ticket_id: number
        }
        Insert: {
          clock_in?: string | null
          clock_out?: string | null
          created_at?: string | null
          duration_minutes?: number | null
          engineer_id: string
          id?: number
          notes?: string | null
          ticket_id: number
        }
        Update: {
          clock_in?: string | null
          clock_out?: string | null
          created_at?: string | null
          duration_minutes?: number | null
          engineer_id?: string
          id?: number
          notes?: string | null
          ticket_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "labor_log_engineer_id_fkey"
            columns: ["engineer_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "labor_log_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "service_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          address: string | null
          city: string | null
          created_at: string | null
          id: number
          is_primary: boolean | null
          name: string
          organization_id: number
          phone: string | null
          state: string | null
          updated_at: string | null
          zip: string | null
        }
        Insert: {
          address?: string | null
          city?: string | null
          created_at?: string | null
          id?: number
          is_primary?: boolean | null
          name: string
          organization_id: number
          phone?: string | null
          state?: string | null
          updated_at?: string | null
          zip?: string | null
        }
        Update: {
          address?: string | null
          city?: string | null
          created_at?: string | null
          id?: number
          is_primary?: boolean | null
          name?: string
          organization_id?: number
          phone?: string | null
          state?: string | null
          updated_at?: string | null
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "locations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      manuals: {
        Row: {
          brand: string
          chapter_metadata: Json
          created_at: string | null
          doc_kind: string | null
          entry_file_path: string | null
          equipment_type: string
          id: number
          is_folder: boolean
          model: string
          storage_path: string
          tier_required: string | null
          title: string
          xai_collection_id: string | null
        }
        Insert: {
          brand: string
          chapter_metadata?: Json
          created_at?: string | null
          doc_kind?: string | null
          entry_file_path?: string | null
          equipment_type?: string
          id?: never
          is_folder?: boolean
          model: string
          storage_path: string
          tier_required?: string | null
          title: string
          xai_collection_id?: string | null
        }
        Update: {
          brand?: string
          chapter_metadata?: Json
          created_at?: string | null
          doc_kind?: string | null
          entry_file_path?: string | null
          equipment_type?: string
          id?: never
          is_folder?: boolean
          model?: string
          storage_path?: string
          tier_required?: string | null
          title?: string
          xai_collection_id?: string | null
        }
        Relationships: []
      }
      marketplace_conversations: {
        Row: {
          buyer_id: string
          buyer_unread: number | null
          created_at: string | null
          id: string
          last_message: string | null
          last_message_at: string | null
          last_sender_id: string | null
          listing_id: string
          seller_id: string
          seller_unread: number | null
        }
        Insert: {
          buyer_id: string
          buyer_unread?: number | null
          created_at?: string | null
          id?: string
          last_message?: string | null
          last_message_at?: string | null
          last_sender_id?: string | null
          listing_id: string
          seller_id: string
          seller_unread?: number | null
        }
        Update: {
          buyer_id?: string
          buyer_unread?: number | null
          created_at?: string | null
          id?: string
          last_message?: string | null
          last_message_at?: string | null
          last_sender_id?: string | null
          listing_id?: string
          seller_id?: string
          seller_unread?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_conversations_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "marketplace_listings"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_listings: {
        Row: {
          category: string
          city: string | null
          condition: string
          created_at: string | null
          created_by: string | null
          currency: string | null
          description: string | null
          details: Json | null
          id: string
          images: Json | null
          listing_type: string | null
          manufacturer: string | null
          model: string | null
          notes: string | null
          organization_id: number | null
          part_number: string | null
          photos: Json | null
          price: number | null
          price_type: string | null
          qty: number | null
          quantity: number | null
          seller_id: string
          serial_number: string | null
          state: string | null
          status: string | null
          title: string
          updated_at: string | null
          views: number | null
          wavelength: string | null
          year_manufactured: number | null
          zip: string | null
        }
        Insert: {
          category?: string
          city?: string | null
          condition?: string
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          description?: string | null
          details?: Json | null
          id?: string
          images?: Json | null
          listing_type?: string | null
          manufacturer?: string | null
          model?: string | null
          notes?: string | null
          organization_id?: number | null
          part_number?: string | null
          photos?: Json | null
          price?: number | null
          price_type?: string | null
          qty?: number | null
          quantity?: number | null
          seller_id: string
          serial_number?: string | null
          state?: string | null
          status?: string | null
          title: string
          updated_at?: string | null
          views?: number | null
          wavelength?: string | null
          year_manufactured?: number | null
          zip?: string | null
        }
        Update: {
          category?: string
          city?: string | null
          condition?: string
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          description?: string | null
          details?: Json | null
          id?: string
          images?: Json | null
          listing_type?: string | null
          manufacturer?: string | null
          model?: string | null
          notes?: string | null
          organization_id?: number | null
          part_number?: string | null
          photos?: Json | null
          price?: number | null
          price_type?: string | null
          qty?: number | null
          quantity?: number | null
          seller_id?: string
          serial_number?: string | null
          state?: string | null
          status?: string | null
          title?: string
          updated_at?: string | null
          views?: number | null
          wavelength?: string | null
          year_manufactured?: number | null
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_listings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_messages: {
        Row: {
          body: string
          conversation_id: string
          created_at: string | null
          id: string
          read: boolean | null
          sender_id: string
        }
        Insert: {
          body: string
          conversation_id: string
          created_at?: string | null
          id?: string
          read?: boolean | null
          sender_id: string
        }
        Update: {
          body?: string
          conversation_id?: string
          created_at?: string | null
          id?: string
          read?: boolean | null
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "marketplace_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_parts: {
        Row: {
          condition: string | null
          created_at: string | null
          created_by: string | null
          data: Json | null
          id: number
          images: Json | null
          price: number | null
          status: string | null
          type: string | null
          updated_at: string | null
        }
        Insert: {
          condition?: string | null
          created_at?: string | null
          created_by?: string | null
          data?: Json | null
          id?: number
          images?: Json | null
          price?: number | null
          status?: string | null
          type?: string | null
          updated_at?: string | null
        }
        Update: {
          condition?: string | null
          created_at?: string | null
          created_by?: string | null
          data?: Json | null
          id?: number
          images?: Json | null
          price?: number | null
          status?: string | null
          type?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      marketplace_requests: {
        Row: {
          created_at: string | null
          created_by: string | null
          description: string | null
          error_codes: string | null
          id: number
          images: Json | null
          location_id: number | null
          manufacturer: string | null
          model: string | null
          organization_id: number | null
          preferred_date: string | null
          serial_number: string | null
          status: string | null
          title: string
          updated_at: string | null
          urgency: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          error_codes?: string | null
          id?: number
          images?: Json | null
          location_id?: number | null
          manufacturer?: string | null
          model?: string | null
          organization_id?: number | null
          preferred_date?: string | null
          serial_number?: string | null
          status?: string | null
          title: string
          updated_at?: string | null
          urgency?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          error_codes?: string | null
          id?: number
          images?: Json | null
          location_id?: number | null
          manufacturer?: string | null
          model?: string | null
          organization_id?: number | null
          preferred_date?: string | null
          serial_number?: string | null
          status?: string | null
          title?: string
          updated_at?: string | null
          urgency?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_requests_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_used_systems: {
        Row: {
          condition: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          id: number
          images: Json | null
          manufacturer: string
          model: string
          price: number | null
          serial_number: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          condition?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: number
          images?: Json | null
          manufacturer: string
          model: string
          price?: number | null
          serial_number?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          condition?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: number
          images?: Json | null
          manufacturer?: string
          model?: string
          price?: number | null
          serial_number?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string | null
          id: number
          is_read: boolean | null
          message: string | null
          post_id: number | null
          read_at: string | null
          thread_id: number | null
          ticket_id: number | null
          triggered_by: string | null
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: number
          is_read?: boolean | null
          message?: string | null
          post_id?: number | null
          read_at?: string | null
          thread_id?: number | null
          ticket_id?: number | null
          triggered_by?: string | null
          type: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: number
          is_read?: boolean | null
          message?: string | null
          post_id?: number | null
          read_at?: string | null
          thread_id?: number | null
          ticket_id?: number | null
          triggered_by?: string | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "forum_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "forum_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "service_tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_triggered_by_fkey"
            columns: ["triggered_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_customers: {
        Row: {
          created_at: string | null
          created_by: string | null
          customer_organization_id: number
          first_service_date: string | null
          id: number
          notes: string | null
          service_organization_id: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          customer_organization_id: number
          first_service_date?: string | null
          id?: number
          notes?: string | null
          service_organization_id: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          customer_organization_id?: number
          first_service_date?: string | null
          id?: number
          notes?: string | null
          service_organization_id?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_customers_customer_organization_id_fkey"
            columns: ["customer_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_customers_service_organization_id_fkey"
            columns: ["service_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          address: string | null
          biz_type: string | null
          city: string | null
          created_at: string | null
          created_by: string | null
          customer_rating: number | null
          description: string | null
          email: string | null
          facebook_url: string | null
          facility_type: string | null
          id: number
          instagram_url: string | null
          is_active: boolean | null
          is_premium: boolean | null
          laser_models: string | null
          linkedin_url: string | null
          logo_url: string | null
          name: string
          notes: string | null
          num_laser_systems: number | null
          num_techs: number | null
          phone: string | null
          preferred_services: string | null
          service_territories: string[] | null
          services_offered: string | null
          specialties: string[] | null
          state: string | null
          supported_brands: string[] | null
          tax_id: string | null
          threads_url: string | null
          ticket_prefix: string | null
          tiktok_url: string | null
          type: string
          updated_at: string | null
          website: string | null
          x_url: string | null
          years_in_business: number | null
          yelp_url: string | null
          youtube_url: string | null
          zip: string | null
        }
        Insert: {
          address?: string | null
          biz_type?: string | null
          city?: string | null
          created_at?: string | null
          created_by?: string | null
          customer_rating?: number | null
          description?: string | null
          email?: string | null
          facebook_url?: string | null
          facility_type?: string | null
          id?: number
          instagram_url?: string | null
          is_active?: boolean | null
          is_premium?: boolean | null
          laser_models?: string | null
          linkedin_url?: string | null
          logo_url?: string | null
          name: string
          notes?: string | null
          num_laser_systems?: number | null
          num_techs?: number | null
          phone?: string | null
          preferred_services?: string | null
          service_territories?: string[] | null
          services_offered?: string | null
          specialties?: string[] | null
          state?: string | null
          supported_brands?: string[] | null
          tax_id?: string | null
          threads_url?: string | null
          ticket_prefix?: string | null
          tiktok_url?: string | null
          type: string
          updated_at?: string | null
          website?: string | null
          x_url?: string | null
          years_in_business?: number | null
          yelp_url?: string | null
          youtube_url?: string | null
          zip?: string | null
        }
        Update: {
          address?: string | null
          biz_type?: string | null
          city?: string | null
          created_at?: string | null
          created_by?: string | null
          customer_rating?: number | null
          description?: string | null
          email?: string | null
          facebook_url?: string | null
          facility_type?: string | null
          id?: number
          instagram_url?: string | null
          is_active?: boolean | null
          is_premium?: boolean | null
          laser_models?: string | null
          linkedin_url?: string | null
          logo_url?: string | null
          name?: string
          notes?: string | null
          num_laser_systems?: number | null
          num_techs?: number | null
          phone?: string | null
          preferred_services?: string | null
          service_territories?: string[] | null
          services_offered?: string | null
          specialties?: string[] | null
          state?: string | null
          supported_brands?: string[] | null
          tax_id?: string | null
          threads_url?: string | null
          ticket_prefix?: string | null
          tiktok_url?: string | null
          type?: string
          updated_at?: string | null
          website?: string | null
          x_url?: string | null
          years_in_business?: number | null
          yelp_url?: string | null
          youtube_url?: string | null
          zip?: string | null
        }
        Relationships: []
      }
      part_vendors: {
        Row: {
          created_at: string | null
          currency: string | null
          id: number
          is_active: boolean | null
          is_preferred: boolean | null
          lead_time_days: number | null
          notes: string | null
          part_id: number
          unit_cost: number | null
          updated_at: string | null
          url: string | null
          vendor_name: string
          vendor_part_number: string | null
        }
        Insert: {
          created_at?: string | null
          currency?: string | null
          id?: number
          is_active?: boolean | null
          is_preferred?: boolean | null
          lead_time_days?: number | null
          notes?: string | null
          part_id: number
          unit_cost?: number | null
          updated_at?: string | null
          url?: string | null
          vendor_name: string
          vendor_part_number?: string | null
        }
        Update: {
          created_at?: string | null
          currency?: string | null
          id?: number
          is_active?: boolean | null
          is_preferred?: boolean | null
          lead_time_days?: number | null
          notes?: string | null
          part_id?: number
          unit_cost?: number | null
          updated_at?: string | null
          url?: string | null
          vendor_name?: string
          vendor_part_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "part_vendors_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "parts_catalog"
            referencedColumns: ["id"]
          },
        ]
      }
      parts: {
        Row: {
          category: string | null
          compatible_with: string[] | null
          created_at: string | null
          description: string | null
          id: number
          image_url: string | null
          is_active: boolean | null
          location: string | null
          manufacturer: string | null
          min_stock_level: number | null
          name: string
          notes: string | null
          part_number: string
          quantity_on_hand: number | null
          unit_cost: number | null
          updated_at: string | null
          vendor: string | null
          vendor_part_num: string | null
        }
        Insert: {
          category?: string | null
          compatible_with?: string[] | null
          created_at?: string | null
          description?: string | null
          id?: number
          image_url?: string | null
          is_active?: boolean | null
          location?: string | null
          manufacturer?: string | null
          min_stock_level?: number | null
          name: string
          notes?: string | null
          part_number: string
          quantity_on_hand?: number | null
          unit_cost?: number | null
          updated_at?: string | null
          vendor?: string | null
          vendor_part_num?: string | null
        }
        Update: {
          category?: string | null
          compatible_with?: string[] | null
          created_at?: string | null
          description?: string | null
          id?: number
          image_url?: string | null
          is_active?: boolean | null
          location?: string | null
          manufacturer?: string | null
          min_stock_level?: number | null
          name?: string
          notes?: string | null
          part_number?: string
          quantity_on_hand?: number | null
          unit_cost?: number | null
          updated_at?: string | null
          vendor?: string | null
          vendor_part_num?: string | null
        }
        Relationships: []
      }
      parts_catalog: {
        Row: {
          brand: string
          category: string
          compatible_models: string[] | null
          created_at: string | null
          created_by: string | null
          description: string | null
          id: number
          image_url: string | null
          in_stock: boolean
          is_active: boolean | null
          is_consumable: boolean | null
          name: string
          part_number: string
          quantity_on_hand: number
          sale_price: number | null
          unit_of_measure: string | null
          updated_at: string | null
        }
        Insert: {
          brand: string
          category: string
          compatible_models?: string[] | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: number
          image_url?: string | null
          in_stock?: boolean
          is_active?: boolean | null
          is_consumable?: boolean | null
          name: string
          part_number: string
          quantity_on_hand?: number
          sale_price?: number | null
          unit_of_measure?: string | null
          updated_at?: string | null
        }
        Update: {
          brand?: string
          category?: string
          compatible_models?: string[] | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: number
          image_url?: string | null
          in_stock?: boolean
          is_active?: boolean | null
          is_consumable?: boolean | null
          name?: string
          part_number?: string
          quantity_on_hand?: number
          sale_price?: number | null
          unit_of_measure?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      parts_used: {
        Row: {
          created_at: string | null
          id: number
          notes: string | null
          part_id: number | null
          part_name: string | null
          part_number: string | null
          quantity: number
          ticket_id: number
          unit_cost: number | null
        }
        Insert: {
          created_at?: string | null
          id?: number
          notes?: string | null
          part_id?: number | null
          part_name?: string | null
          part_number?: string | null
          quantity?: number
          ticket_id: number
          unit_cost?: number | null
        }
        Update: {
          created_at?: string | null
          id?: number
          notes?: string | null
          part_id?: number | null
          part_name?: string | null
          part_number?: string | null
          quantity?: number
          ticket_id?: number
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "parts_used_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "parts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_used_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "service_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      service_contracts: {
        Row: {
          contractor_org_id: number | null
          contractor_user_id: string | null
          created_at: string | null
          end_date: string | null
          id: string
          request_id: string | null
          start_date: string | null
          status: string | null
          terms: string | null
          winning_bid_id: string | null
        }
        Insert: {
          contractor_org_id?: number | null
          contractor_user_id?: string | null
          created_at?: string | null
          end_date?: string | null
          id?: string
          request_id?: string | null
          start_date?: string | null
          status?: string | null
          terms?: string | null
          winning_bid_id?: string | null
        }
        Update: {
          contractor_org_id?: number | null
          contractor_user_id?: string | null
          created_at?: string | null
          end_date?: string | null
          id?: string
          request_id?: string | null
          start_date?: string | null
          status?: string | null
          terms?: string | null
          winning_bid_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "service_contracts_contractor_org_id_fkey"
            columns: ["contractor_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_contracts_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "service_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_contracts_winning_bid_id_fkey"
            columns: ["winning_bid_id"]
            isOneToOne: false
            referencedRelation: "bids"
            referencedColumns: ["id"]
          },
        ]
      }
      service_reports: {
        Row: {
          checklist_aesthetic: Json | null
          checklist_electrical: Json | null
          checklist_mechanical: Json | null
          comments: string | null
          created_at: string | null
          created_by: string | null
          customer_address: string | null
          customer_city: string | null
          customer_contact_name: string | null
          customer_email: string | null
          customer_name: string | null
          customer_organization_id: number | null
          customer_phone: string | null
          customer_state: string | null
          date_out: string | null
          equipment_id: number | null
          equipment_name: string | null
          finalized_at: string | null
          finalized_by: string | null
          ground_resistance: number | null
          ground_resistance_pass: boolean | null
          id: string
          leakage_current: number | null
          leakage_current_pass: boolean | null
          model_parameters: Json | null
          model_type: string
          next_pm_due: string | null
          organization_id: number | null
          pdf_url: string | null
          power_measurements: Json | null
          report_number: string | null
          serial_number: string | null
          service_engineer: string | null
          service_type: string | null
          signed_date: string | null
          sku: string | null
          status: string
          tech_company_address: string | null
          tech_company_city: string | null
          tech_company_logo_url: string | null
          tech_company_name: string | null
          tech_company_phone: string | null
          tech_company_state: string | null
          tech_email: string | null
          tech_name: string | null
          tech_phone: string | null
          tech_signature: string | null
          test_equipment: Json | null
          ticket_id: string | null
          ticket_number: string | null
          updated_at: string | null
        }
        Insert: {
          checklist_aesthetic?: Json | null
          checklist_electrical?: Json | null
          checklist_mechanical?: Json | null
          comments?: string | null
          created_at?: string | null
          created_by?: string | null
          customer_address?: string | null
          customer_city?: string | null
          customer_contact_name?: string | null
          customer_email?: string | null
          customer_name?: string | null
          customer_organization_id?: number | null
          customer_phone?: string | null
          customer_state?: string | null
          date_out?: string | null
          equipment_id?: number | null
          equipment_name?: string | null
          finalized_at?: string | null
          finalized_by?: string | null
          ground_resistance?: number | null
          ground_resistance_pass?: boolean | null
          id?: string
          leakage_current?: number | null
          leakage_current_pass?: boolean | null
          model_parameters?: Json | null
          model_type: string
          next_pm_due?: string | null
          organization_id?: number | null
          pdf_url?: string | null
          power_measurements?: Json | null
          report_number?: string | null
          serial_number?: string | null
          service_engineer?: string | null
          service_type?: string | null
          signed_date?: string | null
          sku?: string | null
          status?: string
          tech_company_address?: string | null
          tech_company_city?: string | null
          tech_company_logo_url?: string | null
          tech_company_name?: string | null
          tech_company_phone?: string | null
          tech_company_state?: string | null
          tech_email?: string | null
          tech_name?: string | null
          tech_phone?: string | null
          tech_signature?: string | null
          test_equipment?: Json | null
          ticket_id?: string | null
          ticket_number?: string | null
          updated_at?: string | null
        }
        Update: {
          checklist_aesthetic?: Json | null
          checklist_electrical?: Json | null
          checklist_mechanical?: Json | null
          comments?: string | null
          created_at?: string | null
          created_by?: string | null
          customer_address?: string | null
          customer_city?: string | null
          customer_contact_name?: string | null
          customer_email?: string | null
          customer_name?: string | null
          customer_organization_id?: number | null
          customer_phone?: string | null
          customer_state?: string | null
          date_out?: string | null
          equipment_id?: number | null
          equipment_name?: string | null
          finalized_at?: string | null
          finalized_by?: string | null
          ground_resistance?: number | null
          ground_resistance_pass?: boolean | null
          id?: string
          leakage_current?: number | null
          leakage_current_pass?: boolean | null
          model_parameters?: Json | null
          model_type?: string
          next_pm_due?: string | null
          organization_id?: number | null
          pdf_url?: string | null
          power_measurements?: Json | null
          report_number?: string | null
          serial_number?: string | null
          service_engineer?: string | null
          service_type?: string | null
          signed_date?: string | null
          sku?: string | null
          status?: string
          tech_company_address?: string | null
          tech_company_city?: string | null
          tech_company_logo_url?: string | null
          tech_company_name?: string | null
          tech_company_phone?: string | null
          tech_company_state?: string | null
          tech_email?: string | null
          tech_name?: string | null
          tech_phone?: string | null
          tech_signature?: string | null
          test_equipment?: Json | null
          ticket_id?: string | null
          ticket_number?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "service_reports_customer_organization_id_fkey"
            columns: ["customer_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_reports_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment"
            referencedColumns: ["id"]
          },
        ]
      }
      service_requests: {
        Row: {
          budget_max: number | null
          budget_min: number | null
          city: string | null
          created_at: string | null
          deadline: string | null
          description: string | null
          id: string
          location: string | null
          model_type: string | null
          organization_id: number | null
          posted_by: string | null
          service_type: string | null
          state: string | null
          status: string | null
          title: string
          updated_at: string | null
          urgency: string | null
        }
        Insert: {
          budget_max?: number | null
          budget_min?: number | null
          city?: string | null
          created_at?: string | null
          deadline?: string | null
          description?: string | null
          id?: string
          location?: string | null
          model_type?: string | null
          organization_id?: number | null
          posted_by?: string | null
          service_type?: string | null
          state?: string | null
          status?: string | null
          title: string
          updated_at?: string | null
          urgency?: string | null
        }
        Update: {
          budget_max?: number | null
          budget_min?: number | null
          city?: string | null
          created_at?: string | null
          deadline?: string | null
          description?: string | null
          id?: string
          location?: string | null
          model_type?: string | null
          organization_id?: number | null
          posted_by?: string | null
          service_type?: string | null
          state?: string | null
          status?: string | null
          title?: string
          updated_at?: string | null
          urgency?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "service_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      service_ticket_status_history: {
        Row: {
          changed_at: string | null
          changed_by: string | null
          id: number
          new_status: string | null
          old_status: string | null
          ticket_id: number | null
        }
        Insert: {
          changed_at?: string | null
          changed_by?: string | null
          id?: number
          new_status?: string | null
          old_status?: string | null
          ticket_id?: number | null
        }
        Update: {
          changed_at?: string | null
          changed_by?: string | null
          id?: number
          new_status?: string | null
          old_status?: string | null
          ticket_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "service_ticket_status_history_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "service_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      service_tickets: {
        Row: {
          address: string | null
          arrival_time: string | null
          assigned_fse: string | null
          assigned_to: string | null
          billable: boolean | null
          city: string | null
          contact_id: number | null
          contract_number: string | null
          created_at: string | null
          customer_address: string | null
          customer_city: string | null
          customer_email: string | null
          customer_name: string
          customer_phone: string | null
          customer_state: string | null
          departure_time: string | null
          description: string | null
          end_time: string | null
          equipment_id: number | null
          equipment_make: string | null
          equipment_model: string | null
          equipment_type: string | null
          id: number
          notes: string | null
          organization_id: number | null
          po_number: string | null
          priority: string | null
          scheduled_time: string | null
          serial_number: string | null
          service_date: string | null
          service_type: string | null
          site_id: number | null
          state: string | null
          status: string | null
          ticket_number: string
          updated_at: string | null
          zip: string | null
        }
        Insert: {
          address?: string | null
          arrival_time?: string | null
          assigned_fse?: string | null
          assigned_to?: string | null
          billable?: boolean | null
          city?: string | null
          contact_id?: number | null
          contract_number?: string | null
          created_at?: string | null
          customer_address?: string | null
          customer_city?: string | null
          customer_email?: string | null
          customer_name: string
          customer_phone?: string | null
          customer_state?: string | null
          departure_time?: string | null
          description?: string | null
          end_time?: string | null
          equipment_id?: number | null
          equipment_make?: string | null
          equipment_model?: string | null
          equipment_type?: string | null
          id?: number
          notes?: string | null
          organization_id?: number | null
          po_number?: string | null
          priority?: string | null
          scheduled_time?: string | null
          serial_number?: string | null
          service_date?: string | null
          service_type?: string | null
          site_id?: number | null
          state?: string | null
          status?: string | null
          ticket_number: string
          updated_at?: string | null
          zip?: string | null
        }
        Update: {
          address?: string | null
          arrival_time?: string | null
          assigned_fse?: string | null
          assigned_to?: string | null
          billable?: boolean | null
          city?: string | null
          contact_id?: number | null
          contract_number?: string | null
          created_at?: string | null
          customer_address?: string | null
          customer_city?: string | null
          customer_email?: string | null
          customer_name?: string
          customer_phone?: string | null
          customer_state?: string | null
          departure_time?: string | null
          description?: string | null
          end_time?: string | null
          equipment_id?: number | null
          equipment_make?: string | null
          equipment_model?: string | null
          equipment_type?: string | null
          id?: number
          notes?: string | null
          organization_id?: number | null
          po_number?: string | null
          priority?: string | null
          scheduled_time?: string | null
          serial_number?: string | null
          service_date?: string | null
          service_type?: string | null
          site_id?: number | null
          state?: string | null
          status?: string | null
          ticket_number?: string
          updated_at?: string | null
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "service_tickets_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_tickets_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_tickets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_tickets_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      sites: {
        Row: {
          access_notes: string | null
          address: string | null
          city: string | null
          created_at: string | null
          id: number
          is_active: boolean | null
          lat: number | null
          lng: number | null
          name: string
          notes: string | null
          organization_id: number
          state: string | null
          updated_at: string | null
          zip: string | null
        }
        Insert: {
          access_notes?: string | null
          address?: string | null
          city?: string | null
          created_at?: string | null
          id?: number
          is_active?: boolean | null
          lat?: number | null
          lng?: number | null
          name: string
          notes?: string | null
          organization_id: number
          state?: string | null
          updated_at?: string | null
          zip?: string | null
        }
        Update: {
          access_notes?: string | null
          address?: string | null
          city?: string | null
          created_at?: string | null
          id?: number
          is_active?: boolean | null
          lat?: number | null
          lng?: number | null
          name?: string
          notes?: string | null
          organization_id?: number
          state?: string | null
          updated_at?: string | null
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sites_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_customers: {
        Row: {
          created_at: string | null
          email: string | null
          id: string
          stripe_customer_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          id?: string
          stripe_customer_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          email?: string | null
          id?: string
          stripe_customer_id?: string
          user_id?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean | null
          created_at: string | null
          current_period_end: string | null
          current_period_start: string | null
          expires_at: string | null
          id: string
          organization_id: number | null
          package_name: string | null
          platform: string | null
          purchase_token: string | null
          seat_count: number | null
          sku: string | null
          status: string
          stripe_price_id: string | null
          stripe_product_id: string | null
          stripe_subscription_id: string | null
          subscription_type: string | null
          tier: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean | null
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          expires_at?: string | null
          id?: string
          organization_id?: number | null
          package_name?: string | null
          platform?: string | null
          purchase_token?: string | null
          seat_count?: number | null
          sku?: string | null
          status?: string
          stripe_price_id?: string | null
          stripe_product_id?: string | null
          stripe_subscription_id?: string | null
          subscription_type?: string | null
          tier?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean | null
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          expires_at?: string | null
          id?: string
          organization_id?: number | null
          package_name?: string | null
          platform?: string | null
          purchase_token?: string | null
          seat_count?: number | null
          sku?: string | null
          status?: string
          stripe_price_id?: string | null
          stripe_product_id?: string | null
          stripe_subscription_id?: string | null
          subscription_type?: string | null
          tier?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      test_equipment: {
        Row: {
          asset_tag: string | null
          assigned_to_fse: string | null
          cal_date: string | null
          cal_due: string | null
          cal_lab: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          make: string | null
          model: string | null
          notes: string | null
          organization_id: number | null
          owned_by: string | null
          serial_number: string | null
          type: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          asset_tag?: string | null
          assigned_to_fse?: string | null
          cal_date?: string | null
          cal_due?: string | null
          cal_lab?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          make?: string | null
          model?: string | null
          notes?: string | null
          organization_id?: number | null
          owned_by?: string | null
          serial_number?: string | null
          type: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          asset_tag?: string | null
          assigned_to_fse?: string | null
          cal_date?: string | null
          cal_due?: string | null
          cal_lab?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          make?: string | null
          model?: string | null
          notes?: string | null
          organization_id?: number | null
          owned_by?: string | null
          serial_number?: string | null
          type?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_manuals: {
        Row: {
          id: number
          manual_id: number
          saved_at: string | null
          user_id: string
        }
        Insert: {
          id?: never
          manual_id: number
          saved_at?: string | null
          user_id: string
        }
        Update: {
          id?: never
          manual_id?: number
          saved_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_manuals_manual_id_fkey"
            columns: ["manual_id"]
            isOneToOne: false
            referencedRelation: "manuals"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_memberships: {
        Row: {
          created_at: string
          id: number
          is_home: boolean
          organization_id: number
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: number
          is_home?: boolean
          organization_id: number
          role?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: number
          is_home?: boolean
          organization_id?: number
          role?: string
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
      user_profiles: {
        Row: {
          address_line1: string | null
          avatar_url: string | null
          bio: string | null
          certifications: string[] | null
          city: string | null
          created_at: string | null
          email: string | null
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          employee_id: string | null
          experience_years: number | null
          first_name: string | null
          id: string
          is_active: boolean | null
          job_title: string | null
          last_name: string | null
          linkedin_url: string | null
          manual_slots: number | null
          notification_prefs: Json | null
          onboarding_completed: boolean | null
          onboarding_completed_at: string | null
          organization_id: number | null
          active_organization_id: number | null
          phone: string | null
          postal_code: string | null
          preferred_regions: string | null
          role: string | null
          state: string | null
          territory: string | null
          updated_at: string | null
          website: string | null
        }
        Insert: {
          address_line1?: string | null
          avatar_url?: string | null
          bio?: string | null
          certifications?: string[] | null
          city?: string | null
          created_at?: string | null
          email?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          employee_id?: string | null
          experience_years?: number | null
          first_name?: string | null
          id: string
          is_active?: boolean | null
          job_title?: string | null
          last_name?: string | null
          linkedin_url?: string | null
          manual_slots?: number | null
          notification_prefs?: Json | null
          onboarding_completed?: boolean | null
          onboarding_completed_at?: string | null
          organization_id?: number | null
          active_organization_id?: number | null
          phone?: string | null
          postal_code?: string | null
          preferred_regions?: string | null
          role?: string | null
          state?: string | null
          territory?: string | null
          updated_at?: string | null
          website?: string | null
        }
        Update: {
          address_line1?: string | null
          avatar_url?: string | null
          bio?: string | null
          certifications?: string[] | null
          city?: string | null
          created_at?: string | null
          email?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          employee_id?: string | null
          experience_years?: number | null
          first_name?: string | null
          id?: string
          is_active?: boolean | null
          job_title?: string | null
          last_name?: string | null
          linkedin_url?: string | null
          manual_slots?: number | null
          notification_prefs?: Json | null
          onboarding_completed?: boolean | null
          onboarding_completed_at?: string | null
          organization_id?: number | null
          active_organization_id?: number | null
          phone?: string | null
          postal_code?: string | null
          preferred_regions?: string | null
          role?: string | null
          state?: string | null
          territory?: string | null
          updated_at?: string | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      waitlist: {
        Row: {
          created_at: string | null
          email: string
          id: string
          plan: string | null
        }
        Insert: {
          created_at?: string | null
          email: string
          id?: string
          plan?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string
          id?: string
          plan?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      generate_ticket_number:
        | {
            Args: { org_id: number }
            Returns: {
              error: true
            } & "Could not choose the best candidate function between: public.generate_ticket_number(org_id => int8), public.generate_ticket_number(org_id => uuid). Try renaming the parameters or the function itself in the database so function overloading can be resolved"
          }
        | {
            Args: { org_id: string }
            Returns: {
              error: true
            } & "Could not choose the best candidate function between: public.generate_ticket_number(org_id => int8), public.generate_ticket_number(org_id => uuid). Try renaming the parameters or the function itself in the database so function overloading can be resolved"
          }
      get_my_org_id: { Args: never; Returns: number }
      is_admin: { Args: never; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
