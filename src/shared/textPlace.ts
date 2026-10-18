// A part of a text the designer dragged over (선택한 글자만 색 바꾸기): which place of that text it
// is. Counted without spaces and line breaks, as the preview runtime finds it (ms-runtime.js
// highlightAt): the text box shows line breaks and spaces differently from the page.
export const noSpace = (t: string) => t.replace(/\s+/g, '')

/** the place (0 = first, without overlaps) of `part` that starts where the selection starts */
export function placeOf(text: string, start: number, part: string): number {
  const s = noSpace(text)
  const needle = noSpace(part)
  if (!needle) return 0
  const at = noSpace(text.slice(0, start)).length
  let n = 0
  for (let i = s.indexOf(needle); i >= 0; i = s.indexOf(needle, i + needle.length), n++) if (i >= at) return n
  return 0
}
