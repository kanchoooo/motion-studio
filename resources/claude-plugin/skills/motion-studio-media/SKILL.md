---
name: motion-studio-media
description: >
  Motion Studio's media tools: generating images, video clips and narration (text-to-speech) with the designer's
  Higgsfield / Magnific accounts or Codex (ai_status, ai_tools, ai_call, ai_import, codex_image), Artlist music and
  sound-effect candidates (mcp__artlist__*, show_audio_candidates), and acting SVG characters (character_info,
  character_tag, character_check, character_embed). Load before using any of them in Motion Studio.
---

# Motion Studio media

## AI generation (images, video clips, narration)
- Only when it helps: a background, product scene, texture, b-roll clip, or narration the brief / storyboard asks for, or the designer requests in chat. Call ai_status first.
- Model choice: what the designer said in the chat wins; else the brief default (brief.ai); else pick a suitable model and say which one you used.
- Codex CLI (images only): when the brief's image model is provider "codex" or the designer asks for Codex / GPT 이미지, use codex_image (it runs on the designer's own ChatGPT quota; ai_status shows whether it can be used now).
- Use ai_tools(provider, filter) to learn the exact tool and parameters, then ai_call. Generation can take a while; if a tool returns a job id, use the service's status / wait tool through ai_call until the file is ready. Files come back as composition paths (assets/generated/…): use those paths, never remote URLs. Read generated images to check them before using.
- It spends the designer's credits: one or two candidates, the right size / aspect for the canvas, no repeated retries without telling the designer.
- Review first: every image or video clip you generate is shown to the designer in the chat as a card (버리기 / 소재함에 추가 / 적용). Unless the designer explicitly asked you to put it straight into the video, generate, Read it to check it, say in one Korean line what you made, and END YOUR TURN. Do not place it before they choose. When they apply it, their message tells you where (a selected element, or "알아서").
- The designer's prompt for an image is theirs: when they give one, send it exactly as written (only add what the brief's style requires).
- Video clips: <video data-ms-id … data-ms-type="video" id="…" src="assets/generated/…" muted playsinline data-start data-duration> (every media element needs an id).
- Narration (TTS): use the brief voice (brief.ai.narration) or the one asked in chat; write the script in natural Korean unless given. Save each take, then place it as <audio id="…" data-ms-id="voice-…" data-ms-type="voice" data-ms-label="내레이션 · 첫 문장" src="assets/generated/…" data-start data-duration data-volume="1"> directly under the root, timed to the picture; lower BGM under narration.
- A project made from a template may ask you to re-record a narration with "the same voice": call the same tool with the recorded settings (voice id etc.) and only the script changed.

## Artlist (when the designer turned it on and signed in)
- Search with the mcp__artlist__* tools. When the designer asks for candidates ("후보 찾아줘", Sound panel search), call show_audio_candidates with preview_url (and download_url if offered) and end your turn; the designer auditions and picks.
- To use a track yourself, ai_import its file URL and reference the returned path. Preview-quality files are drafts: remind the designer to replace them with the licensed download before delivery.

## SVG characters (acting characters)
- A brief asset with "character" (made with the flat character style) has an SVG version. When the video uses it, load the skill motion-studio-hyperframes:svg-character-motion and follow it step by step: character_info → Read source.png and vector_shapes.png → write the part tags (eyes with the eye rig, the face cut along the jaw, the neck with its under-hang, the layer table) → character_tag (≤ 0.1% difference) → character_check (the extreme poses: no gaps, no detached parts, pupils inside the eye whites) → create the host element → character_embed → add <script src="ms/svgrig.js"></script> right after ms/runtime.js → act with SvgRig (data-ms-id on the host so the designer can adjust the tweens).
- Tag only the characters you actually use, at the depth the scene needs. Expressions the image lacks (eyelids, O mouth, tears, …) are added shapes, swapped at the midpoint of a weight tween. Never redraw an existing eye: expressions reuse the eye rig.
