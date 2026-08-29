/** Plain text from the contentEditable editor (strips annotation markers). */
export function readEditorText(editor: HTMLElement) {
  const copy = editor.cloneNode(true) as HTMLElement
  copy.querySelectorAll('sup').forEach((marker) => marker.remove())
  return copy.textContent ?? ''
}

export function getSelectionOffset(root: HTMLElement, node: Node, offset: number) {
  let total = 0
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (current) =>
      current.parentElement?.closest('sup') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  })
  while (walker.nextNode()) {
    const current = walker.currentNode
    if (current === node) return total + offset
    total += current.textContent?.length ?? 0
  }
  return total
}

export function restoreSelection(root: HTMLElement, start: number, end: number) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let position = 0
  let startNode: Node | null = null
  let endNode: Node | null = null
  let startOffset = 0
  let endOffset = 0
  while (walker.nextNode()) {
    const node = walker.currentNode
    if (node.parentElement?.closest('sup')) {
      continue
    }
    const length = node.textContent?.length ?? 0
    if (!startNode && start <= position + length) {
      startNode = node
      startOffset = start - position
    }
    if (!endNode && end <= position + length) {
      endNode = node
      endOffset = end - position
      break
    }
    position += length
  }
  if (!startNode || !endNode) return
  const selection = window.getSelection()
  if (!selection) return
  const range = document.createRange()
  range.setStart(startNode, Math.max(0, startOffset))
  range.setEnd(endNode, Math.max(0, endOffset))
  selection.removeAllRanges()
  selection.addRange(range)
}

export function getEditorContext(editor: HTMLElement, documentText: string) {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return {}

  const anchor = selection.anchorNode
  const focus = selection.focusNode
  if (!anchor || !focus || !editor.contains(anchor) || !editor.contains(focus)) return {}

  const anchorOffset = getSelectionOffset(editor, anchor, selection.anchorOffset)
  const focusOffset = getSelectionOffset(editor, focus, selection.focusOffset)
  const start = Math.min(anchorOffset, focusOffset)
  const end = Math.max(anchorOffset, focusOffset)

  if (start !== end) {
    return {
      selection: {
        start,
        end,
        text: documentText.slice(start, end),
      },
    }
  }

  return { cursorOffset: start }
}
