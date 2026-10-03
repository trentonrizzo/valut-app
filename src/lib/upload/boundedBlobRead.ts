/** Read only the requested Blob range, with a FileReader fallback for Safari 12. */
export async function readBlobSlice(blob: Blob, start: number, end: number): Promise<ArrayBuffer> {
  const slice = blob.slice(Math.max(0, start), Math.max(0, end))
  const modern = slice as Blob & { arrayBuffer?: () => Promise<ArrayBuffer> }
  if (typeof modern.arrayBuffer === 'function') return modern.arrayBuffer()
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) resolve(reader.result)
      else reject(new Error('FileReader did not return bytes'))
    }
    reader.onerror = () => reject(reader.error || new Error('FileReader failed'))
    reader.readAsArrayBuffer(slice)
  })
}
