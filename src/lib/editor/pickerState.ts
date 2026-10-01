/** Selected records are independent of query pages and survive filter changes. */
export function toggleRecord<T extends { id: string }>(selected: Map<string, T>, item: T, max: number): Map<string, T> {
  const next = new Map(selected)
  if (next.has(item.id)) next.delete(item.id)
  else if (next.size < max) next.set(item.id, item)
  return next
}

export class RequestGeneration {
  private generation = 0
  private controller: AbortController | null = null
  begin() {
    this.controller?.abort()
    const id = ++this.generation
    this.controller = new AbortController()
    return { signal: this.controller.signal, current: () => id === this.generation }
  }
  cancel() { this.generation++; this.controller?.abort() }
}
