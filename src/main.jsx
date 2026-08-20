import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import "./styles.css";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const SAMPLE_TEXT = `Working memory is the mental workspace used to hold and manipulate information for a short time. When reading, it helps connect the sentence you are seeing now with what came before. If the material is dense, working memory can get overloaded quickly.

One way to reduce that load is to turn a page into smaller goals. Preview the structure, read one chunk, pause briefly, and restate the point in your own words. Visual rhythm, captions, narration, and movement can also help attention return to the page without making the content feel punishing.

The best reading aid is not just more stimulation. It is stimulation that has a job: pacing, highlighting, chunking, summarizing, and giving the reader a clear sense of progress.`;

const MODES = {
  bionic: {
    label: "Bionic Reading",
    description: "Bolds the first part of each word to create fast visual anchors."
  },
  focus: {
    label: "Focus Scroll",
    description: "Large kinetic captions at a calm, steady pace."
  },
  parkour: {
    label: "Parkour Captions",
    description: "VidGen-style energetic background motion with bold captions."
  },
  summary: {
    label: "Study Summary",
    description: "Turns long material into short memorable chapter cards."
  },
  quiz: {
    label: "Recall Beats",
    description: "Alternates key points with quick self-check prompts."
  }
};

const AI_PROVIDERS = {
  gemini: { label: "Gemini", model: "gemini-1.5-flash" },
  deepinfra: { label: "DeepInfra", model: "meta-llama/Llama-3.3-70B-Instruct" },
  openai: { label: "OpenAI", model: "gpt-4o-mini" }
};

const VOICE_MODELS = ["aura-arcas-en", "aura-luna-en", "aura-asteria-en"];

const VOICE_PROVIDERS = {
  edge: {
    label: "Edge (free, no key)",
    voices: [
      "en-US-AriaNeural",
      "en-US-GuyNeural",
      "en-US-JennyNeural",
      "en-US-ChristopherNeural",
      "en-US-MichelleNeural",
      "en-GB-SoniaNeural",
      "en-GB-RyanNeural",
      "en-AU-NatashaNeural"
    ]
  },
  deepgram: { label: "Deepgram (key required)", voices: VOICE_MODELS }
};

const base64ToBlob = (base64, type) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type });
};

const CLIP_PRESETS = [
  { label: "Minecraft parkour", query: "minecraft parkour gameplay no copyright vertical" },
  { label: "Parkour 4K", query: "minecraft parkour 4k no copyright gameplay 1 hour" },
  { label: "Subway Surfers", query: "subway surfers gameplay no copyright vertical" },
  { label: "GTA ramps", query: "gta 5 ramp gameplay no copyright vertical" },
  { label: "Satisfying", query: "satisfying soap cutting no copyright background" },
  { label: "Slime ASMR", query: "slime asmr no copyright background vertical" }
];

const formatViews = (views) => {
  const count = Number(views) || 0;
  if (!count) return "";
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M views`;
  if (count >= 1_000) return `${Math.round(count / 1_000)}K views`;
  return `${count} views`;
};

const formatClipDuration = (seconds) => {
  const total = Math.round(Number(seconds) || 0);
  if (!total) return "";
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
    : `${minutes}:${String(rest).padStart(2, "0")}`;
};

const stripText = (text) =>
  text
    .replace(/\s+/g, " ")
    .replace(/\s([.,!?;:])/g, "$1")
    .trim();

const splitSentences = (text) => {
  const clean = stripText(text);
  if (!clean) return [];
  return clean.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((part) => part.trim()) ?? [clean];
};

const makeScenes = (source, mode, wordsPerScene) => {
  const sentences = splitSentences(source);
  const scenes = [];
  let bucket = [];
  let count = 0;

  sentences.forEach((sentence) => {
    const words = sentence.split(/\s+/).filter(Boolean).length;
    if (count + words > wordsPerScene && bucket.length) {
      scenes.push(bucket.join(" "));
      bucket = [];
      count = 0;
    }
    bucket.push(sentence);
    count += words;
  });

  if (bucket.length) scenes.push(bucket.join(" "));

  if (mode === "summary") {
    return scenes.slice(0, 9).map((scene, index) => ({
      title: `Chapter ${index + 1}`,
      text: summarize(scene),
      duration: 6.2
    }));
  }

  if (mode === "quiz") {
    return scenes.slice(0, 8).flatMap((scene, index) => [
      { title: `Point ${index + 1}`, text: summarize(scene), duration: 5.2 },
      {
        title: "Recall",
        text: makeQuestion(scene),
        duration: 4.5
      }
    ]);
  }

  return scenes.slice(0, 18).map((scene, index) => ({
    title: `Part ${index + 1}`,
    text: scene,
    duration: mode === "parkour" ? 5.4 : 6.8
  }));
};

const summarize = (text) => {
  const sentences = splitSentences(text);
  const picked = sentences.slice(0, 2).join(" ");
  return picked.length > 230 ? `${picked.slice(0, 227).trim()}...` : picked || text;
};

const makeQuestion = (text) => {
  const sentence = splitSentences(text)[0] || text;
  const trimmed = sentence.replace(/[.!?]+$/, "");
  return `What is the main idea of: "${trimmed.slice(0, 150)}${trimmed.length > 150 ? "..." : ""}"?`;
};

const splitBionicWord = (word) => {
  const match = word.match(/^(\W*)([\w'\u2019-]+)(\W*)$/);
  if (!match) return { prefix: word, rest: "" };
  const [, leading, core, trailing] = match;
  const fixationLength = Math.max(1, Math.ceil(core.length * 0.48));
  return {
    prefix: `${leading}${core.slice(0, fixationLength)}`,
    rest: `${core.slice(fixationLength)}${trailing}`
  };
};

// Matches TEXT_MARGIN in server.mjs.
const CAPTION_MARGIN = 72;

const drawFrame = (ctx, canvas, frame, scenes, mode, accent, textStyle, backgroundVideo, timedWords = [], captionStyle = {}) => {
  const width = canvas.width;
  const height = canvas.height;
  const fps = 30;
  const elapsed = frame / fps;
  let cursor = 0;
  let sceneIndex = 0;

  for (let i = 0; i < scenes.length; i += 1) {
    if (elapsed <= cursor + scenes[i].duration) {
      sceneIndex = i;
      break;
    }
    cursor += scenes[i].duration;
  }

  const scene = scenes[sceneIndex] ?? scenes.at(-1);
  const local = Math.max(0, elapsed - cursor);
  const localProgress = Math.min(1, local / scene.duration);

  const background = ctx.createLinearGradient(0, 0, width, height);
  if (mode === "parkour") {
    background.addColorStop(0, "#13161d");
    background.addColorStop(0.5, "#243529");
    background.addColorStop(1, "#141821");
  } else if (mode === "summary") {
    background.addColorStop(0, "#f6f0e4");
    background.addColorStop(0.52, "#dfe9e4");
    background.addColorStop(1, "#d5dceb");
  } else if (mode === "quiz") {
    background.addColorStop(0, "#17202a");
    background.addColorStop(0.48, "#273b49");
    background.addColorStop(1, "#201a25");
  } else {
    background.addColorStop(0, "#f5f7fb");
    background.addColorStop(0.5, "#e6f0ec");
    background.addColorStop(1, "#f6e7df");
  }
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  if (backgroundVideo?.readyState >= 2) {
    ctx.save();
    const videoRatio = backgroundVideo.videoWidth / backgroundVideo.videoHeight || 16 / 9;
    const canvasRatio = width / height;
    let drawWidth = width;
    let drawHeight = height;
    if (videoRatio > canvasRatio) drawWidth = height * videoRatio;
    else drawHeight = width / videoRatio;
    // Drawn undimmed: the FFmpeg render scales and crops the clip without tinting it.
    ctx.drawImage(backgroundVideo, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
    ctx.restore();
  } else if (mode === "parkour") {
    drawParkour(ctx, width, height, frame, accent);
  } else {
    drawFocusField(ctx, width, height, frame, accent, mode);
  }

  // Everything below mirrors createCaptionFilter in server.mjs so the preview and the
  // rendered MP4 agree: same margins, same anchors, one line per group, one baseline.
  const fontSize = Number(captionStyle.fontSize) || 58;
  const fontFamily = captionStyle.fontFamily === "Inter, Arial, sans-serif" ? "Arial" : (captionStyle.fontFamily || "Arial");
  const textColor = captionStyle.textColor || "#f8fafc";
  const strokeColor = captionStyle.strokeColor || "#101820";
  const strokeWidth = Number(captionStyle.strokeWidth) || 0;
  const highlightColor = captionStyle.highlightColor || accent;
  const position = captionStyle.position || "center";
  const align = captionStyle.align || "left";

  ctx.font = `bold ${fontSize}px ${fontFamily}`;
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";
  ctx.strokeStyle = strokeColor;
  // ffmpeg's borderw grows outward from the glyph; a canvas stroke straddles the path.
  ctx.lineWidth = strokeWidth * 2;

  const effectiveTextStyle = mode === "summary" ? "summary" : textStyle;
  const groupSize = effectiveTextStyle === "1 word" ? 1 : 3;

  let groupWords = [];
  let activeIndex = -1;

  if (timedWords.length) {
    const currentIndex = timedWords.findIndex((word) => elapsed <= word.end);
    const displayIndex = currentIndex >= 0 ? currentIndex : timedWords.length - 1;
    const groupStart = Math.floor(displayIndex / groupSize) * groupSize;
    groupWords = timedWords.slice(groupStart, groupStart + groupSize).map((word) => String(word.punctuated_word || word.word));
    activeIndex = currentIndex >= 0 ? currentIndex - groupStart : -1;
  } else {
    // Before a voice preview exists there are no real timings, so pace by scene progress.
    const sceneWords = scene.text.split(/\s+/).filter(Boolean);
    const approxIndex = Math.min(Math.max(0, sceneWords.length - 1), Math.floor(localProgress * sceneWords.length));
    const groupStart = Math.floor(approxIndex / groupSize) * groupSize;
    groupWords = sceneWords.slice(groupStart, groupStart + groupSize);
    activeIndex = approxIndex - groupStart;
  }

  if (effectiveTextStyle === "summary") activeIndex = -1;

  if (groupWords.length) {
    const spaceWidth = ctx.measureText(" ").width;
    const wordWidths = groupWords.map((word) => ctx.measureText(word).width);
    const groupWidth = wordWidths.reduce((sum, value) => sum + value, 0) + spaceWidth * (groupWords.length - 1);
    const startX = align === "right"
      ? width - CAPTION_MARGIN - groupWidth
      : align === "center"
        ? (width - groupWidth) / 2
        : CAPTION_MARGIN;

    const metrics = ctx.measureText("Hg");
    const ascent = metrics.fontBoundingBoxAscent || fontSize * 0.8;
    const descent = metrics.fontBoundingBoxDescent || fontSize * 0.2;
    const lineTop = position === "top"
      ? height * 0.2
      : position === "bottom"
        ? height * 0.75
        : (height - (ascent + descent)) / 2;
    const baseline = lineTop + ascent;

    let cursorX = startX;
    groupWords.forEach((word, index) => {
      const x = cursorX;
      cursorX += wordWidths[index] + spaceWidth;
      ctx.fillStyle = index === activeIndex ? highlightColor : textColor;
      if (strokeWidth > 0) ctx.strokeText(word, x, baseline);
      ctx.fillText(word, x, baseline);
    });
  }
};

const drawFocusField = (ctx, width, height, frame, accent, mode) => {
  const count = mode === "summary" ? 18 : 26;
  for (let i = 0; i < count; i += 1) {
    const x = ((i * 173 + frame * (0.6 + (i % 4) * 0.2)) % (width + 120)) - 60;
    const y = (i * 97) % height;
    ctx.fillStyle = i % 3 === 0 ? "rgba(255,255,255,0.38)" : "rgba(35,42,54,0.08)";
    ctx.beginPath();
    ctx.arc(x, y, 2 + (i % 5), 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.24;
  ctx.lineWidth = 4;
  for (let i = 0; i < 6; i += 1) {
    ctx.beginPath();
    ctx.moveTo(0, height * (0.16 + i * 0.13));
    ctx.bezierCurveTo(width * 0.28, height * (0.1 + i * 0.12), width * 0.72, height * (0.2 + i * 0.13), width, height * (0.12 + i * 0.14));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
};

const drawParkour = (ctx, width, height, frame, accent) => {
  const horizon = height * 0.58;
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.fillRect(0, horizon, width, height - horizon);

  for (let i = 0; i < 14; i += 1) {
    const depth = i / 14;
    const blockW = 120 + depth * 240;
    const blockH = 38 + depth * 82;
    const speed = 8 + depth * 18;
    const x = ((i * 211 - frame * speed) % (width + 460)) - 230;
    const y = horizon + depth * depth * height * 0.42;
    ctx.fillStyle = i % 2 === 0 ? "#527b57" : "#76644d";
    ctx.fillRect(x, y, blockW, blockH);
    ctx.fillStyle = "rgba(255,255,255,0.13)";
    ctx.fillRect(x, y, blockW, 8);
  }

  ctx.fillStyle = accent;
  ctx.fillRect(width * 0.18, horizon - 32 + Math.sin(frame / 10) * 8, 48, 48);
};

const extractPdfText = async (file) => {
  const data = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data }).promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => item.str).join(" "));
  }

  return pages.join("\n\n");
};

const blobToBase64 = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onloadend = () => resolve(String(reader.result).split(",")[1] || "");
  reader.onerror = reject;
  reader.readAsDataURL(blob);
});

const revokeBlobUrl = (url) => {
  if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
};

function BionicText({ text }) {
  return (
    <div className="bionic-reader" aria-label="Bionic reading text">
      {text.split(/(\s+)/).map((token, index) => {
        if (!token.trim()) return token;
        const parts = splitBionicWord(token);
        return (
          <span key={`${token}-${index}`} className="bionic-word">
            <strong>{parts.prefix}</strong>
            {parts.rest}
          </span>
        );
      })}
    </div>
  );
}

function App() {
  const [uiMode, setUiMode] = useState(() => {
    try {
      const editor = JSON.parse(localStorage.getItem("focusvid-editor-settings") || "{}");
      return editor.uiMode === "advanced" ? "advanced" : "simple";
    } catch {
      return "simple";
    }
  });
  const [sourceText, setSourceText] = useState(SAMPLE_TEXT);
  const [title, setTitle] = useState("Working Memory and Reading");
  const [mode, setMode] = useState("focus");
  const [theme, setTheme] = useState("Facts");
  const [inputType, setInputType] = useState("material");
  const [wordsPerScene, setWordsPerScene] = useState(42);
  const [accent, setAccent] = useState("#10b981");
  const [textStyle, setTextStyle] = useState("3 words");
  // Captions sit directly on the footage now, so they need an outline to stay legible
  // over bright frames. Saved settings still win over this default.
  const [captionStyle, setCaptionStyle] = useState({ fontFamily: "Arial", fontSize: 58, textColor: "#f8fafc", strokeColor: "#101820", strokeWidth: 4, highlightColor: "#10b981", position: "center", align: "left", lineHeight: 72 });
  const [fontBase64, setFontBase64] = useState("");
  const [fontFileName, setFontFileName] = useState("");
  const [backgroundUrl, setBackgroundUrl] = useState("");
  const [backgroundName, setBackgroundName] = useState("");
  const [backgroundBase64, setBackgroundBase64] = useState("");
  const [clipUrl, setClipUrl] = useState("");
  const [clipLibrary, setClipLibrary] = useState([]);
  const [isDownloadingClip, setIsDownloadingClip] = useState(false);
  const [clipOffset, setClipOffset] = useState(0);
  const [clipQuery, setClipQuery] = useState(CLIP_PRESETS[0].query);
  const [clipResults, setClipResults] = useState([]);
  const [clipResultsLabel, setClipResultsLabel] = useState("");
  const [isSearchingClips, setIsSearchingClips] = useState(false);
  const [sectionSeconds, setSectionSeconds] = useState(150);
  const [randomStart, setRandomStart] = useState(true);
  const [backgroundVolume, setBackgroundVolume] = useState(0);
  const [backgroundDuration, setBackgroundDuration] = useState(0);
  const [cookiesFromBrowser, setCookiesFromBrowser] = useState("");
  const [cookiesFile, setCookiesFile] = useState("");
  const [apiProvider, setApiProvider] = useState("gemini");
  const [apiModel, setApiModel] = useState(AI_PROVIDERS.gemini.model);
  const [aiApiKey, setAiApiKey] = useState("");
  const [deepgramApiKey, setDeepgramApiKey] = useState("");
  const [voiceProvider, setVoiceProvider] = useState("edge");
  const [voiceModel, setVoiceModel] = useState(VOICE_PROVIDERS.edge.voices[0]);
  const [savedSection, setSavedSection] = useState("");
  const [outputOpen, setOutputOpen] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [apiMessage, setApiMessage] = useState("");
  const [isRendering, setIsRendering] = useState(false);
  const [videoUrl, setVideoUrl] = useState("");
  const [voiceUrl, setVoiceUrl] = useState("");
  const [voiceBase64, setVoiceBase64] = useState("");
  const [timedWords, setTimedWords] = useState([]);
  const [isVoiceLoading, setIsVoiceLoading] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const canvasRef = useRef(null);
  const backgroundVideoRef = useRef(null);
  const voiceAudioRef = useRef(null);
  const rafRef = useRef(0);
  const voiceRequestRef = useRef(0);
  const savedTimerRef = useRef(0);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("focusvid-api-settings") || "{}");
      if (saved.provider && AI_PROVIDERS[saved.provider]) setApiProvider(saved.provider);
      if (saved.model) setApiModel(saved.model);
      if (saved.aiApiKey) setAiApiKey(saved.aiApiKey);
      if (saved.deepgramApiKey) setDeepgramApiKey(saved.deepgramApiKey);
      if (saved.voiceProvider && VOICE_PROVIDERS[saved.voiceProvider]) setVoiceProvider(saved.voiceProvider);
      if (saved.voiceModel) setVoiceModel(saved.voiceModel);
      const editor = JSON.parse(localStorage.getItem("focusvid-editor-settings") || "{}");
      if (editor.uiMode === "simple" || editor.uiMode === "advanced") setUiMode(editor.uiMode);
      if (editor.inputType) setInputType(editor.inputType);
      if (editor.mode && MODES[editor.mode]) setMode(editor.mode);
      if (editor.captionStyle) setCaptionStyle((current) => ({ ...current, ...editor.captionStyle, fontFamily: editor.captionStyle.fontFamily === "Inter, Arial, sans-serif" ? "Arial" : (editor.captionStyle.fontFamily || current.fontFamily) }));
      if (editor.accent) setAccent(editor.accent);
      if (editor.textStyle) setTextStyle(editor.textStyle);
      if (editor.cookiesFromBrowser) setCookiesFromBrowser(editor.cookiesFromBrowser);
      if (editor.cookiesFile) setCookiesFile(editor.cookiesFile);
      if (editor.sectionSeconds) setSectionSeconds(editor.sectionSeconds);
      if (typeof editor.randomStart === "boolean") setRandomStart(editor.randomStart);
      if (typeof editor.backgroundVolume === "number") setBackgroundVolume(editor.backgroundVolume);
    } catch {
      // Ignore malformed local settings and keep defaults.
    }
  }, []);

  useEffect(() => {
    fetch("/api/clips").then((response) => response.ok ? response.json() : []).then(setClipLibrary).catch(() => undefined);
  }, []);

  useEffect(() => {
    voiceRequestRef.current += 1;
    voiceAudioRef.current?.pause();
    voiceAudioRef.current = null;
    setTimedWords([]);
    setVoiceBase64("");
    setVoiceUrl((previous) => {
      revokeBlobUrl(previous);
      return "";
    });
  }, [sourceText, mode, wordsPerScene, voiceModel, voiceProvider, deepgramApiKey]);

  useEffect(() => () => {
    revokeBlobUrl(videoUrl);
  }, [videoUrl]);

  useEffect(() => () => {
    revokeBlobUrl(backgroundUrl);
  }, [backgroundUrl]);

  useEffect(() => {
    if (videoUrl) setOutputOpen(true);
  }, [videoUrl]);

  useEffect(() => {
    setVideoUrl("");
    setOutputOpen(false);
  }, [sourceText, mode, wordsPerScene, accent, textStyle, captionStyle, backgroundUrl, backgroundBase64, clipOffset, fontBase64, fontFileName]);

  useEffect(() => () => {
    window.clearTimeout(savedTimerRef.current);
  }, []);

  useEffect(() => {
    try {
      const editor = JSON.parse(localStorage.getItem("focusvid-editor-settings") || "{}");
      localStorage.setItem("focusvid-editor-settings", JSON.stringify({ ...editor, uiMode }));
    } catch {
      // Ignore storage failures; the toggle still works for this session.
    }
  }, [uiMode]);

  const scenes = useMemo(
    () => makeScenes(sourceText, mode, wordsPerScene),
    [sourceText, mode, wordsPerScene]
  );

  const totalSeconds = timedWords.length ? timedWords.at(-1).end : scenes.reduce((sum, scene) => sum + scene.duration, 0);
  const wordCount = stripText(sourceText).split(/\s+/).filter(Boolean).length;
  const isBionicMode = mode === "bionic";
  const isAdvanced = uiMode === "advanced";

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !scenes.length || isRendering) return undefined;
    const ctx = canvas.getContext("2d");
    let frame = 0;
    const tick = () => {
      drawFrame(ctx, canvas, frame, scenes, mode, accent, textStyle, backgroundVideoRef.current, timedWords, captionStyle);
      frame += 1;
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(rafRef.current);
  }, [scenes, mode, accent, textStyle, captionStyle, backgroundUrl, timedWords, isRendering]);

  useEffect(() => {
    const video = backgroundVideoRef.current;
    if (!video || !backgroundUrl) return undefined;
    video.load();
    video.play().catch(() => undefined);
    return () => video.pause();
  }, [backgroundUrl, isBionicMode]);

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.name.match(/\.(ttf|otf|woff|woff2)$/i)) {
      try {
        const fontName = "FocusCustom";
        const fontFace = new FontFace(fontName, await file.arrayBuffer());
        await fontFace.load();
        document.fonts.add(fontFace);
        setFontBase64(await blobToBase64(file));
        setFontFileName(file.name);
        setCaptionStyle((current) => ({ ...current, fontFamily: fontName }));
        setApiMessage("Custom font loaded");
      } catch (error) {
        setApiMessage(error.message || "Could not load custom font");
      }
      event.target.value = "";
      return;
    }
    if (file.type.startsWith("video/") || file.name.match(/\.(mp4|webm|mov|mkv|m4v)$/i)) {
      setClipOffset(0);
      setBackgroundDuration(0);
      setBackgroundName(file.name);
      setApiMessage("Adding clip to library...");
      try {
        const response = await fetch(`/api/clips/upload?name=${encodeURIComponent(file.name)}`, { method: "POST", body: file });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not save the clip");
        setBackgroundUrl(data.url);
        setBackgroundBase64("");
        setBackgroundName(data.name);
        setBackgroundDuration(data.duration || 0);
        setClipLibrary((current) => [...current.filter((clip) => clip.name !== data.name), { name: data.name, url: data.url, duration: data.duration || 0 }]);
        setApiMessage(`Clip added to library (${formatClipDuration(data.duration) || "ready"})`);
      } catch (error) {
        // Without the API server the clip can still preview and render through the browser path.
        setBackgroundUrl(URL.createObjectURL(file));
        setBackgroundBase64(await blobToBase64(file));
        setApiMessage(`${error.message || "Upload failed"}. Using this clip from the browser only.`);
      }
      event.target.value = "";
      return;
    }
    setIsExtracting(true);
    setTitle(file.name.replace(/\.[^.]+$/, ""));
    try {
      const text = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
        ? await extractPdfText(file)
        : await file.text();
      setSourceText(text);
      setVideoUrl("");
    } finally {
      setIsExtracting(false);
      event.target.value = "";
    }
  };

  const renderVideo = async () => {
    if (isBionicMode) {
      setApiMessage("Bionic Reading is text-only.");
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas || !scenes.length) return;

    if (!backgroundUrl) {
      setApiMessage("No gameplay clip selected. Open Background clip and search for footage to render real parkour video.");
    }

    setIsRendering(true);
    setRenderProgress(0);
    setVideoUrl("");

    try {
    let renderVoiceUrl = voiceUrl;
    let renderVoiceBase64 = voiceBase64;
    let renderWords = timedWords;
    if (!renderVoiceUrl && (voiceProvider === "edge" || deepgramApiKey)) {
      const preparedVoice = await prepareVoice({ play: false });
      if (preparedVoice?.failed) {
        setIsRendering(false);
        return;
      }
      renderVoiceUrl = preparedVoice.url;
      renderVoiceBase64 = preparedVoice.base64;
      renderWords = preparedVoice.words;
    }
    if (!renderVoiceUrl && !renderWords.length) {
      setApiMessage(voiceProvider === "edge"
        ? "Preview voice before rendering so captions can be timed."
        : "Add a Deepgram key in Voice and preview voice before rendering.");
      setIsRendering(false);
      return;
    }

    if ((backgroundBase64 || backgroundUrl.startsWith("/clips/")) && renderVoiceUrl && renderWords.length) {
      try {
        const response = await fetch("/api/render", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ backgroundBase64, backgroundUrl, audioBase64: renderVoiceBase64, words: renderWords, textStyle, captionStyle, fontBase64, fontFileName, clipOffset, randomStart, backgroundVolume })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "MP4 rendering failed");
        setVideoUrl(data.url);
        setRenderProgress(1);
        setIsRendering(false);
        return;
      } catch (error) {
        setApiMessage(error.message || "MP4 rendering failed");
      }
    }

    const fps = 30;
    const stream = canvas.captureStream(fps);
    let audioElement;
    if (renderVoiceUrl) {
      audioElement = new Audio(renderVoiceUrl);
      audioElement.preload = "auto";
      await audioElement.play();
      const audioStream = audioElement.captureStream?.();
      audioStream?.getAudioTracks().forEach((track) => stream.addTrack(track));
    }
    const recorder = new MediaRecorder(stream, {
      mimeType: MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : "video/webm"
    });
    const chunks = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };

    const ctx = canvas.getContext("2d");
    const renderDuration = renderWords.length ? renderWords.at(-1).end : totalSeconds;
    const totalFrames = Math.ceil(renderDuration * fps);
    recorder.start();

    for (let frame = 0; frame <= totalFrames; frame += 1) {
      drawFrame(ctx, canvas, frame, scenes, mode, accent, textStyle, backgroundVideoRef.current, renderWords, captionStyle);
      setRenderProgress(frame / totalFrames);
      await new Promise((resolve) => setTimeout(resolve, 1000 / fps));
    }

    const recorderStopped = new Promise((resolve) => {
      recorder.onstop = resolve;
    });
    recorder.stop();
    await recorderStopped;
    const blob = new Blob(chunks, { type: "video/webm" });
    audioElement?.pause();
    setVideoUrl(URL.createObjectURL(blob));
    setIsRendering(false);
    setRenderProgress(1);
    } catch (error) {
      setApiMessage(error.message || "Could not render video");
      setIsRendering(false);
    }
  };

  const clearBackground = () => {
    setBackgroundUrl("");
    setBackgroundName("");
    setBackgroundBase64("");
    setClipOffset(0);
    setBackgroundDuration(0);
  };

  const fetchClip = async (sourceUrl) => {
    if (!sourceUrl?.trim()) return;
    setIsDownloadingClip(true);
    setApiMessage("Downloading gameplay footage...");
    try {
      const response = await fetch("/api/clips/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: sourceUrl.trim(), sectionSeconds, randomSection: true, cookiesFromBrowser, cookiesFile })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Clip download failed");
      const clip = { name: data.name, url: data.url, duration: data.duration || 0 };
      setBackgroundUrl(clip.url);
      setBackgroundName(clip.name);
      setBackgroundBase64("");
      setClipOffset(0);
      setBackgroundDuration(clip.duration);
      setClipLibrary((current) => [...current.filter((item) => item.name !== clip.name), clip]);
      setApiMessage(`Clip saved (${formatClipDuration(clip.duration) || "ready"})`);
    } catch (error) {
      setApiMessage(error.message || "Clip download failed");
    } finally {
      setIsDownloadingClip(false);
    }
  };

  const downloadClip = () => fetchClip(clipUrl);

  const searchClips = async (query, options = {}) => {
    const { channelUrl = "", label = "" } = options;
    const term = channelUrl ? "" : (query ?? clipQuery).trim();
    if (!term && !channelUrl) return;
    if (term) setClipQuery(term);
    setIsSearchingClips(true);
    setApiMessage(channelUrl ? `Loading videos from ${label || "channel"}...` : "");
    try {
      const response = await fetch("/api/clips/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: term, channelUrl, limit: channelUrl ? 20 : 10, cookiesFromBrowser, cookiesFile })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Clip search failed");
      setClipResults(data.results || []);
      setClipResultsLabel(channelUrl ? `${label || data.source || "Channel"} uploads` : `Results for "${term}"`);
      setApiMessage(data.results?.length ? `${data.results.length} videos found` : "No footage found.");
    } catch (error) {
      setApiMessage(error.message || "Clip search failed");
    } finally {
      setIsSearchingClips(false);
    }
  };

  // A channel with one usable parkour upload usually has many more like it.
  const browseChannel = (result) => {
    if (!result?.channelUrl) {
      setApiMessage("No channel link available for that video.");
      return;
    }
    searchClips("", { channelUrl: result.channelUrl, label: result.channel });
  };

  const findSimilar = (result) => searchClips(result.title);

  const copyClipLink = async (value) => {
    try {
      await navigator.clipboard.writeText(value);
      setApiMessage("Link copied");
    } catch {
      setApiMessage(value);
    }
  };

  const copyAllClipLinks = () => copyClipLink(clipResults.map((result) => result.url).join("\n"));

  const refreshClipLibrary = async () => {
    try {
      const response = await fetch("/api/clips");
      if (!response.ok) throw new Error("Could not read the clip library");
      const clips = await response.json();
      setClipLibrary(clips);
      setApiMessage(`${clips.length} clip${clips.length === 1 ? "" : "s"} in the library`);
    } catch (error) {
      setApiMessage(error.message || "Could not read the clip library");
    }
  };

  const selectLibraryClip = (clip) => {
    if (!clip) return;
    setBackgroundUrl(clip.url);
    setBackgroundName(clip.name);
    setBackgroundBase64("");
    setClipOffset(0);
    setBackgroundDuration(clip.duration || 0);
  };

  const randomizeClip = () => {
    const video = backgroundVideoRef.current;
    const duration = backgroundDuration || (Number.isFinite(video?.duration) ? video.duration : 0);
    if (!duration) {
      setApiMessage("Clip length is still loading. Try again in a moment.");
      return;
    }
    const nextOffset = Math.random() * Math.max(0, duration - Math.min(duration, totalSeconds));
    setClipOffset(nextOffset);
    if (video) video.currentTime = nextOffset;
    setApiMessage(`Clip starts at ${formatClipDuration(nextOffset) || "0:00"}`);
  };

  const saveSettings = (message = "Settings saved", section = "api") => {
    localStorage.setItem(
      "focusvid-api-settings",
      JSON.stringify({ provider: apiProvider, model: apiModel, aiApiKey, deepgramApiKey, voiceProvider, voiceModel })
    );
    localStorage.setItem("focusvid-editor-settings", JSON.stringify({ uiMode, inputType, mode, captionStyle, accent, textStyle, cookiesFromBrowser, cookiesFile, sectionSeconds, randomStart, backgroundVolume }));
    window.clearTimeout(savedTimerRef.current);
    setSavedSection(section);
    setApiMessage(message);
    savedTimerRef.current = window.setTimeout(() => setSavedSection(""), 2400);
  };

  const generateScript = async () => {
    if (!aiApiKey || !sourceText.trim()) {
      setApiMessage("Add input and an AI API key in API settings first.");
      return;
    }
    setIsGenerating(true);
    setApiMessage("");
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: apiProvider, model: apiModel, apiKey: aiApiKey, material: sourceText, inputType, mode, theme })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Script generation failed");
      setSourceText(data.script);
      setApiMessage(isBionicMode ? "Text generated" : "Script generated");
    } catch (error) {
      setApiMessage(error.message || (isBionicMode ? "Could not generate text" : "Could not generate script"));
    } finally {
      setIsGenerating(false);
    }
  };

  const chooseVoiceProvider = (value) => {
    setVoiceProvider(value);
    setVoiceModel(VOICE_PROVIDERS[value].voices[0]);
  };

  const chooseProvider = (value) => {
    setApiProvider(value);
    setApiModel(AI_PROVIDERS[value].model);
  };

  const prepareVoice = async ({ play = true } = {}) => {
    const script = scenes.map((scene) => scene.text).join(" ");

    if (voiceProvider === "edge") {
      const requestId = voiceRequestRef.current;
      setIsVoiceLoading(true);
      try {
        const response = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: "edge", model: voiceModel, text: script })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Voice generation failed");
        const url = URL.createObjectURL(base64ToBlob(data.audioBase64, "audio/mpeg"));
        if (requestId !== voiceRequestRef.current) {
          revokeBlobUrl(url);
          setApiMessage("Material changed while voice was preparing.");
          return { url: "", words: [], base64: "", failed: true };
        }
        setVoiceBase64(data.audioBase64);
        setVoiceUrl((previous) => {
          revokeBlobUrl(previous);
          return url;
        });
        // Edge returns word timings with the audio, so no transcription round trip is needed.
        setTimedWords(data.words || []);
        if (play) {
          voiceAudioRef.current?.pause();
          voiceAudioRef.current = new Audio(url);
          await voiceAudioRef.current.play();
        }
        return { url, words: data.words || [], base64: data.audioBase64 };
      } catch (error) {
        setApiMessage(error.message || "Could not generate voice");
        return { url: "", words: [], base64: "", failed: true };
      } finally {
        setIsVoiceLoading(false);
      }
    }

    if (deepgramApiKey) {
      const requestId = voiceRequestRef.current;
      setIsVoiceLoading(true);
      try {
        const response = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey: deepgramApiKey, model: voiceModel, text: script })
        });
        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "Voice generation failed");
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        if (requestId !== voiceRequestRef.current) {
          revokeBlobUrl(url);
          setApiMessage("Material changed while voice was preparing.");
          return { url: "", words: [], base64: "", failed: true };
        }
        const audioBase64 = await blobToBase64(blob);
        let words = [];
        let transcriptionOk = false;
        try {
          const transcription = await fetch("/api/transcribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ apiKey: deepgramApiKey, audioBase64 })
          });
          const transcriptData = await transcription.json().catch(() => ({}));
          transcriptionOk = transcription.ok;
          words = transcriptionOk ? transcriptData.words || [] : [];
          if (!transcriptionOk) setApiMessage("Voice generated, but word timing was unavailable.");
        } catch {
          setApiMessage("Voice generated, but word timing was unavailable.");
        }
        if (requestId !== voiceRequestRef.current) {
          revokeBlobUrl(url);
          setApiMessage("Material changed while voice was preparing.");
          return { url: "", words: [], base64: "", failed: true };
        }
        setVoiceBase64(audioBase64);
        setVoiceUrl((previous) => {
          revokeBlobUrl(previous);
          return url;
        });
        if (transcriptionOk) setTimedWords(words);
        if (play) {
          voiceAudioRef.current?.pause();
          voiceAudioRef.current = new Audio(url);
          await voiceAudioRef.current.play();
        }
        return { url, words, base64: audioBase64 };
      } catch (error) {
        setApiMessage(error.message || "Could not generate voice");
        return { url: "", words: [], base64: "", failed: true };
      } finally {
        setIsVoiceLoading(false);
      }
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(script);
    utterance.rate = mode === "parkour" ? 1.08 : 0.94;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
    return { url: "", words: [], base64: "" };
  };

  const speakPreview = prepareVoice;

  const stopSpeech = () => {
    voiceRequestRef.current += 1;
    window.speechSynthesis.cancel();
    voiceAudioRef.current?.pause();
    voiceAudioRef.current = null;
    setIsVoiceLoading(false);
  };

  const scriptText = scenes
    .map((scene, index) => `${index + 1}. ${scene.title}\n${scene.text}`)
    .join("\n\n");

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">FocusVid Reader</p>
          <p className="app-subtitle">Turn reading material into a focused experience.</p>
        </div>
        <div className="mode-toggle" role="group" aria-label="Interface mode">
          {['simple', 'advanced'].map((value) => (
            <button
              type="button"
              key={value}
              className={uiMode === value ? 'style-button active' : 'style-button'}
              aria-pressed={uiMode === value}
              onClick={() => setUiMode(value)}
            >
              {value === 'simple' ? 'Simple' : 'Advanced'}
            </button>
          ))}
        </div>
      </header>
      <section className="workspace">
        <aside className="controls">
          {!isAdvanced && (
            <div className="simple-flow">
              <div className="simple-step">
                <div className="step-heading">
                  <span className="step-number">1</span>
                  <div>
                    <h2>Add your material</h2>
                    <p>Upload a file or paste text below.</p>
                  </div>
                </div>
                <label className="file-drop">
                  <span>{isExtracting ? "Reading file..." : "Upload PDF or text"}</span>
                  <input type="file" accept=".pdf,.txt,.md,text/plain,application/pdf" onChange={handleFile} />
                </label>
                <label>
                  <span>{inputType === "idea" ? "Video idea" : "Study material"}</span>
                  <textarea value={sourceText} onChange={(event) => setSourceText(event.target.value)} />
                </label>
              </div>

              <div className="simple-step">
                <div className="step-heading">
                  <span className="step-number">2</span>
                  <div>
                    <h2>Choose a style</h2>
                    <p>Pick the way you want to read or watch.</p>
                  </div>
                </div>
                <div className="style-choice-grid" role="radiogroup" aria-label="Reading style">
                  {Object.entries(MODES).map(([key, item]) => (
                    <button
                      type="button"
                      key={key}
                      className={mode === key ? "style-choice active" : "style-choice"}
                      role="radio"
                      aria-checked={mode === key}
                      onClick={() => setMode(key)}
                      title={item.description}
                    >
                      <strong>{item.label}</strong>
                      <span>{item.description}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="simple-step simple-step-last">
                <div className="step-heading">
                  <span className="step-number">3</span>
                  <div>
                    <h2>Preview your result</h2>
                    <p>{isBionicMode ? "Your reading view updates as you type." : "Use the preview, then create a video when ready."}</p>
                  </div>
                </div>
                {!isBionicMode && (
                  <button type="button" className={isVoiceLoading ? "secondary loading" : "secondary simple-preview-button"} onClick={speakPreview} disabled={isVoiceLoading || !scenes.length}>
                    {isVoiceLoading && <span className="spin" aria-hidden="true" />}
                    {isVoiceLoading ? "Preparing voice" : "Preview voice"}
                  </button>
                )}
              </div>
            </div>
          )}

          {isAdvanced && (
            <label className="file-drop">
              <span>{isExtracting ? "Reading file..." : "Upload PDF or text"}</span>
              <input type="file" accept=".pdf,.txt,.md,text/plain,application/pdf" onChange={handleFile} />
            </label>
          )}

          {isAdvanced && (
            <label>
              <span>Title</span>
              <input value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
          )}

          {isAdvanced && (
            <div className="split-row">
              <label>
                <span>Input</span>
                <select value={inputType} onChange={(event) => setInputType(event.target.value)}>
                  <option value="material">Study material</option>
                  <option value="idea">Idea</option>
                </select>
              </label>

              <label>
                <span>Theme</span>
                <select value={theme} onChange={(event) => setTheme(event.target.value)}>
                  <option value="Facts">Facts</option>
                  <option value="Horror">Horror</option>
                </select>
              </label>
            </div>
          )}

          {isAdvanced && <label>
            <span>{inputType === "idea" ? "Video idea" : "Study material"}</span>
            <textarea value={sourceText} onChange={(event) => setSourceText(event.target.value)} />
          </label>}

          {isAdvanced && <label>
            <span>Mode</span>
            <select value={mode} onChange={(event) => setMode(event.target.value)} title={MODES[mode].description}>
              {Object.entries(MODES).map(([key, item]) => (
                <option key={key} value={key}>{item.label}</option>
              ))}
            </select>
          </label>}

          {!isBionicMode && isAdvanced && (
            <details className="control-section">
              <summary>Script options</summary>
              <div className="section-fields">
                <label>
                  <span>Words per scene: {wordsPerScene}</span>
                  <input
                    type="range"
                    min="22"
                    max="72"
                    step="2"
                    value={wordsPerScene}
                    onChange={(event) => setWordsPerScene(Number(event.target.value))}
                  />
                </label>

                <label>
                  <span>Accent color</span>
                  <input type="color" value={accent} onChange={(event) => setAccent(event.target.value)} />
                </label>
              </div>
            </details>
          )}

          {!isBionicMode && isAdvanced && (
            <>
              <details className="control-section">
                <summary>Voice {savedSection === "voice" ? "saved" : ""}</summary>
                <div className="section-fields">
                  <label>
                    <span>Voice engine</span>
                    <select value={voiceProvider} onChange={(event) => chooseVoiceProvider(event.target.value)}>
                      {Object.entries(VOICE_PROVIDERS).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}
                    </select>
                  </label>
                  {voiceProvider === "deepgram" && (
                    <label>
                      <span>Deepgram API key</span>
                      <input type="password" value={deepgramApiKey} onChange={(event) => setDeepgramApiKey(event.target.value)} placeholder="Paste Deepgram key" autoComplete="off" />
                    </label>
                  )}
                  <label>
                    <span>Voice model</span>
                    <select value={voiceModel} onChange={(event) => setVoiceModel(event.target.value)}>
                      {VOICE_PROVIDERS[voiceProvider].voices.map((model) => <option key={model} value={model}>{model}</option>)}
                    </select>
                  </label>
                  {voiceProvider === "edge" && (
                    <p className="api-note">Edge needs no key and returns caption timings with the audio. It uses Microsoft&apos;s Edge read-aloud service unofficially, so switch to Deepgram if it ever stops responding.</p>
                  )}

                  <div className="action-row">
                    <button type="button" className={isVoiceLoading ? "loading" : ""} onClick={speakPreview} disabled={isVoiceLoading || !scenes.length}>
                      {isVoiceLoading && <span className="spin" aria-hidden="true" />}
                      {isVoiceLoading ? "Preparing voice" : "Preview voice"}
                    </button>
                    <button type="button" onClick={stopSpeech}>
                      Stop
                    </button>
                  </div>
                  <button type="button" className="save-settings" onClick={() => saveSettings("Voice settings saved", "voice")}>Save voice settings</button>
                </div>
              </details>

              <details className="control-section">
                <summary>Captions</summary>
                <div className="section-fields">
                  <div className="style-row" role="group" aria-label="Caption timing style">
                    <span>Caption timing</span>
                    <div>
                      {[["1 word", "1 word"], ["3 words", "3 words"]].map(([value, label]) => (
                        <button
                          type="button"
                          key={value}
                          className={textStyle === value ? "style-button active" : "style-button"}
                          aria-pressed={textStyle === value}
                          onClick={() => setTextStyle(value)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="caption-style-grid">
                    <label>
                      <span>Font</span>
                      <select value={captionStyle.fontFamily} onChange={(event) => setCaptionStyle((current) => ({ ...current, fontFamily: event.target.value }))}>
                        <option value="Arial">Arial</option>
                        <option value="Georgia">Georgia</option>
                        <option value="Trebuchet MS">Trebuchet</option>
                        <option value="Courier New">Courier</option>
                      </select>
                    </label>
                    <label className="file-drop compact-file">
                      <span>{fontFileName || "Upload font"}</span>
                      <input type="file" accept=".ttf,.otf,.woff,.woff2" onChange={handleFile} />
                    </label>
                    <label>
                      <span>Text size: {captionStyle.fontSize}</span>
                      <input type="range" min="38" max="88" step="2" value={captionStyle.fontSize} onChange={(event) => setCaptionStyle((current) => ({ ...current, fontSize: Number(event.target.value) }))} />
                    </label>
                    <label>
                      <span>Text color</span>
                      <input type="color" value={captionStyle.textColor} onChange={(event) => setCaptionStyle((current) => ({ ...current, textColor: event.target.value }))} />
                    </label>
                    <label>
                      <span>Highlight</span>
                      <input type="color" value={captionStyle.highlightColor} onChange={(event) => setCaptionStyle((current) => ({ ...current, highlightColor: event.target.value }))} />
                    </label>
                    <label>
                      <span>Stroke color</span>
                      <input type="color" value={captionStyle.strokeColor} onChange={(event) => setCaptionStyle((current) => ({ ...current, strokeColor: event.target.value }))} />
                    </label>
                    <label>
                      <span>Stroke: {captionStyle.strokeWidth}</span>
                      <input type="range" min="0" max="8" step="1" value={captionStyle.strokeWidth} onChange={(event) => setCaptionStyle((current) => ({ ...current, strokeWidth: Number(event.target.value) }))} />
                    </label>
                    <label>
                      <span>Position</span>
                      <select value={captionStyle.position} onChange={(event) => setCaptionStyle((current) => ({ ...current, position: event.target.value }))}>
                        <option value="top">Top</option>
                        <option value="center">Center</option>
                        <option value="bottom">Bottom</option>
                      </select>
                    </label>
                    <label>
                      <span>Alignment</span>
                      <select value={captionStyle.align} onChange={(event) => setCaptionStyle((current) => ({ ...current, align: event.target.value }))}>
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                        <option value="right">Right</option>
                      </select>
                    </label>
                    <label>
                      <span>Line spacing: {captionStyle.lineHeight}</span>
                      <input type="range" min="42" max="120" step="2" value={captionStyle.lineHeight} onChange={(event) => setCaptionStyle((current) => ({ ...current, lineHeight: Number(event.target.value) }))} />
                    </label>
                  </div>
                </div>
              </details>

              <details className="control-section" open={mode === "parkour" && !backgroundUrl}>
                <summary>Background clip</summary>
                <div className="section-fields">
                  <div className="clip-presets" role="group" aria-label="Footage presets">
                    {CLIP_PRESETS.map((preset) => (
                      <button
                        type="button"
                        key={preset.label}
                        className="chip"
                        onClick={() => searchClips(preset.query)}
                        disabled={isSearchingClips || isDownloadingClip}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>

                  <div className="clip-download-row">
                    <input
                      value={clipQuery}
                      onChange={(event) => setClipQuery(event.target.value)}
                      onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); searchClips(); } }}
                      placeholder="Search gameplay footage"
                    />
                    <button type="button" className={isSearchingClips ? "secondary loading" : "secondary"} onClick={() => searchClips()} disabled={isSearchingClips || !clipQuery.trim()}>
                      {isSearchingClips && <span className="spin" aria-hidden="true" />}
                      {isSearchingClips ? "Searching" : "Search"}
                    </button>
                  </div>

                  {clipResults.length > 0 && (
                    <>
                      <div className="clip-results-header">
                        <span>{clipResultsLabel}</span>
                        <button type="button" onClick={copyAllClipLinks}>Copy all {clipResults.length}</button>
                      </div>

                      <ul className="clip-results">
                        {clipResults.map((result) => (
                          <li key={result.id}>
                            <div className="clip-result-meta">
                              <a href={result.url} target="_blank" rel="noreferrer" title={result.title}>{result.title}</a>
                              <small>{[result.channel, formatClipDuration(result.duration), formatViews(result.views)].filter(Boolean).join(" | ")}</small>
                            </div>
                            <div className="clip-result-actions">
                              <button
                                type="button"
                                onClick={() => browseChannel(result)}
                                disabled={isSearchingClips || !result.channelUrl}
                                title={result.channelUrl ? `More footage from ${result.channel}` : "No channel link available"}
                              >
                                Channel
                              </button>
                              <button type="button" onClick={() => findSimilar(result)} disabled={isSearchingClips} title="Search for videos like this one">
                                Similar
                              </button>
                              <button type="button" onClick={() => copyClipLink(result.url)} title="Copy the video link">
                                Link
                              </button>
                              <button type="button" onClick={() => fetchClip(result.url)} disabled={isDownloadingClip} title="Download a section and use it as the background">
                                {isDownloadingClip ? "..." : "Use"}
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}

                  <label>
                    <span>Download length: {sectionSeconds}s</span>
                    <input type="range" min="30" max="600" step="15" value={sectionSeconds} onChange={(event) => setSectionSeconds(Number(event.target.value))} />
                  </label>

                  <label className="file-drop clip-drop">
                    <span>{backgroundName || "Or upload your own clip"}</span>
                    <input type="file" accept="video/*,.mp4,.webm,.mov,.m4v" onChange={handleFile} />
                  </label>

                  <div className="clip-download-row">
                    <input value={clipUrl} onChange={(event) => setClipUrl(event.target.value)} placeholder="Or paste a video URL" />
                    <button type="button" className={isDownloadingClip ? "secondary loading" : "secondary"} onClick={downloadClip} disabled={isDownloadingClip || !clipUrl.trim()}>
                      {isDownloadingClip && <span className="spin" aria-hidden="true" />}
                      {isDownloadingClip ? "Downloading" : "Download"}
                    </button>
                  </div>

                  <label>
                    <span>Clip library</span>
                    <select value={backgroundName} onChange={(event) => selectLibraryClip(clipLibrary.find((clip) => clip.name === event.target.value))}>
                      <option value="">{clipLibrary.length ? "Choose saved clip" : "No saved clips yet"}</option>
                      {clipLibrary.map((clip) => (
                        <option key={clip.name} value={clip.name}>
                          {clip.name}{clip.duration ? ` (${formatClipDuration(clip.duration)})` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="button" className="secondary" onClick={refreshClipLibrary}>
                    Refresh library
                  </button>
                  <p className="api-note">You can also drop video files straight into the <code>clips</code> folder, then press Refresh library.</p>

                  <details className="control-section nested">
                    <summary>Download access</summary>
                    <div className="section-fields">
                      <p className="api-note">YouTube blocks anonymous downloads on many videos. If a download fails with 403 or &quot;format not available&quot;, supply your own session below.</p>
                      <label>
                        <span>Cookies from browser</span>
                        <select value={cookiesFromBrowser} onChange={(event) => setCookiesFromBrowser(event.target.value)}>
                          <option value="">None</option>
                          {["chrome", "chromium", "edge", "firefox", "brave", "opera", "vivaldi", "safari"].map((item) => (
                            <option key={item} value={item}>{item}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Or cookies.txt path</span>
                        <input value={cookiesFile} onChange={(event) => setCookiesFile(event.target.value)} placeholder="C:\path\to\cookies.txt" />
                      </label>
                      <button type="button" className="save-settings" onClick={() => saveSettings("Download access saved", "clips")}>Save download access</button>
                    </div>
                  </details>

                  <label className="checkbox-row">
                    <input type="checkbox" checked={randomStart} onChange={(event) => setRandomStart(event.target.checked)} />
                    <span>Random start point on every render</span>
                  </label>

                  <label>
                    <span>Gameplay audio: {Math.round(backgroundVolume * 100)}%</span>
                    <input type="range" min="0" max="0.6" step="0.05" value={backgroundVolume} onChange={(event) => setBackgroundVolume(Number(event.target.value))} />
                  </label>

                  {backgroundUrl && (
                    <div className="clip-actions">
                      <button type="button" onClick={randomizeClip} disabled={randomStart} title={randomStart ? "The server picks a start point at render time" : "Choose a random starting point in the clip"}>
                        Randomize clip position
                      </button>
                      <button type="button" onClick={clearBackground} title="Remove background clip">
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              </details>
            </>
          )}

          {isAdvanced && (
            <details className="control-section">
              <summary>API settings {savedSection === "api" ? "saved" : ""}</summary>
              <div className="section-fields">
                <label>
                  <span>AI provider</span>
                  <select value={apiProvider} onChange={(event) => chooseProvider(event.target.value)}>
                    {Object.entries(AI_PROVIDERS).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}
                  </select>
                </label>
                <label>
                  <span>AI model</span>
                  <input value={apiModel} onChange={(event) => setApiModel(event.target.value)} />
                </label>
                <label>
                  <span>{AI_PROVIDERS[apiProvider].label} API key</span>
                  <input type="password" value={aiApiKey} onChange={(event) => setAiApiKey(event.target.value)} placeholder="Paste provider key" autoComplete="off" />
                </label>
                <button type="button" className="save-settings" onClick={() => saveSettings()}>Save settings</button>
                <p className="api-note">Keys stay in this browser&apos;s local storage and are sent only to the local API server when you generate.</p>
              </div>
            </details>
          )}
        </aside>

        <section className="stage">
          <div className="stage-header">
            <div>
              <h1>{title || "Untitled reading"}</h1>
              <p className="stats">
                {isBionicMode
                  ? `${MODES[mode].label} | ${wordCount} words`
                  : `${MODES[mode].label} | ${wordCount} words | ${scenes.length} scenes | ${Math.ceil(totalSeconds)} sec`}
              </p>
              {apiMessage && <p className="status-message" role="status" aria-live="polite">{apiMessage}</p>}
            </div>
            <div className="stage-actions">
              {isAdvanced && (
                <button type="button" className={isGenerating ? "secondary loading" : "secondary"} onClick={generateScript} disabled={isGenerating || !sourceText.trim()}>
                  {isGenerating && <span className="spin" aria-hidden="true" />}
                  {isGenerating ? "Generating" : isBionicMode ? "Generate text" : "Generate script"}
                </button>
              )}
              {!isBionicMode && (
                <button type="button" className={isRendering ? "primary loading" : "primary"} onClick={renderVideo} disabled={isRendering || !scenes.length}>
                  {isRendering && <span className="spin" aria-hidden="true" />}
                  {isRendering ? `${Math.round(renderProgress * 100)}%` : isAdvanced ? "Render video" : "Create video"}
                </button>
              )}
            </div>
          </div>

          {isBionicMode ? (
            <section className="bionic-stage">
              <BionicText text={sourceText} />
            </section>
          ) : (
            <>
              <canvas ref={canvasRef} width="1080" height="1920" aria-label="Video preview" />
              {backgroundUrl && (
                <video ref={backgroundVideoRef} src={backgroundUrl} muted loop playsInline className="source-video" aria-hidden="true" />
              )}

              <details className="output-section" open={outputOpen} onToggle={(event) => setOutputOpen(event.currentTarget.open)}>
                <summary>Output</summary>
                <div className="outputs">
                  <label className="script-panel">
                    <span>Generated script</span>
                  <textarea readOnly value={scriptText} />
                  </label>

                  <div className="download-panel">
                    <span>Export</span>
                    {videoUrl ? (
                      <>
                        <video src={videoUrl} controls />
                        <a className="download" href={videoUrl} download={(title || "focus-video") + "." + (videoUrl.includes("/outputs/") ? "mp4" : "webm")}>
                          Download {videoUrl.includes("/outputs/") ? "MP4" : "WebM"}
                        </a>
                      </>
                    ) : (
                      <p className="empty-export">Render when the scenes feel right.</p>
                    )}
                  </div>
                </div>
              </details>
            </>
          )}
        </section>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
