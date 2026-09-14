import DOMPurify from 'dompurify'
import { Marked } from 'marked'

/**
 * Shared markdown renderer (SSOT for the duplicated component wrappers).
 *
 * Parses markdown with a single `marked` instance, then sanitizes the
 * resulting HTML with DOMPurify before it reaches any `v-html` binding.
 * Dangerous tags/attributes (`<script>`, `onerror`, `javascript:` URLs, …)
 * are stripped, so callers can safely interpolate the output.
 *
 * Component-specific pre-processing (e.g. RefinementChat's `cleanContent`)
 * must run BEFORE calling this function — keep it local to the component.
 */
const md = new Marked({ breaks: true, gfm: true })

/*
 * A code block scrolls sideways when a line is wider than the transcript, and a
 * region that scrolls must be reachable by keyboard (WCAG 2.1.1; axe
 * scrollable-region-focusable). Every rendered <pre> is made focusable here,
 * once, so no caller can forget it. Runs after sanitizing: the only attribute it
 * adds is a fixed tabindex.
 */
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.nodeName === 'PRE')
    node.setAttribute('tabindex', '0')
})

export function renderMarkdown(text: string): string {
  return DOMPurify.sanitize(md.parse(text, { async: false }) as string)
}
