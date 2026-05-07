/**
 * Unwrap anchor tags to plain content and drop <base> (prevents hijacking document base).
 * Used for edit-summary HTML that should not render as clickable links.
 */
export function stripLinksFromHtml(html: string): string {
  if (typeof document === 'undefined') return html
  const div = document.createElement('div')
  div.innerHTML = html
  div.querySelectorAll('base').forEach((el) => el.remove())
  div.querySelectorAll('a').forEach((a) => {
    const span = document.createElement('span')
    span.innerHTML = a.innerHTML
    a.parentNode?.replaceChild(span, a)
  })
  return div.innerHTML
}
