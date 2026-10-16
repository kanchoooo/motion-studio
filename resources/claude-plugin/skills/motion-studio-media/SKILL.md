---
name: motion-studio-media
description: >
  Motion Studio's media tools: generating images, video clips (also from a start and an end frame) and narration
  (text-to-speech) with the designer's Higgsfield / Magnific accounts or Codex (ai_status, ai_tools, ai_call,
  codex_image, make_video, show_voice_candidates), music and sound effects (Artlist: mcp__artlist__*,
  show_audio_candidates; built-in effects; free music via ai_import), and acting SVG characters (character_*).
  Reference notes for using them in Motion Studio.
---

# Motion Studio media

## AI generation (images, video clips, narration)
- When it helps: a background, product scene, texture, b-roll clip or narration the plan needs, or the designer asks for. Call ai_status first.
- Model choice: what the designer said in the chat wins; else the brief default (brief.ai); else pick a suitable model and say which one you used.
- Codex CLI (images only): when the brief's image model is provider "codex" or the designer asks for Codex / GPT 이미지, use codex_image (it runs on the designer's own ChatGPT quota; ai_status shows whether it can be used now).
- Use ai_tools(provider, filter) to learn the exact tool and parameters, then ai_call. Generation can take a while; if a tool returns a job id, use the service's status / wait tool through ai_call until the file is ready. Files come back as composition paths (assets/generated/…): use those paths, never remote URLs. Read generated images to check them before using.
- It spends the designer's credits: one or two candidates, the right size / aspect for the canvas, no repeated retries without telling the designer.
- Every image or video clip you generate is also shown to the designer in the chat as a card (버리기 / 소재함에 추가 / 적용). Read images to check them. While planning, show what you made and let the designer react; while building an approved plan, use it where the plan needs it.
- Video clips: make_video makes one clip in one call (motion prompt, optionally start_image / end_image made first with ai_call or codex_image). For a clip that matters, make the first and last frame images first so the look is under control; a simple clip can go straight from the prompt.
- The designer's prompt for an image is theirs: when they give one, send it exactly as written (only add what the brief's style requires).
- Video clips: <video data-ms-id … data-ms-type="video" id="…" src="assets/generated/…" muted playsinline data-start data-duration> (every media element needs an id).
- Narration (TTS): decide the script, voice and pace with the designer in the conversation. Write the script in natural Korean unless given. Weigh the routes below with the designer (quality, cost, time) instead of defaulting to one, then call show_voice_candidates so the designer can listen and pick (their pick comes back as a message); service and local voices can share one card.
  - Service voices (credits): the voice lists of the connected services (ai_call: Higgsfield list_voices / Magnific audio_voices_list). Higgsfield's generate_audio also runs open-source engines it hosts — model text2speech_v2 with variant cozy_voice (CosyVoice) or vibe_voice (VibeVoice), and qwen_audio_tts (Qwen3-TTS): check the price with get_cost first, often lower than ElevenLabs.
  - Open-source models on this Mac (no credits): when the credits are short, the designer wants it free, or many takes are needed. Korean-capable and allowed in ads: Supertonic 3 (pip install supertonic; ONNX ≈ 100M params, fast on CPU incl. Intel Macs; code MIT, weights OpenRAIL-M), MeloTTS-Korean (MIT, CPU), Qwen3-TTS 0.6B (Apache-2.0; heavier, slow without a GPU). English / Japanese / Chinese lines: Kokoro is already here (`npx hyperframes tts "…" --voice af_heart -o assets/generated/….wav`, no install; no Korean voice).
  - Before installing one: tell the designer what it downloads (Python packages and model weights, roughly 0.3–4 GB) and how long it takes, and wait for their OK. Install once for every project into "$MS_LOCAL_TOOLS/<model>" (a uv or venv environment there, never the system Python); reuse it when it is already there.
  - Licence: ads are commercial. Read the model card before the first use and only use a model whose code and weights allow commercial use (MIT, Apache-2.0, OpenRAIL-M within its use restrictions); never XTTS-v2 (Coqui CPML), F5-TTS (CC-BY-NC) or Fish Speech / OpenAudio (CC-BY-NC-SA). Say the model and licence on the card (engine).
  - A local voice on the card: make a short sample of the actual script into assets/generated/ and pass provider "local", engine ("Supertonic 3 · OpenRAIL-M · 이 Mac에서 무료"), sample (that path). Convert to wav / mp3 with ffmpeg when the model writes another format.
  - Choosing between TTS models: let the designer hear each before they choose — the services' voices with their preview_url, a model already installed with a sample of the script, and a model not installed yet with its official demo clip as preview_url (a direct audio link from the model's own page that you checked plays; never a guessed URL). Ask before installing only the one they like.
- Save each take, then place it as <audio id="…" data-ms-id="voice-…" data-ms-type="voice" data-ms-label="내레이션 · 첫 문장" src="assets/generated/…" data-start data-duration data-volume="1"> directly under the root, timed to the picture; lower BGM under narration.
- A project made from a template may ask you to re-record a narration with "the same voice": call the same tool with the recorded settings (voice id etc.) and only the script changed.

## Music and sound effects
- With Artlist connected (ai_status → artlist enabled): search it first (below).
- Without Artlist: the built-in sound effects (list_sound_effects / use_sound_effect), or free music and effects that allow commercial use WITHOUT attribution. Never use music that needs attribution, is non-commercial, or whose license you cannot name.
- The designer listens before music is settled: when you propose music or effects (or they ask for candidates), call show_audio_candidates with 3–6 candidates — each with a direct preview_url you checked, or a listening copy you downloaded into composition/assets/candidates/ (curl -L, then pass file) — plus source, page_url and license, and end your turn. Bring in only the one they pick (ai_import, page_url and license) and remove the other listening copies.
- Markup (the Sound tab and timeline list only marked sounds): music <audio data-ms-id="bgm-main" data-ms-type="bgm" data-ms-label="배경음악" id="bgm-main" src=… data-start data-duration data-volume="0.6">, an effect <audio data-ms-id="sfx-whoosh-1" data-ms-type="sfx" data-ms-sfx="whoosh" data-ms-label="휙 · 장면 전환" id=… src=… data-start data-duration data-volume>, all directly under the root. Changing the music: the bgm element gets the new src (same data-ms-id), no second track.
  - Mixkit (Mixkit License: commercial use, no attribution) works best: its pages (e.g. https://mixkit.co/free-stock-music/tag/upbeat/, https://mixkit.co/free-sound-effects/whoosh/) list direct file links (https://assets.mixkit.co/music/<n>/<n>.mp3, …/sfx/<n>/<n>-preview.mp3) that ai_import downloads. Reading a page asks the designer first (WebFetch).
  - Pixabay pages refuse automated reading (its file links work when you already have one); Freesound needs an account — skip both unless the designer gives you a file link.

## Artlist (when the designer turned it on and signed in)
- Search with the mcp__artlist__* tools. When the designer asks for candidates ("후보 찾아줘", Sound panel search), call show_audio_candidates with source "artlist", preview_url (and download_url if offered) and end your turn; the designer auditions and picks.
- To use a track yourself, ai_import its file URL and reference the returned path. Preview-quality files are drafts: remind the designer to replace them with the licensed download before delivery.

## SVG characters (acting characters)
- A brief asset with "character" (made with the flat character style) has an SVG version. When the video uses it, load the skill motion-studio-hyperframes:svg-character-motion and follow it step by step: character_info → Read source.png and vector_shapes.png → write the part tags (eyes with the eye rig, the face cut along the jaw, the neck with its under-hang, the layer table) → character_tag (≤ 0.1% difference) → character_check (the extreme poses: no gaps, no detached parts, pupils inside the eye whites) → create the host element → character_embed → add <script src="ms/svgrig.js"></script> right after ms/runtime.js → act with SvgRig (data-ms-id on the host so the designer can adjust the tweens).
- Tag only the characters you actually use, at the depth the scene needs. Expressions the image lacks (eyelids, O mouth, tears, …) are added shapes, swapped at the midpoint of a weight tween. Never redraw an existing eye: expressions reuse the eye rig.
