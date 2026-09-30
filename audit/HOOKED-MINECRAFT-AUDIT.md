# Hooked Minecraft Parkour Video — implementation audit

Source inspected: https://www.hooked.so/tools/minecraft-parkour-video

Evidence captured during this audit:

- `D:/adhdreader/hooked-minecraft-parkour.png` — initial page and editor shell.
- `D:/adhdreader/hooked-minecraft-parkour-flow.png` — script editor, gameplay preview, and media selection.

## Observed flow

1. Land on a focused tool page with social proof and a single creation surface.
2. Enter a script, generate or enhance it with AI, and see word count plus estimated duration.
3. Choose a media type, then choose a gameplay background such as Minecraft.
4. Choose a voice and background music, each with a play-preview affordance.
5. Configure aspect ratio, captions, caption preset/alignment, stickers, watermark, and voice details.
6. Generate the video; inspect an output example and optionally use the API code.

## Main findings

- The editor is powerful but exposes many decisions at once. A stepper or progressive disclosure would reduce cognitive load.
- The page promises gameplay intensity selection, split-screen composition, synchronized pacing, 60+ voices, and 25+ caption styles, but the visible editor does not make intensity or layout equally prominent.
- The primary action is disabled with a sparse script and reports `(2 media needed)`, but the reason is not explained near the action. Show the missing requirements inline.
- The fixed $9 promotion overlaps the editor and preview on the captured viewport. Make it dismissible without covering controls, or dock it outside the working area.
- The output example is visible alongside the editor, which is a strong pattern for communicating the result before generation. FocusVid should keep this pattern but make the preview respond to settings.
- Accessibility appears partially considered through labels, roles, and live status text. Keyboard order, focus visibility, color contrast, captions readability over gameplay, and screen-reader announcements still need real interaction testing.

## Recommended FocusVid implementation order

### P0 — high value, fits the current app

1. Add a compact creation stepper using the existing `QUICK_CREATE_STEPS` model. Keep advanced controls collapsed until the user reaches Style.
2. Add a requirements checklist beside Create/Render: material present, scenes available, voice selected, background selected, and render format selected.
3. Make the preview live-update when users change layout, caption preset, aspect ratio, or gameplay sync. This is already close to the current canvas architecture.
4. Add `Gameplay intensity` as a clip preference: calm, standard, or intense. Map it to saved clip metadata or search filters first; do not require new AI generation.
5. Add reusable project presets such as Study notes, Exam recap, Calm focus, and Parkour captions. The code already contains workflow presets, so expose them as first-class starting points.

### P1 — strong differentiators for an ADHD reading product

6. Add a reading-intent selector before generation: read directly, listen along, summarize, or recall. Use it to choose the mode, scene length, caption density, and pacing defaults.
7. Add scene-level controls: split, merge, pause, replay, and “make this scene shorter.” This is more valuable than copying Hooked’s large global settings panel.
8. Add a pacing timeline with scene boundaries and jump markers. FocusVid already has scene timing and synchronized gameplay, so this would make the relationship understandable.
9. Add distraction controls: low-motion background, reduced caption animation, no stickers, and audio ducking. These support the core ADHD-reader use case better than viral-style effects.
10. Add “preview 10 seconds” before the full render, using the chosen voice, caption style, and a random gameplay segment.

### P2 — later infrastructure-heavy work

11. Add multiple voice/music asset browsing with waveform previews and favorites.
12. Add social export presets and publishing adapters.
13. Add API/job-queue support for long renders and progress recovery.
14. Add AI-generated images/videos only after the gameplay and reading workflows are stable; they introduce cost, latency, moderation, and asset storage complexity.

## Best next slice

Build the P0 stepper + requirements checklist + live preview settings. It would make the current app feel substantially closer to the inspected product while reinforcing FocusVid’s real advantage: helping someone keep reading, not just making a viral clip.
