// Claude's replies in the chat: tables (Claude Code writes plans as tables) render as tables,
// not as rows of pipes; lists, headings and bold stay as before.
import { createElement, type FC } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

// a renderer component (TSX): loaded at run time, so the main-process type check does not compile it
const MODULE: string = '../../src/renderer/src/components/Markdown'
const { Markdown } = (await import(MODULE)) as { Markdown: FC<{ text: string }> }

const html = (text: string) => renderToStaticMarkup(createElement(Markdown, { text }))

describe('chat markdown', () => {
  it('renders a table with its header, without the separator row', () => {
    const out = html('구성 제안\n| 시간 | 장면 |\n|---|---|\n| 0~1.5초 | **꽃잎** 등장 |\n| 1.5~4초 | 라떼 |\n\n정해 주세요.')
    expect(out).toContain('<table class="md-table">')
    expect(out).toContain('<th>시간</th><th>장면</th>')
    expect(out).toContain('<td>0~1.5초</td><td><b>꽃잎</b> 등장</td>')
    expect(out).not.toContain('|')
    expect(out).not.toContain('---')
    expect(out).toContain('<p class="md-p">정해 주세요.</p>')
  })
  it('keeps lists and headings', () => {
    const out = html('## 다음\n- 하나\n- 둘\n1. 첫째')
    expect(out).toContain('<p class="md-h">다음</p>')
    expect(out).toContain('<ul class="md-list"><li>하나</li><li>둘</li></ul>')
    expect(out).toContain('<ol class="md-list"><li>첫째</li></ol>')
  })
})
