// The session's guard rails: composition files are edited with Edit / Write (not shell
// scripts), and the first composition write waits until a HyperFrames workflow skill was read.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => tmpdir(), getAppPath: () => process.cwd() }, shell: {}, BrowserWindow: class {} }))

describe('scriptEditsComposition', async () => {
  const { scriptEditsComposition: edits } = await import('../../src/main/agent/permissions')
  it('catches scripts that rewrite composition files', () => {
    expect(edits(`cd composition && python3 - <<'EOF'\nsrc=open('index.html').read()\nopen('index.html','w').write(src.replace('a','b'))\nEOF`)).toBe(true)
    expect(edits(`python3 -c "from pathlib import Path; p=Path('index.html'); p.write_text(p.read_text().replace('x','y'))"`)).toBe(true)
    expect(edits(`sed -i '' 's/0.4/0.6/' composition/index.html`)).toBe(true)
    expect(edits(`perl -pi -e 's/a/b/' index.html`)).toBe(true)
    expect(edits(`cat > composition/scene.css <<'EOF'\n.a{}\nEOF`)).toBe(true)
    expect(edits(`echo '<div></div>' | tee -a index.html`)).toBe(true)
    expect(edits(`node -e "require('fs').writeFileSync('index.html', '')"`)).toBe(true)
  })
  it('lets analysis and read-only commands through', () => {
    expect(edits(`python3 scripts/analyze-beatgrid.py assets/bgm.mp3 -o audiomap.json`)).toBe(false)
    expect(edits(`grep -n "tl.to" index.html > /tmp/out.txt`)).toBe(false)
    expect(edits(`hyperframes check 2>&1 | tail -20`)).toBe(false)
    expect(edits(`sed -n 1,40p index.html`)).toBe(false)
    expect(edits(`python3 -c "print(open('index.html').read().count('data-ms-id'))"`)).toBe(false)
  })
})

describe('readSkills', async () => {
  const { readSkills } = await import('../../src/main/agent/permissions')
  const dir = mkdtempSync(join(tmpdir(), 'ms-skills-'))
  const line = (skill: string) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill } }] } })
  it('needs the router or a workflow skill', () => {
    const f = join(dir, 'a.jsonl')
    writeFileSync(f, [line('motion-studio-hyperframes:hyperframes-core'), line('motion-studio-hyperframes:hyperframes-animation')].join('\n'))
    expect(readSkills(f)).toBe(false)
    writeFileSync(f, [line('motion-studio-hyperframes:hyperframes-core'), line('motion-studio-hyperframes:product-launch-video')].join('\n'))
    expect(readSkills(f)).toBe(true)
    writeFileSync(f, line('hyperframes') + '\n{"partial')
    expect(readSkills(f)).toBe(true)
    expect(readSkills(join(dir, 'missing.jsonl'))).toBe(false)
  })
})
