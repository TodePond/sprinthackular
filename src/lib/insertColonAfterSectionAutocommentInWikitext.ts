/**
 * fakewiki `preprocessEditSummary` turns section autocomments into an in-page wikilink
 * plus the free-text summary, with no colon between them. Normalize the raw comment
 * so the transformed HTML reads like "Section: comment" (arrow stripped after render),
 * matching plain `parseEditSummary`.
 */
export function insertColonAfterSectionAutocommentInWikitext(comment: string): string {
  const m = comment.match(/^\s*\/\*\s*([^*]+?)\s*\*\/\s*(.*)$/s)
  if (!m) return comment
  const section = m[1].trim()
  const rest = m[2].trim()
  if (!rest) return comment
  if (rest.startsWith(':')) return comment
  return `/* ${section} */: ${rest}`
}
