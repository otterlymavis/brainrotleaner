import { createServer as createHttpServer } from "node:http";
import { promises as fs, createReadStream, createWriteStream, readFileSync } from "node:fs";
import opentype from "opentype.js";
import { join, basename, extname, dirname, resolve, sep } from "node:path";
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
const musicDir = join(dataDir, "music");
const voiceoversDir = join(dataDir, "voiceovers");
const outputsDir = join(dataDir, "outputs");
const toolsDir = join(dataDir, "tools");
const MAX_JSON_BODY_BYTES = 64 * 1024 * 1024;
const MAX_CLIP_UPLOAD_BYTES = 1024 * 1024 * 1024;
const MAX_AUDIO_UPLOAD_BYTES = 256 * 1024 * 1024;

await Promise.all([
  fs.mkdir(clipsDir, { recursive: true }),
  fs.mkdir(musicDir, { recursive: true }),
  fs.mkdir(voiceoversDir, { recursive: true }),
  fs.mkdir(outputsDir, { recursive: true }),
  fs.mkdir(toolsDir, { recursive: true })
]);

const readJson = async (request) => {
  const declaredLength = Number(request.headers["content-length"] || 0);
  if (declaredLength > MAX_JSON_BODY_BYTES) {
    const error = new Error("Request body is too large.");
    error.statusCode = 413;
    throw error;
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_JSON_BODY_BYTES) {
      const error = new Error("Request body is too large.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
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
const AUDIO_EXTENSIONS = /\.(mp3|wav|m4a|aac|ogg|flac)$/i;
const audioContentType = (filepath) => ({
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac"
}[extname(filepath).toLowerCase()] || "application/octet-stream");

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
  // Never serve outside the build directory, whatever the request path claims. The
  // separator matters: a bare prefix test also accepts siblings like dist-backup.
  const root = resolve(staticDir);
  const inside = candidate === root || candidate.startsWith(root + sep);
  const filepath = inside ? candidate : join(staticDir, "index.html");
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
const RENDER_PROFILES = {
  portrait: { width: 1080, height: 1920 },
  landscape: { width: 1920, height: 1080 },
  square: { width: 1080, height: 1080 }
};
const RENDER_LAYOUTS = new Set(["full", "bottom-third", "split"]);
const WATERMARK_SCALES = new Set(["small", "medium", "large"]);
const DEFAULT_RENDER_OPTIONS = Object.freeze({
  renderProfile: "portrait",
  layout: "full",
  watermark: Object.freeze({ enabled: false, text: "", opacity: 0.72, scale: "medium" })
});
const TEXT_MARGIN = 72;

const normalizeRenderOptions = ({ renderProfile, layout, watermark } = {}) => {
  const profileKey = Object.prototype.hasOwnProperty.call(RENDER_PROFILES, renderProfile) ? renderProfile : DEFAULT_RENDER_OPTIONS.renderProfile;
  const layoutKey = RENDER_LAYOUTS.has(layout) ? layout : DEFAULT_RENDER_OPTIONS.layout;
  const source = watermark && typeof watermark === "object" ? watermark : {};
  const text = String(source.text || "").trim();
  const opacityValue = Number(source.opacity);
  const opacity = Number.isFinite(opacityValue) ? Math.max(0.05, Math.min(1, opacityValue)) : DEFAULT_RENDER_OPTIONS.watermark.opacity;
  const scale = WATERMARK_SCALES.has(source.scale) ? source.scale : DEFAULT_RENDER_OPTIONS.watermark.scale;
  return {
    renderProfile: profileKey,
    layout: layoutKey,
    watermark: { enabled: Boolean(source.enabled) && Boolean(text), text, opacity, scale }
  };
};

const normalizeSceneTimeline = (sceneTimeline, duration) => {
  if (!Array.isArray(sceneTimeline) || !sceneTimeline.length || !Number.isFinite(duration) || duration <= 0) return [];
  const normalized = sceneTimeline.map((scene, index) => ({
    start: Number(scene?.start),
    end: Number(scene?.end),
    index: Number.isInteger(scene?.index) ? scene.index : index
  }));
  if (normalized.some((scene) => !Number.isFinite(scene.start) || !Number.isFinite(scene.end) || scene.start < -0.05 || scene.end <= scene.start)) return [];
  if (normalized[0].start > 0.05 || normalized.at(-1).end < duration - 0.05) return [];
  for (let index = 1; index < normalized.length; index += 1) {
    if (Math.abs(normalized[index].start - normalized[index - 1].end) > 0.08) return [];
  }
  return normalized.map((scene, index) => ({
    start: index === 0 ? 0 : Math.max(0, normalized[index - 1].end),
    end: index === normalized.length - 1 ? duration : Math.min(duration, scene.end),
    index: scene.index
  })).filter((scene) => scene.end > scene.start);
};

const buildSynchronizedGameplay = (filterParts, sceneTimeline, clipDuration) => {
  if (!sceneTimeline.length || !clipDuration) return "[0:v]";
  const inputLabels = sceneTimeline.map((_, index) => `[scene-input-${index}]`);
  filterParts.push(`[0:v]split=${sceneTimeline.length}${inputLabels.join("")}`);
  const sceneLabels = [];
  const normalWidth = 1920;
  const normalHeight = 1080;
  const emphasisWidth = 2036;
  const emphasisHeight = 1144;
  sceneTimeline.forEach((scene, index) => {
    const duration = Math.max(0.01, scene.end - scene.start);
    // The input is already seeked to the requested clip offset before it reaches
    // this filter graph, so scene trims must be relative to that seeked input.
    const segmentStart = (index / sceneTimeline.length) * clipDuration;
    const portions = [
      { start: segmentStart, duration: Math.min(0.125, duration), zoom: false },
      { start: segmentStart + 0.125, duration: Math.min(0.125, Math.max(0, duration - 0.125)), zoom: true },
      { start: segmentStart + 0.25, duration: Math.max(0, duration - 0.25), zoom: false }
    ].filter((portion) => portion.duration > 0.005);
    const portionInputs = portions.map((_, portionIndex) => `[scene-${index}-portion-input-${portionIndex}]`);
    filterParts.push(`${inputLabels[index]}split=${portions.length}${portionInputs.join("")}`);
    const portionLabels = [];
    portions.forEach((portion, portionIndex) => {
      const portionLabel = `[scene-${index}-portion-${portionIndex}]`;
      portionLabels.push(portionLabel);
      const scale = portion.zoom
        ? `scale=${emphasisWidth}:${emphasisHeight}:force_original_aspect_ratio=increase,crop=${normalWidth}:${normalHeight},setsar=1`
        : `scale=${normalWidth}:${normalHeight}:force_original_aspect_ratio=increase,crop=${normalWidth}:${normalHeight},setsar=1`;
      filterParts.push(`${portionInputs[portionIndex]}trim=start=${(portion.start % clipDuration).toFixed(3)}:duration=${portion.duration.toFixed(3)},setpts=PTS-STARTPTS,${scale}${portionLabel}`);
    });
    const sceneLabel = `[scene-segment-${index}]`;
    sceneLabels.push(sceneLabel);
    filterParts.push(`${portionLabels.join("")}concat=n=${portionLabels.length}:v=1:a=0${sceneLabel}`);
  });
  filterParts.push(`${sceneLabels.join("")}concat=n=${sceneLabels.length}:v=1:a=0[synchronized-gameplay]`);
  return "[synchronized-gameplay]";
};

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

const createCaptionFilter = (words, style, captionStyle = {}, fontPath = "", renderProfile = "portrait", layout = "full", watermark = {}) => {
  const profile = RENDER_PROFILES[renderProfile] || RENDER_PROFILES.portrait;
  const videoWidth = profile.width;
  const margin = Math.round(TEXT_MARGIN * videoWidth / 1080);
  // Show a three-line caption window while keeping the active-word timing.
  const groupSize = Math.max(1, Number.parseInt(style, 10) || 3);
  const fontSize = Math.max(28, Math.min(140, Math.round((Number(captionStyle.fontSize) || 58) * videoWidth / 1080)));
  const textColor = hexColor(captionStyle.textColor, "#f8fafc");
  const strokeColor = hexColor(captionStyle.strokeColor, "#101820");
  const strokeWidth = Math.max(0, Math.min(12, Number(captionStyle.strokeWidth) || 0));
  const requestedFont = captionStyle.fontFamily === "Inter, Arial, sans-serif" ? "Arial" : captionStyle.fontFamily;
  const fontFamily = ["Arial", "Georgia", "Trebuchet MS", "Courier New"].includes(requestedFont) ? requestedFont : "Arial";
  const resolvedFont = fontPath || defaultFontPath;
  const fontSource = resolvedFont ? "fontfile='" + escapeFilterPath(resolvedFont) + "'" : "font='" + fontFamily + "'";
  const highlightColor = hexColor(captionStyle.highlightColor, "#a35c7a");
  const position = captionStyle.position === "top" ? "h*0.2" : captionStyle.position === "bottom" ? "h*0.75" : layout === "bottom-third" ? "h*0.28" : "(h-text_h)/2";
  const align = captionStyle.align;
  const contentWidth = layout === "split" ? Math.round(videoWidth * 0.52) : videoWidth;
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
      : layout === "bottom-third" ? "h*0.28" : `(h-${glyphHeightPx})/2`;

  const escapeText = (value) => String(value).replace(/[\\':,]/g, "\\$&");

  // Where a run of text of a known width starts, in absolute pixels.
  const startOfLine = (width) => align === "right"
    ? contentWidth - margin - width
    : align === "center"
      ? (contentWidth - width) / 2
      : margin;

  // Used only when the font cannot be measured; ffmpeg centres on its own text width,
  // which is why the highlight cannot be positioned to match it exactly.
  const fallbackX = align === "right" ? `${contentWidth}-text_w-${margin}` : align === "center" ? `(${contentWidth}-text_w)/2` : `${margin}`;

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
      chunks.push(`drawtext=${fontSource}:text='${escapeText(groupText)}':expansion=none:fontcolor=${textColor}:fontsize=${fontSize}:borderw=${strokeWidth}:bordercolor=${strokeColor}:x=${fallbackX}:y=${position}:enable=between(t\\,${start}\\,${end})`);
      continue;
    }

    // Every word is positioned here rather than by ffmpeg's own line layout, so the
    // highlight lands on exactly the pixels the base word occupies.
    const maxLineWidth = contentWidth - margin * 2;
    const lines = [];
    let line = [];
    let lineWidth = 0;
    groupWords.forEach((word, wordIndex) => {
      const nextWidth = line.length ? lineWidth + spaceWidth + wordWidths[wordIndex] : wordWidths[wordIndex];
      if (line.length && nextWidth > maxLineWidth) {
        lines.push({ words: line, width: lineWidth });
        line = [];
        lineWidth = 0;
      }
      line.push({ word, wordIndex });
      lineWidth = line.length === 1 ? wordWidths[wordIndex] : lineWidth + spaceWidth + wordWidths[wordIndex];
    });
    if (line.length) lines.push({ words: line, width: lineWidth });

    const lineHeight = Math.round(Number(captionStyle.lineHeight) || fontSize * 1.24);
    lines.forEach((captionLine, lineIndex) => {
      const lineStart = startOfLine(captionLine.width);
      let cursor = lineStart;
      const lineY = captionStyle.position === "top" || captionStyle.position === "bottom" || layout === "bottom-third"
        ? `${lineTop}+${lineIndex * lineHeight}+${ascentPx}-ascent`
        : `(h-${glyphHeightPx * lines.length + lineHeight * (lines.length - 1)})/2+${lineIndex * lineHeight}+${ascentPx}-ascent`;

      captionLine.words.forEach(({ word, wordIndex }) => {
        const wordX = cursor.toFixed(2);
        cursor += wordWidths[wordIndex] + spaceWidth;
        const text = escapeText(word);
        // expansion=none: drawtext otherwise treats %{...} as a directive, so a caption
        // containing a percent sign renders wrong or vanishes.
        const common = `${fontSource}:text='${text}':expansion=none:fontsize=${fontSize}:borderw=${strokeWidth}:bordercolor=${strokeColor}:x=${wordX}:y=${lineY}`;

        chunks.push(`drawtext=${common}:fontcolor=${textColor}:enable=between(t\\,${start}\\,${end})`);

        if (style !== "summary") {
          const wordStart = Number(group[wordIndex].start.toFixed(3));
          const wordEnd = Number(group[wordIndex].end.toFixed(3));
          chunks.push(`drawtext=${common}:fontcolor=${highlightColor}:enable=between(t\\,${wordStart}\\,${wordEnd})`);
        }
      });
    });
  }
  if (watermark?.enabled && watermark.text?.trim()) {
    const watermarkSize = Math.round(({ small: 24, medium: 32, large: 44 }[watermark.scale] || 32) * videoWidth / 1080);
    const opacity = Math.max(0.05, Math.min(1, Number(watermark.opacity) || 0.72)).toFixed(2);
    const watermarkText = escapeText(watermark.text.trim());
    chunks.push(`drawtext=${fontSource}:text='${watermarkText}':expansion=none:fontcolor=white@${opacity}:fontsize=${watermarkSize}:x=w-text_w-${margin}:y=h-text_h-${margin}:enable=gte(t\\,0)`);
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
  response.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "*");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
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

  const listAudio = (directory, prefix) => fs.readdir(directory, { withFileTypes: true }).then(async (entries) => {
    const files = entries.filter((entry) => entry.isFile() && AUDIO_EXTENSIONS.test(entry.name));
    return Promise.all(files.map(async (entry) => ({
      name: entry.name,
      url: `/${prefix}/${encodeURIComponent(entry.name)}`,
      duration: await probeDuration(join(directory, entry.name))
    })));
  });

  if (request.method === "GET" && request.url === "/api/music") {
    listAudio(musicDir, "music").then((tracks) => sendJson(response, 200, tracks)).catch(() => sendJson(response, 500, { error: "Could not read music library" }));
    return;
  }

  if (request.method === "GET" && request.url === "/api/voiceovers") {
    listAudio(voiceoversDir, "voiceovers").then((tracks) => sendJson(response, 200, tracks)).catch(() => sendJson(response, 500, { error: "Could not read voiceover library" }));
    return;
  }

  if (request.method === "GET" && (request.url.startsWith("/music/") || request.url.startsWith("/voiceovers/"))) {
    const isMusic = request.url.startsWith("/music/");
    const prefix = isMusic ? "/music/" : "/voiceovers/";
    const directory = isMusic ? musicDir : voiceoversDir;
    const filename = safeName(decodeURIComponent(request.url.slice(prefix.length)));
    const filepath = join(directory, filename);
    fs.stat(filepath).then((stat) => {
      response.writeHead(200, { "Content-Length": stat.size, "Content-Type": audioContentType(filepath), "Accept-Ranges": "bytes" });
      createReadStream(filepath).pipe(response);
    }).catch(() => sendJson(response, 404, { error: "Audio file not found" }));
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
    if (Number(request.headers["content-length"] || 0) > MAX_CLIP_UPLOAD_BYTES) {
      sendJson(response, 413, { error: "Uploaded clip is too large." });
      return;
    }
    const stream = createWriteStream(target);
    let received = 0;
    let rejected = false;
    request.on("data", (chunk) => {
      received += chunk.length;
      if (received > MAX_CLIP_UPLOAD_BYTES && !rejected) {
        rejected = true;
        request.unpipe(stream);
        stream.destroy();
        request.resume();
        fs.rm(target, { force: true }).catch(() => undefined);
        sendJson(response, 413, { error: "Uploaded clip is too large." });
      }
    });
    request.pipe(stream);
    stream.on("finish", async () => {
      if (rejected) return;
      const duration = await probeDuration(target);
      sendJson(response, 200, { name: filename, url: `/clips/${encodeURIComponent(filename)}`, duration });
    });
    stream.on("error", async () => {
      if (rejected) return;
      await fs.rm(target, { force: true });
      sendJson(response, 500, { error: "Could not save the uploaded clip." });
    });
    request.on("error", () => stream.destroy());
    return;
  }

  const uploadAudio = (request, response, directory, prefix, label) => {
    const requested = new URL(request.url, "http://127.0.0.1").searchParams.get("name") || `${label}.mp3`;
    const name = safeName(decodeURIComponent(requested));
    if (!AUDIO_EXTENSIONS.test(name)) {
      sendJson(response, 400, { error: "Unsupported audio file type. Use MP3, WAV, M4A, AAC, OGG, or FLAC." });
      return;
    }
    const filename = `${Date.now()}-${name}`;
    const target = join(directory, filename);
    if (Number(request.headers["content-length"] || 0) > MAX_AUDIO_UPLOAD_BYTES) {
      sendJson(response, 413, { error: `Uploaded ${label} is too large.` });
      return;
    }
    const stream = createWriteStream(target);
    let received = 0;
    let rejected = false;
    request.on("data", (chunk) => {
      received += chunk.length;
      if (received > MAX_AUDIO_UPLOAD_BYTES && !rejected) {
        rejected = true;
        request.unpipe(stream);
        stream.destroy();
        request.resume();
        fs.rm(target, { force: true }).catch(() => undefined);
        sendJson(response, 413, { error: `Uploaded ${label} is too large.` });
      }
    });
    request.pipe(stream);
    stream.on("finish", async () => {
      if (rejected) return;
      try {
        const media = await probeMedia(target);
        if (!media.duration) throw new Error("The uploaded audio could not be read.");
        sendJson(response, 200, { name: filename, url: `/${prefix}/${encodeURIComponent(filename)}`, duration: media.duration });
      } catch (error) {
        await fs.rm(target, { force: true });
        sendJson(response, 400, { error: error.message || `Could not save the ${label}.` });
      }
    });
    stream.on("error", async () => {
      if (rejected) return;
      await fs.rm(target, { force: true });
      sendJson(response, 500, { error: `Could not save the ${label}.` });
    });
    request.on("error", () => stream.destroy());
  };

  if (request.method === "POST" && request.url.startsWith("/api/music/upload")) {
    uploadAudio(request, response, musicDir, "music", "music track");
    return;
  }

  if (request.method === "POST" && request.url.startsWith("/api/voiceovers/upload")) {
    uploadAudio(request, response, voiceoversDir, "voiceovers", "voiceover");
    return;
  }

  if (request.method === "POST" && request.url === "/api/clips/search") {
    readJson(request).then(async ({ query, limit = 10, channelUrl, cookiesFromBrowser, cookiesFile }) => {
      if (!query?.trim() && !channelUrl?.trim()) {
        sendJson(response, 400, { error: "A search query or channel is required." });
        return;
      }
      try {
        const binary = await ensureYtDlp();
        const count = Math.max(1, Math.min(25, Number(limit) || 10));
        // Browsing a channel's uploads is the highest-signal way to find more of the same
        // footage: a channel with one usable parkour video usually has many.
        const target = channelUrl?.trim()
          ? `${channelUrl.trim().replace(/\/+$/, "")}/videos`
          : `ytsearch${count}:${query.trim()}`;
        const { stdout } = await runCapture(binary, [
          target,
          "--flat-playlist",
          "--dump-single-json",
          "--no-warnings",
          "--playlist-end", String(count),
          ...sourceArgs({ cookiesFromBrowser, cookiesFile })
        ]);
        const parsed = JSON.parse(stdout || "{}");
        const results = (parsed.entries || [])
          .filter((entry) => entry?.id)
          .map((entry) => ({
            id: entry.id,
            title: entry.title || "Untitled",
            channel: entry.channel || entry.uploader || parsed.channel || parsed.uploader || "",
            channelUrl: entry.uploader_url || entry.channel_url || parsed.uploader_url || parsed.channel_url || "",
            duration: Number(entry.duration) || 0,
            views: Number(entry.view_count) || 0,
            url: entry.url?.startsWith("http") ? entry.url : `https://www.youtube.com/watch?v=${entry.id}`
          }));
        sendJson(response, 200, { results, source: channelUrl ? (parsed.channel || parsed.title || "channel") : "" });
      } catch (error) {
        sendJson(response, 502, { error: error.message });
      }
    }).catch((error) => {
      if (!response.writableEnded) {
        sendJson(response, error.statusCode || 400, { error: error.statusCode === 413 ? error.message : "Invalid JSON request." });
      }
    });
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
    const renderAbort = new AbortController();
    const abortRender = () => {
      if (!response.writableEnded) renderAbort.abort();
    };
    request.on("aborted", abortRender);
    response.on("close", abortRender);

    readJson(request).then(async ({ backgroundBase64, backgroundUrl, audioBase64, words = [], textStyle, captionStyle, fontBase64, fontFileName, clipOffset = 0, randomStart = false, backgroundVolume = 0, musicUrl = "", musicBase64 = "", musicVolume = 0.18, ducking = true, narrationVolume = 1, syncGameplay = false, sceneTimeline = [], renderProfile, layout, watermark }) => {
      if ((!backgroundBase64 && !backgroundUrl?.startsWith("/clips/")) || !audioBase64) {
        sendJson(response, 400, { error: "Background clip and narration audio are required." });
        return;
      }
      const renderOptions = normalizeRenderOptions({ renderProfile, layout, watermark });
      const id = randomUUID();
      const backgroundName = backgroundUrl?.startsWith("/clips/") ? safeName(decodeURIComponent(backgroundUrl.slice("/clips/".length))) : "";
      const sourceBackgroundPath = backgroundName ? join(clipsDir, backgroundName) : "";
      const backgroundPath = join(outputsDir, `${id}-background${extname(sourceBackgroundPath || ".mp4") || ".mp4"}`);
      const audioPath = join(outputsDir, `${id}-voice.mp3`);
      const musicName = musicUrl?.startsWith("/music/") ? safeName(decodeURIComponent(musicUrl.slice("/music/".length))) : "";
      const sourceMusicPath = musicName ? join(musicDir, musicName) : "";
      const musicPath = join(outputsDir, `${id}-music${extname(sourceMusicPath || ".mp3") || ".mp3"}`);
      const fontPath = fontBase64 ? join(outputsDir, `${id}-${safeName(fontFileName || "custom-font.ttf")}`) : "";
      const outputPath = join(outputsDir, `${id}.mp4`);
      try {
        if (backgroundBase64) await fs.writeFile(backgroundPath, Buffer.from(backgroundBase64, "base64"));
        else await fs.copyFile(sourceBackgroundPath, backgroundPath);
        await fs.writeFile(audioPath, Buffer.from(audioBase64, "base64"));
        if (musicBase64) await fs.writeFile(musicPath, Buffer.from(musicBase64, "base64"));
        else if (sourceMusicPath) await fs.copyFile(sourceMusicPath, musicPath);
        if (fontPath) await fs.writeFile(fontPath, Buffer.from(fontBase64, "base64"));

        const narrationMedia = await probeMedia(audioPath);
        const narrationSeconds = Number(words.at(-1)?.end) || narrationMedia.duration || 1;
        const background = await probeMedia(backgroundPath);
        const offset = randomStart
          ? randomStartOffset(background.duration, narrationSeconds)
          : Math.max(0, Number(clipOffset) || 0);
        const profile = RENDER_PROFILES[renderOptions.renderProfile];
        const outputWidth = profile.width;
        const outputHeight = profile.height;
        const captionFilter = words.length ? createCaptionFilter(words, textStyle, captionStyle, fontPath, renderOptions.renderProfile, renderOptions.layout, renderOptions.watermark) : "";
        const filterParts = [];
        const normalizedTimeline = syncGameplay ? normalizeSceneTimeline(sceneTimeline, narrationSeconds) : [];
        const gameplayInput = buildSynchronizedGameplay(filterParts, normalizedTimeline, background.duration);
        if (renderOptions.layout === "bottom-third") {
          const gameplayHeight = Math.round(outputHeight * 0.35);
          const gameplayY = outputHeight - gameplayHeight;
          filterParts.push(`${gameplayInput}scale=${outputWidth}:${gameplayHeight}:force_original_aspect_ratio=increase,crop=${outputWidth}:${gameplayHeight}[game]`);
          filterParts.push(`color=c=#141821:s=${outputWidth}x${outputHeight}:d=${Math.max(1, narrationSeconds)}[base]`);
          filterParts.push(`[base][game]overlay=0:${gameplayY}[layout]`);
        } else if (renderOptions.layout === "split") {
          const contentWidth = Math.round(outputWidth * 0.52);
          const gameplayWidth = outputWidth - contentWidth;
          filterParts.push(`${gameplayInput}scale=${gameplayWidth}:${outputHeight}:force_original_aspect_ratio=increase,crop=${gameplayWidth}:${outputHeight}[game]`);
          filterParts.push(`color=c=#fff8fb:s=${outputWidth}x${outputHeight}:d=${Math.max(1, narrationSeconds)}[base]`);
          filterParts.push(`[base][game]overlay=${contentWidth}:0[layout]`);
        } else {
          filterParts.push(`${gameplayInput}scale=${outputWidth}:${outputHeight}:force_original_aspect_ratio=increase,crop=${outputWidth}:${outputHeight}[layout]`);
        }
        if (captionFilter) filterParts.push(`[layout]${captionFilter}[vout]`);
        const gameplayVolume = background.hasAudio ? Math.max(0, Math.min(1, Number(backgroundVolume) || 0)) : 0;
        const normalizedNarrationVolume = Math.max(0, Math.min(1.5, Number(narrationVolume) || 1));
        const normalizedMusicVolume = Math.max(0, Math.min(1, Number(musicVolume) || 0));
        const hasMusic = Boolean(musicBase64 || sourceMusicPath);
        const shouldDuck = hasMusic && normalizedMusicVolume > 0 && Boolean(ducking);
        const audioFilters = [shouldDuck
          ? `[1:a]volume=${normalizedNarrationVolume.toFixed(2)},asplit=2[voice][voice_sc]`
          : `[1:a]volume=${normalizedNarrationVolume.toFixed(2)}[voice]`];
        let audioMap = "[voice]";
        if (hasMusic && normalizedMusicVolume > 0) {
          audioFilters.push(`[2:a]volume=${normalizedMusicVolume.toFixed(2)}[music]`);
          if (shouldDuck) audioFilters.push(`[music][voice_sc]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=300:makeup=1[ducked]`);
          const musicLabel = shouldDuck ? "[ducked]" : "[music]";
          audioFilters.push(`[voice]${musicLabel}amix=inputs=2:duration=first:dropout_transition=0[mix]`);
          audioMap = "[mix]";
        }
        if (gameplayVolume > 0) {
          audioFilters.push(`[0:a]volume=${gameplayVolume.toFixed(2)}[game]`);
          audioFilters.push(`${audioMap}[game]amix=inputs=2:duration=first:dropout_transition=0[final]`);
          audioMap = "[final]";
        }

        const ffmpegArgs = [
          "-y",
          "-stream_loop", "-1",
          "-ss", String(offset),
          "-i", backgroundPath,
          "-i", audioPath,
        ];
        if (hasMusic) ffmpegArgs.push("-stream_loop", "-1", "-i", musicPath);
        ffmpegArgs.push(
          "-filter_complex", [...filterParts, ...audioFilters].join(";"),
          "-map", captionFilter ? "[vout]" : "[layout]",
          "-map", audioMap,
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
        );
        await runProcess(ffmpegPath, ffmpegArgs, { signal: renderAbort.signal });
        if (!response.writableEnded) sendJson(response, 200, { url: `/outputs/${id}.mp4`, clipOffset: offset });
      } catch (error) {
        if (renderAbort.signal.aborted) {
          await fs.rm(outputPath, { force: true });
          return;
        }
        if (!response.writableEnded) sendJson(response, 502, { error: error.message });
      } finally {
        await Promise.all([backgroundPath, audioPath, musicBase64 || sourceMusicPath ? musicPath : "", fontPath].filter(Boolean).map((filepath) => fs.rm(filepath, { force: true })));
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
