export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          email: string
          created_at: string
        }
        Insert: {
          id: string
          email: string
          created_at?: string
        }
        Update: {
          id?: string
          email?: string
          created_at?: string
        }
        Relationships: []
      }
      albums: {
        Row: {
          id: string
          user_id: string
          name: string
          created_at: string
          order_index: number
        }
        Insert: {
          id?: string
          user_id: string
          name: string
          created_at?: string
          order_index?: number
        }
        Update: {
          id?: string
          user_id?: string
          name?: string
          created_at?: string
          order_index?: number
        }
        Relationships: [
          {
            foreignKeyName: 'albums_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      items: {
        Row: {
          id: string
          album_id: string
          type: string
          url: string
          created_at: string
        }
        Insert: {
          id?: string
          album_id: string
          type: string
          url: string
          created_at?: string
        }
        Update: {
          id?: string
          album_id?: string
          type?: string
          url?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'items_album_id_fkey'
            columns: ['album_id']
            isOneToOne: false
            referencedRelation: 'albums'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
