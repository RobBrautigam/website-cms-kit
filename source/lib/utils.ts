/**
 * Counts words in a TipTap document (the JSON shape `editor.getJSON()` returns).
 * Walks every node, concatenates `text` leaves, and splits on whitespace.
 * Used by PostEditor to show a live word count + reading-time estimate.
 */
export function getWordCount(doc: Record<string, unknown>): number {
  let text = ''

  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    const n = node as { text?: unknown; content?: unknown }
    if (typeof n.text === 'string') text += n.text + ' '
    if (Array.isArray(n.content)) n.content.forEach(walk)
  }

  walk(doc)
  return text.trim().split(/\s+/).filter(Boolean).length
}
