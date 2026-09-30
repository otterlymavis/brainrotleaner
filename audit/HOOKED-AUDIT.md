# Hooked Minecraft Parkour Video — implementation audit

Captured 2026-08-28 from https://www.hooked.so/tools/minecraft-parkour-video.

## Evidence

- `hooked-start.png`: landing page and first part of the creator workflow.
- `hooked-controls.png`: script editor, media type cards, preview, and API callout.
- `hooked-settings.png`: gameplay library with Minecraft presets and thumbnail selection.
- `hooked-final-controls.png`: collapsed voice/music panels and expanded video settings.

## Flow health

1. Discover — healthy: clear value proposition, social proof, and a visible output example.
2. Write script — healthy: large script field, examples, word count, and estimated duration.
3. Choose media — healthy: media-type choice makes the product feel extensible; gameplay presets are easy to scan.
4. Choose background — healthy: category tabs and thumbnail library make selection concrete.
5. Choose voice/music — healthy: progressive disclosure keeps the main surface compact.
6. Configure output — healthy: aspect ratio, captions, caption presets, stickers, and watermark are grouped together.
7. Generate — needs improvement: the primary action is below several configuration sections, and the page does not make generation readiness or credit cost prominent.

## Highest-value ideas for FocusVid

### P0 — make the existing engine feel like a product

- Rename the quick flow around the user outcome: `Create a focus video` with a persistent 1–6 step progress rail.
- Add a readiness summary beside the primary action: scenes, duration, voice, background, captions, and estimated render time.
- Add a credit/time estimate before render and a clear render-progress state with recoverable errors.
- Add a polished result handoff: video preview, download, copy/share link, and “create another from this material”.

### P1 — borrow Hooked’s strongest creator affordances

- Add a searchable, thumbnail-based background library with categories such as calm, focus, high-energy, and Minecraft parkour. Your current clip search/library is functional but text-heavy.
- Add “sync movement to scene changes” as a visible style option. The renderer already has `syncGameplay`; expose it in the quick flow with a short explanation.
- Add reusable project presets: `Study notes`, `Exam recap`, `Article summary`, `Pomodoro`, and `Bionic reading`.
- Add voice cards with language/accent metadata and quick preview; the current voice library already has the underlying model and search support.
- Add caption style previews that reflect the selected layout and content density, not only text labels.

### P2 — differentiators Hooked does not own for your audience

- Reading profiles: speed, chunk size, pause length, stimulation level, caption density, and background intensity. This aligns with the existing README target.
- Chapter navigation and scene timeline: jump to a section, edit one scene, and preview only that scene.
- Learning layer: end-of-video recap, self-check questions, key terms, and “what should I remember?” cards.
- Accessibility controls: reduced motion, no-gameplay mode, high-contrast captions, dyslexia-friendly font option, and audio-only export.
- Save/share a recipe rather than only a video: material + mode + voice + caption + background settings.

## Do not prioritize yet

- AI images and AI video modes: Hooked presents these as broad media options, but they are not central to FocusVid’s reading-first value.
- Social auto-publishing: the README lists it as a future target, but reliable render/download/share and saved presets will improve the core loop first.
- A large SEO/use-case page inside the editor: useful for acquisition, but separate it from the creation workspace.

## Evidence limits

This review used the public page’s visible UI, DOM, and screenshots. It did not log in, submit a generation, inspect paid limits, test mobile breakpoints, or verify server-side rendering behavior.
