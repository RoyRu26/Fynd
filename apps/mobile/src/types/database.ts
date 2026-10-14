export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      conversations: {
        Row: {
          buyer_id: string
          buyer_last_read_at: string | null
          created_at: string
          id: string
          last_message_at: string
          last_message_body: string | null
          last_message_sender_id: string | null
          listing_id: string
          seller_id: string
          seller_last_read_at: string | null
        }
        Insert: {
          buyer_id: string
          buyer_last_read_at?: string | null
          created_at?: string
          id?: string
          last_message_at?: string
          last_message_body?: string | null
          last_message_sender_id?: string | null
          listing_id: string
          seller_id: string
          seller_last_read_at?: string | null
        }
        Update: {
          buyer_id?: string
          buyer_last_read_at?: string | null
          created_at?: string
          id?: string
          last_message_at?: string
          last_message_body?: string | null
          last_message_sender_id?: string | null
          listing_id?: string
          seller_id?: string
          seller_last_read_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversations_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_last_message_sender_id_fkey"
            columns: ["last_message_sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      favorites: {
        Row: {
          created_at: string
          listing_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          listing_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          listing_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "favorites_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_events: {
        Row: {
          created_at: string
          event_type: Database["public"]["Enums"]["listing_event_type"]
          feed_position: number | null
          id: number
          listing_id: string
          session_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_type: Database["public"]["Enums"]["listing_event_type"]
          feed_position?: number | null
          id?: never
          listing_id: string
          session_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_type?: Database["public"]["Enums"]["listing_event_type"]
          feed_position?: number | null
          id?: never
          listing_id?: string
          session_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_events_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_images: {
        Row: {
          created_at: string
          id: string
          listing_id: string
          position: number
          storage_path: string
        }
        Insert: {
          created_at?: string
          id?: string
          listing_id: string
          position: number
          storage_path: string
        }
        Update: {
          created_at?: string
          id?: string
          listing_id?: string
          position?: number
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_images_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      listings: {
        Row: {
          condition: Database["public"]["Enums"]["listing_condition"] | null
          created_at: string
          currency: string
          description: string
          id: string
          price_amount: number | null
          seller_id: string
          size: Database["public"]["Enums"]["listing_size"] | null
          status: Database["public"]["Enums"]["listing_status"]
          title: string | null
          updated_at: string
        }
        Insert: {
          condition?: Database["public"]["Enums"]["listing_condition"] | null
          created_at?: string
          currency?: string
          description?: string
          id?: string
          price_amount?: number | null
          seller_id: string
          size?: Database["public"]["Enums"]["listing_size"] | null
          status?: Database["public"]["Enums"]["listing_status"]
          title?: string | null
          updated_at?: string
        }
        Update: {
          condition?: Database["public"]["Enums"]["listing_condition"] | null
          created_at?: string
          currency?: string
          description?: string
          id?: string
          price_amount?: number | null
          seller_id?: string
          size?: Database["public"]["Enums"]["listing_size"] | null
          status?: Database["public"]["Enums"]["listing_status"]
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "listings_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string
          client_nonce: string
          conversation_id: string
          created_at: string
          id: string
          sender_id: string
        }
        Insert: {
          body: string
          client_nonce: string
          conversation_id: string
          created_at?: string
          id?: string
          sender_id: string
        }
        Update: {
          body?: string
          client_nonce?: string
          conversation_id?: string
          created_at?: string
          id?: string
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_path: string | null
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
          username: string | null
        }
        Insert: {
          avatar_path?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
          username?: string | null
        }
        Update: {
          avatar_path?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          username?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      attach_listing_image: {
        Args: { p_listing_id: string; p_storage_path: string }
        Returns: {
          created_at: string
          id: string
          listing_id: string
          position: number
          storage_path: string
        }
        SetofOptions: {
          from: "*"
          to: "listing_images"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      conversation_detail: {
        Args: { p_conversation_id: string }
        Returns: {
          conversation_id: string
          cover_storage_path: string
          listing_id: string
          listing_status: Database["public"]["Enums"]["listing_status"]
          listing_title: string
          other_avatar_path: string
          other_display_name: string
          other_participant_id: string
          other_username: string
        }[]
      }
      conversation_messages: {
        Args: {
          p_conversation_id: string
          p_cursor_created_at?: string
          p_cursor_id?: string
          p_limit?: number
        }
        Returns: {
          body: string
          client_nonce: string
          conversation_id: string
          created_at: string
          id: string
          sender_id: string
        }[]
      }
      feed_listings: {
        Args: {
          p_cursor_created_at?: string
          p_cursor_id?: string
          p_include_own?: boolean
          p_limit?: number
        }
        Returns: {
          condition: Database["public"]["Enums"]["listing_condition"]
          cover_storage_path: string
          created_at: string
          currency: string
          is_favorited: boolean
          listing_id: string
          price_amount: number
          seller_avatar_path: string
          seller_display_name: string
          seller_id: string
          seller_username: string
          size: Database["public"]["Enums"]["listing_size"]
          title: string
        }[]
      }
      get_or_create_listing_conversation: {
        Args: { p_listing_id: string }
        Returns: string
      }
      inbox_conversations: {
        Args: {
          p_cursor_id?: string
          p_cursor_last_message_at?: string
          p_limit?: number
        }
        Returns: {
          conversation_id: string
          cover_storage_path: string
          last_message_at: string
          last_message_body: string
          last_message_sender_id: string
          listing_id: string
          listing_status: Database["public"]["Enums"]["listing_status"]
          listing_title: string
          other_avatar_path: string
          other_display_name: string
          other_participant_id: string
          other_username: string
          unread_count: number
        }[]
      }
      inbox_unread_count: { Args: never; Returns: number }
      mark_conversation_read: {
        Args: { p_conversation_id: string; p_up_to?: string }
        Returns: undefined
      }
      mark_listing_active: {
        Args: { p_listing_id: string }
        Returns: {
          condition: Database["public"]["Enums"]["listing_condition"] | null
          created_at: string
          currency: string
          description: string
          id: string
          price_amount: number | null
          seller_id: string
          size: Database["public"]["Enums"]["listing_size"] | null
          status: Database["public"]["Enums"]["listing_status"]
          title: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "listings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mark_listing_reserved: {
        Args: { p_listing_id: string }
        Returns: {
          condition: Database["public"]["Enums"]["listing_condition"] | null
          created_at: string
          currency: string
          description: string
          id: string
          price_amount: number | null
          seller_id: string
          size: Database["public"]["Enums"]["listing_size"] | null
          status: Database["public"]["Enums"]["listing_status"]
          title: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "listings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mark_listing_sold: {
        Args: { p_listing_id: string }
        Returns: {
          condition: Database["public"]["Enums"]["listing_condition"] | null
          created_at: string
          currency: string
          description: string
          id: string
          price_amount: number | null
          seller_id: string
          size: Database["public"]["Enums"]["listing_size"] | null
          status: Database["public"]["Enums"]["listing_status"]
          title: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "listings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      publish_listing: {
        Args: { p_listing_id: string }
        Returns: {
          condition: Database["public"]["Enums"]["listing_condition"] | null
          created_at: string
          currency: string
          description: string
          id: string
          price_amount: number | null
          seller_id: string
          size: Database["public"]["Enums"]["listing_size"] | null
          status: Database["public"]["Enums"]["listing_status"]
          title: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "listings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_listing_impression: {
        Args: {
          p_feed_position?: number
          p_listing_id: string
          p_session_id: string
        }
        Returns: undefined
      }
      remove_listing: {
        Args: { p_listing_id: string }
        Returns: {
          condition: Database["public"]["Enums"]["listing_condition"] | null
          created_at: string
          currency: string
          description: string
          id: string
          price_amount: number | null
          seller_id: string
          size: Database["public"]["Enums"]["listing_size"] | null
          status: Database["public"]["Enums"]["listing_status"]
          title: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "listings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_listing_image_order: {
        Args: { p_image_ids: string[]; p_listing_id: string }
        Returns: undefined
      }
      update_listing_details: {
        Args: {
          p_condition: Database["public"]["Enums"]["listing_condition"]
          p_description: string
          p_listing_id: string
          p_price_amount: number
          p_size: Database["public"]["Enums"]["listing_size"]
          p_title: string
        }
        Returns: {
          condition: Database["public"]["Enums"]["listing_condition"] | null
          created_at: string
          currency: string
          description: string
          id: string
          price_amount: number | null
          seller_id: string
          size: Database["public"]["Enums"]["listing_size"] | null
          status: Database["public"]["Enums"]["listing_status"]
          title: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "listings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      listing_condition: "new" | "like_new" | "very_good" | "good" | "fair"
      listing_event_type: "impression" | "open" | "favorite" | "unfavorite"
      listing_size:
        | "one_size"
        | "alpha_xxs"
        | "alpha_xs"
        | "alpha_s"
        | "alpha_m"
        | "alpha_l"
        | "alpha_xl"
        | "alpha_xxl"
        | "alpha_xxxl"
        | "eu_shoe_35"
        | "eu_shoe_36"
        | "eu_shoe_37"
        | "eu_shoe_38"
        | "eu_shoe_39"
        | "eu_shoe_40"
        | "eu_shoe_41"
        | "eu_shoe_42"
        | "eu_shoe_43"
        | "eu_shoe_44"
        | "eu_shoe_45"
        | "eu_shoe_46"
        | "eu_shoe_47"
      listing_status: "draft" | "active" | "reserved" | "sold" | "removed"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      listing_condition: ["new", "like_new", "very_good", "good", "fair"],
      listing_event_type: ["impression", "open", "favorite", "unfavorite"],
      listing_size: [
        "one_size",
        "alpha_xxs",
        "alpha_xs",
        "alpha_s",
        "alpha_m",
        "alpha_l",
        "alpha_xl",
        "alpha_xxl",
        "alpha_xxxl",
        "eu_shoe_35",
        "eu_shoe_36",
        "eu_shoe_37",
        "eu_shoe_38",
        "eu_shoe_39",
        "eu_shoe_40",
        "eu_shoe_41",
        "eu_shoe_42",
        "eu_shoe_43",
        "eu_shoe_44",
        "eu_shoe_45",
        "eu_shoe_46",
        "eu_shoe_47",
      ],
      listing_status: ["draft", "active", "reserved", "sold", "removed"],
    },
  },
} as const

