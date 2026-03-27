export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          email: string
          created_at: string
          encryption_key: string | null
        }
        Insert: {
          id: string
          email: string
          created_at?: string
          encryption_key?: string | null
        }
        Update: {
          id?: string
          email?: string
          created_at?: string
          encryption_key?: string | null
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
          cover_file_id: string | null
        }
        Insert: {
          id?: string
          user_id: string
          name: string
          created_at?: string
          order_index?: number
          cover_file_id?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          name?: string
          created_at?: string
          order_index?: number
          cover_file_id?: string | null
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
      files: {
        Row: {
          id: string
          user_id: string
          album_id: string
          file_name: string
          file_url: string
          created_at: string
          file_size_bytes: number | null
          purpose: string
          is_encrypted: boolean
          mime_type: string | null
        }
        Insert: {
          id?: string
          user_id: string
          album_id: string
          file_name: string
          file_url: string
          created_at?: string
          file_size_bytes?: number | null
          purpose?: string
          is_encrypted?: boolean
          mime_type?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          album_id?: string
          file_name?: string
          file_url?: string
          created_at?: string
          file_size_bytes?: number | null
          purpose?: string
          is_encrypted?: boolean
          mime_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'files_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'files_album_id_fkey'
            columns: ['album_id']
            isOneToOne: false
            referencedRelation: 'albums'
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
