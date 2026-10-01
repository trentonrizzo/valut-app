import type { PageCursor } from '../types/media'

function literal(value: string | number | boolean) {
  return typeof value === 'string' ? `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : String(value)
}
/** Matches the complete ORDER BY, including nulls-last and descending UUID ties. */
export function cursorPredicate(col: string, ascending: boolean, cursor: PageCursor, extra?: string): string {
  const value = cursor.value !== undefined ? cursor.value : col === 'created_at' || col === 'captured_at' ? cursor.ts : col === 'favorite' ? cursor.num == null ? null : Boolean(cursor.num) : cursor.num
  const equal = value == null ? `${col}.is.null` : `${col}.eq.${literal(value)}`
  const tie = extra && cursor.ts
    ? `and(${equal},${extra}.lt.${literal(cursor.ts)}),and(${equal},${extra}.eq.${literal(cursor.ts)},id.lt.${literal(cursor.id)})`
    : `and(${equal},id.lt.${literal(cursor.id)})`
  if (value == null) return tie
  return `${col}.${ascending ? 'gt' : 'lt'}.${literal(value)},${tie},${col}.is.null`
}
