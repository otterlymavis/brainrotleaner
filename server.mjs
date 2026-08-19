import { createServer as createHttpServer } from "node:http";
import { promises as fs, createReadStream, createWriteStream, readFileSync } from "node:fs";
import opentype from "opentype.js";
import { join, basename, extname, dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID, createHash, timingSafeEqual } from "node:crypto";
import ffmpeg from "@ffmpeg-installer/ffmpeg";
import YTDlpWrapModule from "yt-dlp-wrap";
import edgeTtsModule from "@andresaya/edge-tts";

const EdgeTTS = edgeTtsModule?.EdgeTTS || edgeTtsModule?.default?.EdgeTTS || edgeTtsModule?.default;

// The CommonJS build reaches ESM importers wrapped one level deeper than its type definitions suggest.
const YTDlpWrap = typeof YTDlpWrapModule?.getGithubReleases === "function" ? YTDlpWrapModule : YTDlpWrapModule?.default;

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "0.0.0.0";
// Keep every written file under one path so it can point at a mounted volume.
const dataDir = process.env.DATA_DIR || process.cwd();
const staticDir = join(process.cwd(), "dist");
const appPassword = process.env.APP_PASSWORD || "";
// The npm build is an old 4.1.x; a distro package (apt install ffmpeg) can be pointed at instead.
const ffmpegPath = process.env.FFMPEG_PATH || ffmpeg.path;
const clipsDir = join(dataDir, "clips");
const outputsDir = join(dataDir, "outputs");
const toolsDir = join(dataDir, "tools");

await Promise.all([fs.mkdir(clipsDir, { recursive: true }), fs.mkdir(outputsDir, { recursive: true }), fs.mkdir(toolsDir, { recursive: true })]);

const readJson = async (request) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
};

const sendJson = (response, status, payload) => {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
};

const runCapture = (command, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { windowsHide: true, ...options });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  child.on("error", reject);
  child.on("close", (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(stderr || `Process exited with code ${code}`)));
});

const runProcess = async (command, args, options = {}) => {
  await runCapture(command, args, options);
};

// ffmpeg exits non-zero when given no output file, but still prints the input header we need.
const probeMedia = async (filepath) => {
  let report = "";
  try {
    const { stderr } = await runCapture(ffmpegPath, ["-hide_banner", "-i", filepath]);
    report = stderr;
  } catch (error) {
    report = error.message || "";
  }
  const match = report.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  return {
    duration: match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : 0,
    hasAudio: /Stream #\d+:\d+.*: Audio:/.test(report)
  };
};

const probeDuration = async (filepath) => (await probeMedia(filepath)).duration;

// YouTube hands some media URLs to yt-dlp bound to a player client that ffmpeg cannot range-request,
// which makes --download-sections fail with 403. Fall back to grabbing the file and cutting it here.
const trimClip = async (sourcePath, targetPath, start, seconds) => {
  await runProcess(ffmpegPath, [
    "-y",
    "-ss", start.toFixed(2),
    "-i", sourcePath,
    "-t", seconds.toFixed(2),
    "-c", "copy",
    "-avoid_negative_ts", "make_zero",
    targetPath
  ]);
};

const randomStartOffset = (clipDuration, neededSeconds) => {
  const usable = clipDuration - neededSeconds;
  if (!Number.isFinite(usable) || usable <= 1) return 0;
  return Math.round(Math.random() * usable * 1000) / 1000;
};

// drawtext resolves font='Arial' through fontconfig, which a bare Linux VM does not have.
// Falling back to a real font file keeps captions working off Windows.
const FALLBACK_FONTS = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
  "/usr/share/fonts/TTF/DejaVuSans.ttf",
  "C:/Windows/Fonts/arialbd.ttf",
  "C:/Windows/Fonts/arial.ttf"
];

let defaultFontPath = "";
const resolveDefaultFont = async () => {
  if (process.env.FONT_PATH) {
    defaultFontPath = process.env.FONT_PATH;
    return;
  }
  for (const candidate of FALLBACK_FONTS) {
    try {
      await fs.access(candidate);
      defaultFontPath = candidate;
      return;
    } catch {
      // Try the next known location.
    }
  }
};

const safeName = (name) => basename(name).replace(/[^a-zA-Z0-9._-]/g, "_");

// Hashing first keeps the comparison constant-time without leaking the password length.
const digest = (value) => createHash("sha256").update(String(value)).digest();

const isAuthorized = (request) => {
  if (!appPassword) return true;
  const header = request.headers.authorization || "";
  if (!header.startsWith("Basic ")) return false;
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  return timingSafeEqual(digest(decoded.slice(decoded.indexOf(":") + 1)), digest(appPassword));
};

const STATIC_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8"
};

const sendStatic = async (response, requestPath) => {
  const relative = decodeURIComponent(requestPath.split("?")[0]).replace(/^\/+/, "");
  const candidate = resolve(staticDir, relative || "index.html");
  // Never serve outside the build directory, whatever the request path claims.
  const filepath = candidate.startsWith(resolve(staticDir)) ? candidate : join(staticDir, "index.html");
  let target = filepath;
  try {
    const stat = await fs.stat(target);
    if (stat.isDirectory()) target = join(target, "index.html");
  } catch {
    target = join(staticDir, "index.html");
  }
  try {
    const body = await fs.readFile(target);
    response.writeHead(200, { "Content-Type": STATIC_TYPES[extname(target).toLowerCase()] || "application/octet-stream", "Content-Length": body.length });
    response.end(body);
  } catch {
    sendJson(response, 404, { error: "Not found" });
  }
};

const hexColor = (value, fallback) => /^#[0-9a-f]{6}$/i.test(value || "") ? value : fallback;
const escapeFilterPath = (value) => value.replace(/\\/g, "/").replace(/:/g, "\\:");

// Captions are drawn after the scale/crop, so the frame is always this wide.
const VIDEO_WIDTH = 1080;
const TEXT_MARGIN = 72;

const fontCache = new Map();

const loadFont = (fontPath) => {
  if (!fontPath) return null;
  if (fontCache.has(fontPath)) return fontCache.get(fontPath);
  let parsed = null;
  try {
    const file = readFileSync(fontPath);
    parsed = opentype.parse(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
  } catch {
    parsed = null; // Unsupported container (woff2) or unreadable file; fall back to estimating.
  }
  fontCache.set(fontPath, parsed);
  return parsed;
};

// FreeType advances by whole pixels per glyph and drawtext applies no kerning, so summing
// rounded per-glyph advances tracks what ffmpeg actually draws. Using opentype's fractional
// total instead lets error accumulate across a line and visibly offsets the highlight.
const measureText = (font, text, fontSize) => {
  if (!font || !text) return 0;
  try {
    const scale = fontSize / font.unitsPerEm;
    let total = 0;
    for (const character of text) {
      const glyph = font.charToGlyph(character);
      total += Math.round((glyph?.advanceWidth || 0) * scale);
    }
    return total;
  } catch {
    return 0;
  }
};

const createCaptionFilter = (words, style, captionStyle = {}, fontPath = "") => {
  const groupSize = style === "1 word" ? 1 : 3;
  const fontSize = Math.max(28, Math.min(110, Number(captionStyle.fontSize) || 58));
  const textColor = hexColor(captionStyle.textColor, "#f8fafc");
  const strokeColor = hexColor(captionStyle.strokeColor, "#101820");
  const strokeWidth = Math.max(0, Math.min(12, Number(captionStyle.strokeWidth) || 0));
  const requestedFont = captionStyle.fontFamily === "Inter, Arial, sans-serif" ? "Arial" : captionStyle.fontFamily;
  const fontFamily = ["Arial", "Georgia", "Trebuchet MS", "Courier New"].includes(requestedFont) ? requestedFont : "Arial";
  const resolvedFont = fontPath || defaultFontPath;
  const fontSource = resolvedFont ? "fontfile='" + escapeFilterPath(resolvedFont) + "'" : "font='" + fontFamily + "'";
  const highlightColor = hexColor(captionStyle.highlightColor, "#10b981");
  const position = captionStyle.position === "top" ? "h*0.2" : captionStyle.position === "bottom" ? "h*0.75" : "(h-text_h)/2";
  const align = captionStyle.align;
  const font = loadFont(resolvedFont);

  // Words are drawn one at a time, and drawtext anchors each to the top of its own
  // bounding box, so "now" and "perfectly" would sit at different heights. Offsetting
  // by the font's ascent minus each text's own ascent puts every word on one baseline.
  const fontScale = font ? fontSize / font.unitsPerEm : 0;
  const ascentPx = font ? Math.round((font.ascender || 0) * fontScale) : 0;
  const glyphHeightPx = font ? Math.round(((font.ascender || 0) - (font.descender || 0)) * fontScale) : fontSize;
  const lineTop = captionStyle.position === "top"
    ? "h*0.2"
    : captionStyle.position === "bottom"
      ? "h*0.75"
      : `(h-${glyphHeightPx})/2`;
  const baselineY = `${lineTop}+${ascentPx}-ascent`;

  const escapeText = (value) => String(value).replace(/[\\':,]/g, "\\$&");

  // Where a run of text of a known width starts, in absolute pixels.
  const startOfLine = (width) => align === "right"
    ? VIDEO_WIDTH - TEXT_MARGIN - width
    : align === "center"
      ? (VIDEO_WIDTH - width) / 2
      : TEXT_MARGIN;

  // Used only when the font cannot be measured; ffmpeg centres on its own text width,
  // which is why the highlight cannot be positioned to match it exactly.
  const fallbackX = align === "right" ? `w-text_w-${TEXT_MARGIN}` : align === "center" ? "(w-text_w)/2" : `${TEXT_MARGIN}`;

  const chunks = [];
  for (let index = 0; index < words.length; index += groupSize) {
    const group = words.slice(index, index + groupSize);
    const groupWords = group.map((word) => String(word.punctuated_word || word.word));
    const groupText = groupWords.join(" ");
    const start = Number(group[0].start.toFixed(3));
    const end = Number(group.at(-1).end.toFixed(3));

    const wordWidths = groupWords.map((word) => measureText(font, word, fontSize));
    const spaceWidth = measureText(font, " ", fontSize);
    const measured = wordWidths.every((width) => width > 0);

    if (!measured) {
      // No readable font file: fall back to letting ffmpeg lay out the whole line. The
      // highlight cannot be aligned to that, so the group is drawn without one.
      chunks.push(`drawtext=${fontSource}:text='${escapeText(groupText)}':fontcolor=${textColor}:fontsize=${fontSize}:borderw=${strokeWidth}:bordercolor=${strokeColor}:x=${fallbackX}:y=${position}:enable=between(t\\,${start}\\,${end})`);
      continue;
    }

    // Every word is positioned here rather than by ffmpeg's own line layout, so the
    // highlight lands on exactly the pixels the base word occupies.
    const groupWidth = wordWidths.reduce((sum, width) => sum + width, 0) + spaceWidth * (groupWords.length - 1);
    const lineStart = startOfLine(groupWidth);
    let cursor = lineStart;

    groupWords.forEach((word, wordIndex) => {
      const wordX = cursor.toFixed(2);
      cursor += wordWidths[wordIndex] + spaceWidth;
      const text = escapeText(word);
      const common = `${fontSource}:text='${text}':fontsize=${fontSize}:borderw=${strokeWidth}:bordercolor=${strokeColor}:x=${wordX}:y=${baselineY}`;

      chunks.push(`drawtext=${common}:fontcolor=${textColor}:enable=between(t\\,${start}\\,${end})`);

      if (style !== "summary") {
        const wordStart = Number(group[wordIndex].start.toFixed(3));
        const wordEnd = Number(group[wordIndex].end.toFixed(3));
        chunks.push(`drawtext=${common}:fontcolor=${highlightColor}:enable=between(t\\,${wordStart}\\,${wordEnd})`);
      }
    });
  }
  return chunks.join(",");
};

const COOKIE_BROWSERS = ["chrome", "chromium", "edge", "firefox", "brave", "opera", "vivaldi", "safari"];

// YouTube rejects anonymous requests for a growing share of videos; these let the user supply their own session.
const sourceArgs = ({ cookiesFromBrowser, cookiesFile } = {}) => {
  const args = ["--retries", "5", "--extractor-retries", "3", "--fragment-retries", "10"];
  if (cookiesFile?.trim()) args.push("--cookies", cookiesFile.trim());
  else if (COOKIE_BROWSERS.includes(cookiesFromBrowser)) args.push("--cookies-from-browser", cookiesFromBrowser);
  return args;
};

const ensureYtDlp = async () => {
  const binary = join(toolsDir, process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
  try {
    await fs.access(binary);
  } catch {
    const releases = await YTDlpWrap.getGithubReleases(1, 5);
    const release = releases.find((item) => item.tag_name) || releases[0];
    await YTDlpWrap.downloadFromGithub(binary, release.tag_name, process.platform);
  }
  return binary;
};

// Edge reports word boundaries in 100-nanosecond ticks. Reshaping them to match Deepgram's
// output lets the caption filter and canvas preview stay provider-agnostic.
const TICKS_PER_SECOND = 10_000_000;

const edgeSpeech = async ({ text, model }) => {
  const tts = new EdgeTTS();
  await tts.synthesize(text, model || "en-US-AriaNeural", { rate: "0%", volume: "0%", pitch: "0Hz" });
  const audioBase64 = await tts.toBase64();
  const words = (tts.getWordBoundaries() || []).map((boundary) => ({
    word: boundary.text,
    punctuated_word: boundary.text,
    start: boundary.offset / TICKS_PER_SECOND,
    end: (boundary.offset + boundary.duration) / TICKS_PER_SECOND
  }));
  return { audioBase64, words };
};

const providerRequest = async ({ provider, model, apiKey, material, inputType, mode, theme }) => {
  const sourceLabel = inputType === "idea" ? "idea" : "study material";
  const system = `You create short-form narrated scripts from a ${sourceLabel} for a reading video. Preserve facts and terminology when study material is supplied. Do not invent facts presented as true. Use plain spoken language, short sentences, and natural pauses for narration. The output must be only the script, with no title, bullets, markdown, or stage directions. The video mode is ${mode}. The story theme is ${theme}.`;
  const user = inputType === "idea"
    ? `Turn this idea into a focused short-form narration with a clear beginning, middle, and ending. Idea:\n\n${material}`
    : `Turn this study material into a focused narration script. Keep the core meaning and important details. Study material:\n\n${material}`;

  if (provider === "gemini") {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const result = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: `${system}\n\n${user}` }] }] })
    });
    const data = await result.json();
    if (!result.ok) throw new Error(data.error?.message || "Gemini request failed");
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  }

  const baseUrl = provider === "deepinfra" ? "https://api.deepinfra.com/v1/openai" : "https://api.openai.com/v1";
  const result = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "system", content: system }, { role: "user", content: user }] })
  });
  const data = await result.json();
  if (!result.ok) throw new Error(data.error?.message || `${provider} request failed`);
  return data.choices?.[0]?.message?.content || "";
};

const server = createHttpServer((request, response) => {
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  // Kept before the password gate so the platform health check can reach it.
  if (request.method === "GET" && request.url === "/api/health") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (!isAuthorized(request)) {
    response.writeHead(401, { "WWW-Authenticate": 'Basic realm="FocusVid Reader", charset="UTF-8"' });
    response.end("Authentication required");
    return;
  }

  if (request.method === "GET" && request.url === "/api/clips") {
    fs.readdir(clipsDir, { withFileTypes: true }).then(async (entries) => {
      const files = entries.filter((entry) => entry.isFile() && /\.(mp4|webm|mov|mkv|m4v)$/i.test(entry.name));
      const clips = await Promise.all(files.map(async (entry) => ({
        name: entry.name,
        url: `/clips/${encodeURIComponent(entry.name)}`,
        duration: await probeDuration(join(clipsDir, entry.name))
      })));
      sendJson(response, 200, clips);
    }).catch(() => sendJson(response, 500, { error: "Could not read clips" }));
    return;
  }

  if (request.method === "GET" && request.url.startsWith("/clips/")) {
    const filename = safeName(decodeURIComponent(request.url.slice("/clips/".length)));
    const filepath = join(clipsDir, filename);
    fs.stat(filepath).then((stat) => {
      response.writeHead(200, { "Content-Length": stat.size, "Content-Type": extname(filepath).toLowerCase() === ".webm" ? "video/webm" : "video/mp4" });
      createReadStream(filepath).pipe(response);
    }).catch(() => sendJson(response, 404, { error: "Clip not found" }));
    return;
  }

  if (request.method === "GET" && request.url.startsWith("/outputs/")) {
    const filename = safeName(decodeURIComponent(request.url.slice("/outputs/".length)));
    const filepath = join(outputsDir, filename);
    fs.stat(filepath).then((stat) => {
      response.writeHead(200, { "Content-Length": stat.size, "Content-Type": "video/mp4" });
      createReadStream(filepath).pipe(response);
    }).catch(() => sendJson(response, 404, { error: "Output not found" }));
    return;
  }

  // Streamed so a multi-hundred-megabyte gameplay clip never has to be held in memory as base64.
  if (request.method === "POST" && request.url.startsWith("/api/clips/upload")) {
    const requested = new URL(request.url, "http://127.0.0.1").searchParams.get("name") || "upload.mp4";
    const name = safeName(decodeURIComponent(requested));
    if (!/\.(mp4|webm|mov|mkv|m4v)$/i.test(name)) {
      sendJson(response, 400, { error: "Unsupported video file type." });
      return;
    }
    const filename = `${Date.now()}-${name}`;
    const target = join(clipsDir, filename);
    const stream = createWriteStream(target);
    request.pipe(stream);
    stream.on("finish", async () => {
      const duration = await probeDuration(target);
      sendJson(response, 200, { name: filename, url: `/clips/${encodeURIComponent(filename)}`, duration });
    });
    stream.on("error", async () => {
      await fs.rm(target, { force: true });
      sendJson(response, 500, { error: "Could not save the uploaded clip." });
    });
    request.on("error", () => stream.destroy());
    return;
  }

  if (request.method === "POST" && request.url === "/api/clips/search") {
    readJson(request).then(async ({ query, limit = 10, cookiesFromBrowser, cookiesFile }) => {
      if (!query?.trim()) {
        sendJson(response, 400, { error: "A search query is required." });
        return;
      }
      try {
        const binary = await ensureYtDlp();
        const count = Math.max(1, Math.min(25, Number(limit) || 10));
        const { stdout } = await runCapture(binary, [
          `ytsearch${count}:${query.trim()}`,
          "--flat-playlist",
          "--dump-single-json",
          "--no-warnings",
          ...sourceArgs({ cookiesFromBrowser, cookiesFile })
        ]);
        const parsed = JSON.parse(stdout || "{}");
        const results = (parsed.entries || [])
          .filter((entry) => entry?.id)
          .map((entry) => ({
            id: entry.id,
            title: entry.title || "Untitled",
            channel: entry.channel || entry.uploader || "",
            duration: Number(entry.duration) || 0,
            url: entry.url?.startsWith("http") ? entry.url : `https://www.youtube.com/watch?v=${entry.id}`
          }));
        sendJson(response, 200, { results });
      } catch (error) {
        sendJson(response, 502, { error: error.message });
      }
    }).catch(() => sendJson(response, 400, { error: "Invalid JSON request." }));
    return;
  }

  if (request.method === "POST" && request.url === "/api/clips/download") {
    readJson(request).then(async ({ url, sectionSeconds = 0, randomSection = false, cookiesFromBrowser, cookiesFile }) => {
      if (!url?.startsWith("https://")) {
        sendJson(response, 400, { error: "A valid HTTPS video URL is required." });
        return;
      }
      try {
        const binary = await ensureYtDlp();
        const ffmpegDir = dirname(ffmpegPath);
        const wanted = Math.max(0, Math.min(900, Number(sectionSeconds) || 0));
        const formatArgs = [
          "-f",
          "bv*[height<=1440][ext=mp4]+ba[ext=m4a]/bv*[height<=1440]+ba/b[height<=1440]/b",
          "--merge-output-format",
          "mp4",
          "--ffmpeg-location",
          ffmpegDir,
          "--no-playlist",
          "--no-warnings",
          ...sourceArgs({ cookiesFromBrowser, cookiesFile })
        ];

        let label = "clip";
        let sourceDuration = 0;
        if (wanted > 0) {
          const { stdout } = await runCapture(binary, [url, "--dump-single-json", "--no-playlist", "--no-warnings", ...sourceArgs({ cookiesFromBrowser, cookiesFile })]);
          const info = JSON.parse(stdout || "{}");
          label = (info.title || "clip").slice(0, 40);
          sourceDuration = Number(info.duration) || 0;
        }

        const filename = `${safeName(label)}-${Date.now()}.mp4`;
        const target = join(clipsDir, filename);
        const trimming = wanted > 0 && sourceDuration > wanted + 5;
        const start = trimming && randomSection ? randomStartOffset(sourceDuration, wanted + 5) : 0;

        if (trimming) {
          try {
            await runProcess(binary, [
              url,
              ...formatArgs,
              "--download-sections", `*${start.toFixed(2)}-${(start + wanted).toFixed(2)}`,
              "--force-keyframes-at-cuts",
              "-o", target
            ]);
          } catch {
            const fullPath = join(clipsDir, `full-${filename}`);
            try {
              await runProcess(binary, [url, ...formatArgs, "-o", fullPath]);
              await trimClip(fullPath, target, start, wanted);
            } finally {
              await fs.rm(fullPath, { force: true });
            }
          }
        } else {
          await runProcess(binary, [url, ...formatArgs, "-o", target]);
        }

        const duration = await probeDuration(target);
        sendJson(response, 200, { name: filename, url: `/clips/${encodeURIComponent(filename)}`, duration });
      } catch (error) {
        sendJson(response, 502, { error: error.message });
      }
    }).catch(() => sendJson(response, 400, { error: "Invalid JSON request." }));
    return;
  }

  if (request.method === "POST" && request.url === "/api/transcribe") {
    readJson(request).then(async ({ apiKey, audioBase64 }) => {
      if (!apiKey || !audioBase64) {
        sendJson(response, 400, { error: "Deepgram key and audio are required." });
        return;
      }
      try {
        const result = await fetch("https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true", {
          method: "POST",
          headers: { Authorization: `Token ${apiKey}`, "Content-Type": "audio/mpeg" },
          body: Buffer.from(audioBase64, "base64")
        });
        const data = await result.json();
        if (!result.ok) throw new Error(data.error?.message || "Deepgram transcription failed");
        sendJson(response, 200, { words: data.results?.channels?.[0]?.alternatives?.[0]?.words || [] });
      } catch (error) {
        sendJson(response, 502, { error: error.message });
      }
    }).catch(() => sendJson(response, 400, { error: "Invalid JSON request." }));
    return;
  }

  if (request.method === "POST" && request.url === "/api/render") {
    readJson(request).then(async ({ backgroundBase64, backgroundUrl, audioBase64, words, textStyle, captionStyle, fontBase64, fontFileName, clipOffset = 0, randomStart = false, backgroundVolume = 0 }) => {
      if ((!backgroundBase64 && !backgroundUrl?.startsWith("/clips/")) || !audioBase64 || !words?.length) {
        sendJson(response, 400, { error: "Background clip, audio, and word timings are required." });
        return;
      }
      const id = randomUUID();
      const backgroundName = backgroundUrl?.startsWith("/clips/") ? safeName(decodeURIComponent(backgroundUrl.slice("/clips/".length))) : "";
      const sourceBackgroundPath = backgroundName ? join(clipsDir, backgroundName) : "";
      const backgroundPath = join(outputsDir, `${id}-background${extname(sourceBackgroundPath || ".mp4") || ".mp4"}`);
      const audioPath = join(outputsDir, `${id}-voice.mp3`);
      const fontPath = fontBase64 ? join(outputsDir, `${id}-${safeName(fontFileName || "custom-font.ttf")}`) : "";
      const outputPath = join(outputsDir, `${id}.mp4`);
      try {
        if (backgroundBase64) await fs.writeFile(backgroundPath, Buffer.from(backgroundBase64, "base64"));
        else await fs.copyFile(sourceBackgroundPath, backgroundPath);
        await fs.writeFile(audioPath, Buffer.from(audioBase64, "base64"));
        if (fontPath) await fs.writeFile(fontPath, Buffer.from(fontBase64, "base64"));

        const narrationSeconds = Number(words.at(-1)?.end) || 0;
        const background = await probeMedia(backgroundPath);
        const offset = randomStart
          ? randomStartOffset(background.duration, narrationSeconds)
          : Math.max(0, Number(clipOffset) || 0);
        const gameplayVolume = background.hasAudio ? Math.max(0, Math.min(1, Number(backgroundVolume) || 0)) : 0;
        const audioArgs = gameplayVolume > 0
          ? ["-filter_complex", `[0:a]volume=${gameplayVolume.toFixed(2)}[bg];[1:a][bg]amix=inputs=2:duration=first:dropout_transition=0[aout]`, "-map", "[aout]"]
          : ["-map", "1:a:0"];

        await runProcess(ffmpegPath, [
          "-y",
          "-stream_loop", "-1",
          "-ss", String(offset),
          "-i", backgroundPath,
          "-i", audioPath,
          "-map", "0:v:0",
          ...audioArgs,
          "-vf", `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,${createCaptionFilter(words, textStyle, captionStyle, fontPath)}`,
          "-t", String(Math.max(1, narrationSeconds)),
          "-r", "30",
          "-c:v", "libx264",
          "-preset", "veryfast",
          "-crf", "23",
          "-pix_fmt", "yuv420p",
          "-c:a", "aac",
          "-b:a", "192k",
          "-movflags", "+faststart",
          outputPath
        ]);
        sendJson(response, 200, { url: `/outputs/${id}.mp4`, clipOffset: offset });
      } catch (error) {
        sendJson(response, 502, { error: error.message });
      } finally {
        await Promise.all([backgroundPath, audioPath, fontPath].filter(Boolean).map((filepath) => fs.rm(filepath, { force: true })));
      }
    }).catch(() => sendJson(response, 400, { error: "Invalid JSON request." }));
    return;
  }

  if (request.method === "POST" && request.url === "/api/generate") {
    readJson(request).then(async ({ provider, model, apiKey, material, inputType, mode, theme }) => {
      if (!provider || !model || !apiKey || !material?.trim()) {
        sendJson(response, 400, { error: "Provider, model, API key, and material are required." });
        return;
      }
      try {
        const script = await providerRequest({ provider, model, apiKey, material, inputType, mode, theme });
        if (!script.trim()) throw new Error("The AI provider returned an empty script.");
        sendJson(response, 200, { script });
      } catch (error) {
        sendJson(response, 502, { error: error.message });
      }
    }).catch(() => sendJson(response, 400, { error: "Invalid JSON request." }));
    return;
  }

  if (request.method === "POST" && request.url === "/api/tts") {
    readJson(request).then(async ({ apiKey, model, text, provider }) => {
      if (!text?.trim()) {
        sendJson(response, 400, { error: "Text is required." });
        return;
      }
      if (provider === "edge") {
        try {
          sendJson(response, 200, await edgeSpeech({ text, model }));
        } catch (error) {
          sendJson(response, 502, { error: error.message || "Edge voice generation failed" });
        }
        return;
      }
      if (!apiKey) {
        sendJson(response, 400, { error: "Deepgram key and text are required." });
        return;
      }
      try {
        const result = await fetch(`https://api.deepgram.com/v1/speak?model=${encodeURIComponent(model || "aura-asteria-en")}&encoding=mp3`, {
          method: "POST",
          headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ text })
        });
        const audio = await result.arrayBuffer();
        if (!result.ok) {
          sendJson(response, 502, { error: Buffer.from(audio).toString("utf8") || "Deepgram request failed" });
          return;
        }
        response.writeHead(200, { "Content-Type": "audio/mpeg", "Content-Length": audio.byteLength });
        response.end(Buffer.from(audio));
      } catch (error) {
        sendJson(response, 502, { error: error.message });
      }
    }).catch(() => sendJson(response, 400, { error: "Invalid JSON request." }));
    return;
  }

  if (request.method === "GET" && !request.url.startsWith("/api/")) {
    sendStatic(response, request.url);
    return;
  }

  sendJson(response, 404, { error: "Not found" });
});

await resolveDefaultFont();

server.listen(port, host, () => {
  console.log(`FocusVid listening on http://${host}:${port}`);
  console.log(defaultFontPath ? `Caption font: ${defaultFontPath}` : "No font file found - set FONT_PATH if captions fail to render.");
  console.log(appPassword ? "Password protection is on." : "No APP_PASSWORD set - the app is open to anyone who can reach it.");
});
