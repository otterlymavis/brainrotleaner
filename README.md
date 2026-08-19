# FocusVid Reader

FocusVid Reader is a reading-first video generator inspired by `sarrtle/vidgen`.
Instead of making Reddit-style story videos, it turns PDFs, text files, notes, or
pasted study material into paced focus videos that help readers keep momentum.

## What It Does

- Imports pasted text, `.txt`, `.md`, and `.pdf` files.
- Loads a user-selected local background video clip and previews it behind the material.
- Chunks reading material into timed scenes.
- Generates five reading/video modes:
  - Bionic Reading: bold visual anchors for reading text directly.
  - Focus Scroll: calm captions at a steady pace.
  - Parkour Captions: VidGen-style kinetic background motion.
  - Study Summary: short chapter-style study cards.
  - Recall Beats: alternates key points with self-check prompts.
- Previews the script with browser speech synthesis.
- Supports VidGen-style `1 word` and `3 words` caption timing.
- Narrates with either Edge (free, no API key, ships word timings with the audio)
  or Deepgram (key required, transcribed to recover word timings).
- Finds real gameplay footage in-app: preset searches (Minecraft parkour, Subway
  Surfers, satisfying) run through `yt-dlp` and list results with title and length.
- Downloads only a random section of the chosen source instead of the whole video.
- Picks a fresh random start point in the clip on every render.
- Renders clips with narration and timed captions to 1080x1920 MP4 through FFmpeg,
  optionally mixing gameplay audio under the narration.
- Maintains a local clip library and can still take an uploaded file or pasted URL.

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

No keys are needed to make a video. Paste or upload your material, pick a
background clip, press `Preview voice`, then `Render video`.

**Voice.** Open `Voice` and choose an engine. `Edge` is the default and needs no
key; it returns caption timings alongside the audio, so nothing is transcribed.
`Deepgram` needs a key pasted into the same panel and transcribes its own speech
to recover word timings. Edge uses Microsoft's Edge read-aloud service
unofficially, so keep Deepgram configured if you need a guaranteed fallback.

**Scripts (optional).** Open `API settings`, choose Gemini, DeepInfra, or OpenAI,
paste that provider's key, and click `Save settings`. `Generate script` then
rewrites your material into a narration script. Gemini has a free tier. Skip this
entirely and write the script yourself if you prefer.

Keys remain in browser local storage and are sent only to your own API server,
which handles provider requests, speech, yt-dlp downloads, and FFmpeg rendering.
The browser falls back to WebM when a clip cannot be rendered server-side.

## Background Footage

The fastest path is to supply footage yourself. Either use `Or upload your own clip`,
which streams the file into `clips/` and selects it, or drop video files straight
into the `clips` folder and press `Refresh library`. Uploaded clips stay in the
library, so a clip only ever transfers once no matter how many videos you render.

To find footage instead, open `Background clip`, tap a preset such as `Minecraft parkour`, and pick a result.
The server downloads a random section of that video (length set by the
`Download length` slider), saves it to `clips/`, and selects it as the background.
`Random start point on every render` then re-rolls where the footage begins each
time you render, so repeated videos do not open on the same frame.

The presets search for footage published as no-copyright/free-to-use. Confirm the
licence of anything you download before publishing.

YouTube refuses anonymous downloads for a growing share of videos, which surfaces
as `403 Forbidden` or `Requested format is not available`. Open `Download access`
under `Background clip` and either choose a browser to pull cookies from or point
it at a `cookies.txt` file. A browser must be fully closed before `yt-dlp` can
read its cookie database, and recent Chrome versions encrypt cookies in a way
`yt-dlp` cannot read, so a `cookies.txt` export is the most reliable option.
Uploading your own footage bypasses this entirely.

## Deploy Free on Oracle Cloud

The Node server serves both the API and the built frontend, so this is a single
process on one origin. Running costs nothing on an Oracle Cloud **Always Free** VM.

1. Create an Always Free instance (Ampere ARM or the AMD micro shape) running
   Ubuntu, and add your SSH key.
2. Push this repository to GitHub, then on the VM:

   ```bash
   git clone https://github.com/you/adhdreader.git
   cd adhdreader
   REPO=https://github.com/you/adhdreader.git bash deploy/setup-oracle.sh
   ```

   The script installs Node, FFmpeg, and a caption font, builds the frontend,
   generates a random `APP_PASSWORD` into `.env`, and starts a systemd service.
   Note the password it prints.
3. Put HTTPS in front of it with Caddy, using `deploy/Caddyfile` and a hostname
   (a free DuckDNS subdomain works). The script prints the exact commands.
4. Open ports 80 and 443 in **both** the Oracle security list and the VM's own
   iptables. Missing either one is the usual reason a fresh Oracle VM appears dead.

**Use HTTPS.** The password is sent as Basic Auth, which is only base64 encoded,
so over plain `http://<ip>:8787` it travels in the clear. The setup script binds
the app to `127.0.0.1` so it is reachable only through the proxy.

Useful commands:

```bash
systemctl status focusvid
journalctl -u focusvid -f
sudo systemctl restart focusvid
```

Notes for the hosted build:

- **Always set `APP_PASSWORD`.** Without it the server starts open to anyone and
  logs a warning; rendering video is expensive for whoever finds the URL.
- **Clip downloading will mostly fail from a cloud VM.** YouTube blocks datacenter
  addresses harder than home connections. Upload your footage instead.
- **ARM shapes render slowly.** FFmpeg is CPU-bound and these are modest cores, so
  expect a long narration to take minutes.
- Rendering holds the HTTP request open while FFmpeg runs. That is fine for one
  person and needs a job queue before the URL is shared.
- Oracle can reclaim Always Free instances that sit idle. Keep the machine doing
  something occasionally if you want to keep it.

## Next Build Targets

- Add social publishing adapters.
- Add user reading profiles for speed, caption density, and stimulation level.
