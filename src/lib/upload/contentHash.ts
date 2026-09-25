/** SHA-256 hex of file contents for duplicate detection. Does not modify the file. */
export async function sha256HexOfFile(file: Blob): Promise<string | null> {
  try {
    const buf = await file.arrayBuffer()
    const digest = await crypto.subtle.digest('SHA-256', buf)
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return null
  }
}

/** Prefer hashing a streamable slice for very large files later; for now full-file when feasible. */
export async function sha256HexOfFileBestEffort(file: File, maxBytes = 512 * 1024 * 1024): Promise<string | null> {
  if (file.size <= 0) return null
  if (file.size > maxBytes) {
    // Still hash full file when possible — duplicates need content identity.
    // Cap is soft: attempt full hash; callers may skip for extreme sizes.
  }
  return sha256HexOfFile(file)
}
