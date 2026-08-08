# FocusVid Reader

FocusVid Reader is a reading-first video generator inspired by `sarrtle/vidgen`.
Instead of making Reddit-style story videos, it turns PDFs, text files, notes, or
pasted study material into paced focus videos that help readers keep momentum.

## What It Does

- Imports pasted text, `.txt`, `.md`, and `.pdf` files.
- Loads a user-selected local background video clip and previews it behind the material.
- Chunks reading material into timed scenes.
- Generates four video modes:
  - Focus Scroll: calm captions and progress pacing.
  - Parkour Captions: VidGen-style kinetic background motion.
  - Study Summary: short chapter-style study cards.
  - Recall Beats: alternates key points with self-check prompts.
- Previews the script with browser speech synthesis.
- Supports VidGen-style `1 word` and `3 words` caption timing.
- Generates Deepgram speech and retrieves word-level timestamps for captions.
- Randomizes the starting position of the selected background clip.
- Renders uploaded clips with narration and timed captions to MP4 through FFmpeg.
- Maintains a local clip library and can download clips through `yt-dlp`.

## Run Locally

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

In a second terminal, start the local provider bridge:

```bash
npm run api
```

## API Setup

Open the `API setup` section in the left panel, choose Gemini, DeepInfra, or
OpenAI, enter the provider key and Deepgram key, choose a voice, and click
`Save API settings`. Then use `Generate script` to turn the material into a
narration script, or `Preview voice` to request a Deepgram voice preview.

Keys remain in browser local storage and are sent only to the local API server.
The local API server handles provider requests, Deepgram TTS/transcription,
yt-dlp downloads, and FFmpeg rendering. The browser falls back to WebM when a
remote/library clip cannot be uploaded back to the server for MP4 rendering.

## Next Build Targets

- Add social publishing adapters.
- Add user reading profiles for speed, caption density, and stimulation level.
