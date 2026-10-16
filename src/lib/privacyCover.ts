const listeners = new Set<() => void>()
let covered = false

export function isPrivacyCovered(): boolean {
  return covered
}

export function setPrivacyCover(next: boolean): void {
  covered = next
  for (const listener of listeners) listener()
}

export function subscribePrivacyCover(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
