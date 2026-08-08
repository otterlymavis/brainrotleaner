import { createServer as createHttpServer } from "node:http";
import { promises as fs, createReadStream } from "node:fs";
import { join, basename, extname } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import ffmpeg from "@ffmpeg-installer/ffmpeg";
import YTDlpWrap from "yt-dlp-wrap";

const port = Number(process.env.PORT || 8787);
const clipsDir = join(process.cwd(), "clips");
const outputsDir = join(process.cwd(), "outputs");
const toolsDir = join(process.cwd(), "tools");

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

const runProcess = (command, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { windowsHide: true, ...options });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  child.on("error", reject);
  child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr || `Process exited with code ${code}`)));
});

const safeName = (name) => basename(name).replace(/[^a-zA-Z0-9._-]/g, "_");

const hexColor = (value, fallback) => /^#[0-9a-f]{6}$/i.test(value || "") ? value : fallback;
const escapeFilterPath = (value) => value.replace(/\\/g, "/").replace(/:/g, "\\:");

const createCaptionFilter = (words, style, captionStyle = {}, fontPath = "") => {
  const groupSize = style === "1 word" ? 1 : 3;
  const fontSize = Math.max(28, Math.min(110, Number(captionStyle.fontSize) || 58));
  const textColor = hexColor(captionStyle.textColor, "#f8fafc");
  const strokeColor = hexColor(captionStyle.strokeColor, "#101820");
  const strokeWidth = Math.max(0, Math.min(12, Number(captionStyle.strokeWidth) || 0));
  const requestedFont = captionStyle.fontFamily === "Inter, Arial, sans-serif" ? "Arial" : captionStyle.fontFamily;
  const fontFamily = ["Arial", "Georgia", "Trebuchet MS", "Courier New"].includes(requestedFont) ? requestedFont : "Arial";
  const fontSource = fontPath ? "fontfile='" + escapeFilterPath(fontPath) + "'" : "font='" + fontFamily + "'";
  const highlightColor = hexColor(captionStyle.highlightColor, "#10b981");
  const position = captionStyle.position === "top" ? "h*0.2" : captionStyle.position === "bottom" ? "h*0.75" : "(h-text_h)/2";
  const x = captionStyle.align === "right" ? "w-text_w-72" : captionStyle.align === "center" ? "(w-text_w)/2" : "72";
  const chunks = [];
  for (let index = 0; index < words.length; index += groupSize) {
    const group = words.slice(index, index + groupSize);
    const text = group.map((word) => word.punctuated_word || word.word).join(" ").replace(/[\\':,]/g, "\\$&");
    const start = Number(group[0].start.toFixed(3));
    const end = Number(group.at(-1).end.toFixed(3));
   chunks.push(`drawtext=${fontSource}:text='${text}':fontcolor=${textColor}:fontsize=${fontSize}:borderw=${strokeWidth}:bordercolor=${strokeColor}:x=${x}:y=${position}:enable=between(t\\,${start}\\,${end})`);
   if (style !== "summary") {
      group.forEach((word) => {
        const activeText = String(word.punctuated_word || word.word).replace(/[\\':,]/g, "\\$&");
        const wordStart = Number(word.start.toFixed(3));
        const wordEnd = Number(word.end.toFixed(3));
        const wordIndex = group.indexOf(word);
        const precedingText = group.slice(0, wordIndex).map((item) => item.punctuated_word || item.word).join(" ");
        const offset = precedingText.length ? (precedingText.length + 1) * fontSize * 0.52 : 0;
        const highlightX = captionStyle.align === "right"
          ? "w-text_w-72+" + offset
          : captionStyle.align === "center"
            ? "(w-text_w)/2+" + offset
            : "72+" + offset;
        chunks.push("drawtext=" + fontSource + ":text='" + activeText + "':fontcolor=" + highlightColor + ":fontsize=" + fontSize + ":borderw=0:x=" + highlightX + ":y=" + position + ":enable=between(t\\," + wordStart + "\\," + wordEnd + ")");
      });
   }
  }
  return chunks.join(",");
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

  if (request.method === "GET" && request.url === "/api/health") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "GET" && request.url === "/api/clips") {
    fs.readdir(clipsDir, { withFileTypes: true }).then((entries) => {
      sendJson(response, 200, entries.filter((entry) => entry.isFile()).map((entry) => ({ name: entry.name, url: `/clips/${encodeURIComponent(entry.name)}` })));
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

  if (request.method === "POST" && request.url === "/api/clips/download") {
    readJson(request).then(async ({ url }) => {
      if (!url?.startsWith("https://")) {
        sendJson(response, 400, { error: "A valid HTTPS video URL is required." });
        return;
      }
      try {
        const binary = await ensureYtDlp();
        const filename = `clip-${Date.now()}.mp4`;
        await runProcess(binary, [url, "-f", "best[ext=mp4]/best", "--merge-output-format", "mp4", "-o", join(clipsDir, filename)]);
        sendJson(response, 200, { name: filename, url: `/clips/${filename}` });
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
    readJson(request).then(async ({ backgroundBase64, backgroundUrl, audioBase64, words, textStyle, captionStyle, fontBase64, fontFileName, clipOffset = 0 }) => {
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
        await runProcess(ffmpeg.path, ["-y", "-stream_loop", "-1", "-ss", String(Math.max(0, Number(clipOffset) || 0)), "-i", backgroundPath, "-i", audioPath, "-vf", `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,${createCaptionFilter(words, textStyle, captionStyle, fontPath)}`, "-shortest", "-c:v", "libx264", "-c:a", "aac", "-movflags", "+faststart", outputPath]);
        sendJson(response, 200, { url: `/outputs/${id}.mp4` });
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
    readJson(request).then(async ({ apiKey, model, text }) => {
      if (!apiKey || !text?.trim()) {
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

  sendJson(response, 404, { error: "Not found" });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`FocusVid API listening on http://127.0.0.1:${port}`);
});
