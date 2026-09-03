export type DiffSegment = { text: string; type: 'same' | 'added' | 'removed' }

export function inlineDiff(oldVal: string, newVal: string): DiffSegment[] {
  if (oldVal === newVal) {
    return [{ text: oldVal, type: 'same' }]
  }
  if (!oldVal) {
    return [{ text: newVal, type: 'added' }]
  }
  if (!newVal) {
    return [{ text: oldVal, type: 'removed' }]
  }

  let prefixLen = 0
  const maxPrefix = Math.min(oldVal.length, newVal.length)
  while (prefixLen < maxPrefix && oldVal[prefixLen] === newVal[prefixLen]) {
    prefixLen++
  }

  let suffixLen = 0
  const maxSuffix = Math.min(oldVal.length - prefixLen, newVal.length - prefixLen)
  while (suffixLen < maxSuffix && oldVal[oldVal.length - 1 - suffixLen] === newVal[newVal.length - 1 - suffixLen]) {
    suffixLen++
  }

  const segments: DiffSegment[] = []
  if (prefixLen > 0) {
    segments.push({ text: oldVal.slice(0, prefixLen), type: 'same' })
  }
  const removed = oldVal.slice(prefixLen, oldVal.length - suffixLen)
  if (removed) {
    segments.push({ text: removed, type: 'removed' })
  }
  const added = newVal.slice(prefixLen, newVal.length - suffixLen)
  if (added) {
    segments.push({ text: added, type: 'added' })
  }
  if (suffixLen > 0) {
    segments.push({ text: oldVal.slice(oldVal.length - suffixLen), type: 'same' })
  }
  return segments
}

export function parseChangeDetail(detail: string): { field: string; old: string; new: string } | null {
  const m = detail.match(/^(.+?):\s*(.+?)\s*→\s*(.+?)$/)
  return m ? { field: m[1].trim(), old: m[2].trim(), new: m[3].trim() } : null
}
