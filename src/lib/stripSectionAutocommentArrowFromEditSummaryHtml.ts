/**
 * fakewiki `preprocessEditSummary` renders section autocomments as
 * `[[page#section|→section]]`. Strip the leading arrow from the link label so
 * summaries read "Section: …" instead of "→Section: …".
 */
export function stripSectionAutocommentArrowFromEditSummaryHtml(html: string): string {
  return html.replace(/(<a\b[^>]*>)→/gi, '$1')
}
