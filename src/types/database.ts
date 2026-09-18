export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          email: string
          created_at: string
          encryption_key: string | null
          vault_wrap_salt: string | null
          vault_wrapped_master_key: string | null
          vault_key_created_at: string | null
        }
        Insert: {
          id: string
          email: string
          created_at?: string
          encryption_key?: string | null
          vault_wrap_salt?: string | null
          vault_wrapped_master_key?: string | null
          vault_key_created_at?: string | null
        }
        Update: {
          id?: string
          email?: string
          created_at?: string
          encryption_key?: string | null
          vault_wrap_salt?: string | null
          vault_wrapped_master_key?: string | null
          vault_key_created_at?: string | null
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
          album_id: string | null
          file_name: string
          file_url: string
          created_at: string
          file_size_bytes: number | null
          purpose: string
          is_encrypted: boolean
          mime_type: string | null
          storage_key: string | null
          storage_provider: string
          upload_status: string
          checksum: string | null
          width: number | null
          height: number | null
          duration_ms: number | null
          captured_at: string | null
          favorite: boolean
          rating: number | null
          thumbnail_key: string | null
          poster_key: string | null
          encryption_version: number
          wrapped_dek: string | null
          encryption_chunk_size: number | null
          metadata_json: Record<string, unknown>
        }
        Insert: {
          id?: string
          user_id: string
          album_id?: string | null
          file_name: string
          file_url?: string
          created_at?: string
          file_size_bytes?: number | null
          purpose?: string
          is_encrypted?: boolean
          mime_type?: string | null
          storage_key?: string | null
          storage_provider?: string
          upload_status?: string
          checksum?: string | null
          width?: number | null
          height?: number | null
          duration_ms?: number | null
          captured_at?: string | null
          favorite?: boolean
          rating?: number | null
          thumbnail_key?: string | null
          poster_key?: string | null
          encryption_version?: number
          wrapped_dek?: string | null
          encryption_chunk_size?: number | null
          metadata_json?: Record<string, unknown>
        }
        Update: {
          id?: string
          user_id?: string
          album_id?: string | null
          file_name?: string
          file_url?: string
          created_at?: string
          file_size_bytes?: number | null
          purpose?: string
          is_encrypted?: boolean
          mime_type?: string | null
          storage_key?: string | null
          storage_provider?: string
          upload_status?: string
          checksum?: string | null
          width?: number | null
          height?: number | null
          duration_ms?: number | null
          captured_at?: string | null
          favorite?: boolean
          rating?: number | null
          thumbnail_key?: string | null
          poster_key?: string | null
          encryption_version?: number
          wrapped_dek?: string | null
          encryption_chunk_size?: number | null
          metadata_json?: Record<string, unknown>
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
      album_files: {
        Row: {
          album_id: string
          file_id: string
          user_id: string
          added_at: string
        }
        Insert: {
          album_id: string
          file_id: string
          user_id: string
          added_at?: string
        }
        Update: {
          album_id?: string
          file_id?: string
          user_id?: string
          added_at?: string
        }
        Relationships: []
      }
      tags: {
        Row: {
          id: string
          user_id: string
          name: string
          name_normalized: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          name: string
          name_normalized: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          name?: string
          name_normalized?: string
          created_at?: string
        }
        Relationships: []
      }
      file_tags: {
        Row: {
          file_id: string
          tag_id: string
          user_id: string
          created_at: string
        }
        Insert: {
          file_id: string
          tag_id: string
          user_id: string
          created_at?: string
        }
        Update: {
          file_id?: string
          tag_id?: string
          user_id?: string
          created_at?: string
        }
        Relationships: []
      }
      storage_orphans: {
        Row: {
          id: string
          user_id: string
          storage_key: string
          original_name: string | null
          file_size_bytes: number | null
          upload_id: string | null
          error: string | null
          created_at: string
          reconciled: boolean
        }
        Insert: {
          id?: string
          user_id: string
          storage_key: string
          original_name?: string | null
          file_size_bytes?: number | null
          upload_id?: string | null
          error?: string | null
          created_at?: string
          reconciled?: boolean
        }
        Update: {
          id?: string
          user_id?: string
          storage_key?: string
          original_name?: string | null
          file_size_bytes?: number | null
          upload_id?: string | null
          error?: string | null
          created_at?: string
          reconciled?: boolean
        }
        Relationships: []
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
    Functions: {
      file_ids_with_all_tags: {
        Args: { p_tag_ids: string[] }
        Returns: { file_id: string }[]
      }
      album_content_stats: {
        Args: Record<string, never>
        Returns: { album_id: string; item_count: number; total_bytes: number }[]
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
