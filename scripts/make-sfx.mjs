#!/usr/bin/env node
// Synthesises Motion Studio's built-in sound effects with FFmpeg (no third-party
// samples, so no licensing questions). Designers replace them with their own
// library files inside the app; these are sensible defaults for Claude to place.
//   node scripts/make-sfx.mjs   → resources/sfx/*.wav + resources/sfx/library.json
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'resources', 'sfx')
mkdirSync(out, { recursive: true })
const exe = process.platform === 'win32' ? '.exe' : ''
const ffmpeg = join(root, 'resources', 'bin', `${process.platform}-${process.arch}`, `ffmpeg${exe}`)

// each entry: aevalsrc expression (mono, 48 kHz) + post filters
const SFX = [
  { id: 'pop', label: '팝', use: '요소가 톡 튀어나올 때', d: 0.18, expr: 'sin(2*PI*(900-2600*t)*t)*exp(-28*t)', af: 'highpass=f=150' },
  { id: 'click', label: '클릭', use: 'UI·버튼·작은 강조', d: 0.06, expr: '(random(0)*2-1)*exp(-120*t)', af: 'highpass=f=1800,lowpass=f=9000' },
  { id: 'whoosh', label: '휙', use: '장면 전환·빠른 이동', d: 0.7, expr: '(random(0)*2-1)*sin(PI*t/0.7)^2', af: 'bandpass=f=1400:w=1800,afade=t=in:d=0.25,afade=t=out:st=0.35:d=0.35' },
  { id: 'swoosh-up', label: '휙 올라감', use: '등장·상승 전환', d: 0.6, expr: 'sin(2*PI*(300+900*t)*t)*0.35+(random(0)*2-1)*0.4*sin(PI*t/0.6)', af: 'highpass=f=250,afade=t=in:d=0.2,afade=t=out:st=0.35:d=0.25' },
  { id: 'ding', label: '띵', use: '포인트·완성·정답', d: 1.2, expr: '(sin(2*PI*1320*t)+0.5*sin(2*PI*2640*t)+0.25*sin(2*PI*3960*t))*exp(-4*t)*0.5', af: 'afade=t=in:d=0.004' },
  { id: 'impact', label: '쿵', use: '강한 등장·로고 착지', d: 0.9, expr: 'sin(2*PI*(110-70*t)*t)*exp(-5*t)+(random(0)*2-1)*exp(-30*t)*0.4', af: 'lowpass=f=2500' },
  { id: 'riser', label: '상승음', use: '긴장감 고조·클라이맥스 직전', d: 2.0, expr: '(sin(2*PI*(200+500*t)*t)*0.3+(random(0)*2-1)*0.25)*(t/2)', af: 'highpass=f=200,afade=t=out:st=1.9:d=0.1' },
  { id: 'sparkle', label: '반짝', use: '반짝임·새로움 강조', d: 0.8, expr: '(sin(2*PI*2400*t)*(gt(mod(t,0.12),0.06))+sin(2*PI*3200*t)*(lt(mod(t,0.12),0.06)))*exp(-3.5*t)*0.35', af: 'highpass=f=1500' },
  { id: 'type', label: '타자', use: '글자가 한 자씩 나올 때', d: 0.05, expr: '(random(0)*2-1)*exp(-150*t)*0.8', af: 'bandpass=f=3500:w=2500' },
  { id: 'swipe', label: '스와이프', use: '화면 밀기·슬라이드', d: 0.35, expr: '(random(0)*2-1)*sin(PI*t/0.35)', af: 'bandpass=f=2600:w=2200,afade=t=out:st=0.2:d=0.15' },
]

for (const s of SFX) {
  const file = join(out, `${s.id}.wav`)
  execFileSync(ffmpeg, [
    '-v', 'error', '-y',
    '-f', 'lavfi', '-i', `aevalsrc='${s.expr}':s=48000:d=${s.d}`,
    '-af', `${s.af},loudnorm=I=-18:TP=-2:LRA=7,aresample=48000`,
    '-ac', '2', '-c:a', 'pcm_s16le', file,
  ])
  console.log('  ✓', s.id)
}
writeFileSync(
  join(out, 'library.json'),
  JSON.stringify(SFX.map(({ id, label, use, d }) => ({ id, label, use, duration: d, file: `${id}.wav` })), null, 2) + '\n',
)
console.log(`→ ${out}`)
