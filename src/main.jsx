import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BookOpen,
  Brain,
  Download,
  FileText,
  Gauge,
  Loader2,
  Mic,
  Pause,
  Play,
  Sparkles,
  Upload,
  Video,
  Wand2,
  Shuffle,
  X,
  Settings,
  Save,
  KeyRound,
  CheckCircle2
} from "lucide-react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import "./styles.css";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const SAMPLE_TEXT = `Working memory is the mental workspace used to hold and manipulate information for a short time. When reading, it helps connect the sentence you are seeing now with what came before. If the material is dense, working memory can get overloaded quickly.

One way to reduce that load is to turn a page into smaller goals. Preview the structure, read one chunk, pause briefly, and restate the point in your own words. Visual rhythm, captions, narration, and movement can also help attention return to the page without making the content feel punishing.

The best reading aid is not just more stimulation. It is stimulation that has a job: pacing, highlighting, chunking, summarizing, and giving the reader a clear sense of progress.`;

const MODES = {
  focus: {
    label: "Focus Scroll",
    description: "Large kinetic captions with a calm progress rail.",
    icon: BookOpen
  },
  parkour: {
    label: "Parkour Captions",
    description: "VidGen-style energetic background motion with bold captions.",
    icon: Gauge
  },
  summary: {
    label: "Study Summary",
    description: "Turns long material into short memorable chapter cards.",
    icon: Brain
  },
  quiz: {
    label: "Recall Beats",
    description: "Alternates key points with quick self-check prompts.",
    icon: Sparkles
  }
};

const AI_PROVIDERS = {
  gemini: { label: "Gemini", model: "gemini-1.5-flash" },
  deepinfra: { label: "DeepInfra", model: "meta-llama/Llama-3.3-70B-Instruct" },
  openai: { label: "OpenAI", model: "gpt-4o-mini" }
};

const VOICE_MODELS = ["aura-arcas-en", "aura-luna-en", "aura-asteria-en"];

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

const wrapCanvasText = (ctx, text, maxWidth) => {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";

  words.forEach((word) => {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  });

  if (line) lines.push(line);
  return lines.slice(0, 7);
};

const wrapCanvasWords = (ctx, words, maxWidth) => {
  const lines = [];
  let line = [];
  words.forEach((word) => {
    const test = [...line, word].join(" ");
    if (ctx.measureText(test).width > maxWidth && line.length) {
      lines.push(line);
      line = [word];
    } else {
      line.push(word);
    }
  });
  if (line.length) lines.push(line);
  return lines.slice(0, 7);
};

const drawRoundedRect = (ctx, x, y, width, height, radius) => {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
};

const drawFrame = (ctx, canvas, frame, scenes, mode, accent, textStyle, backgroundVideo, timedWords = [], captionStyle = {}) => {
  const width = canvas.width;
  const height = canvas.height;
  const fps = 30;
  const elapsed = frame / fps;
  const total = timedWords.length ? timedWords.at(-1).end : scenes.reduce((sum, scene) => sum + scene.duration, 0);
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
  const globalProgress = Math.min(1, elapsed / total);
  const pulse = Math.sin(frame / 18);

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
    ctx.globalAlpha = 0.86;
    ctx.drawImage(backgroundVideo, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
    ctx.restore();
    ctx.fillStyle = mode === "parkour" ? "rgba(4, 8, 6, 0.4)" : "rgba(10, 16, 20, 0.2)";
    ctx.fillRect(0, 0, width, height);
  } else if (mode === "parkour") {
    drawParkour(ctx, width, height, frame, accent);
  } else {
    drawFocusField(ctx, width, height, frame, accent, mode);
  }

  const darkText = mode === "focus" || mode === "summary";
  const panelWidth = width * 0.78;
  const panelX = (width - panelWidth) / 2;
  const panelY = height * 0.3;
  const panelHeight = height * 0.38;

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.25)";
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 12;
  ctx.fillStyle = darkText ? "rgba(255,255,255,0.78)" : "rgba(8,11,16,0.68)";
  drawRoundedRect(ctx, panelX, panelY, panelWidth, panelHeight, 18);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = accent;
  ctx.font = "700 32px Inter, Arial, sans-serif";
  ctx.fillText(scene.title.toUpperCase(), panelX + 42, panelY + 62);

  const fontSize = Number(captionStyle.fontSize) || 58;
  const fontFamily = captionStyle.fontFamily === "Inter, Arial, sans-serif" ? "Arial" : (captionStyle.fontFamily || "Arial");
  const textColor = captionStyle.textColor || (darkText ? "#18202a" : "#f8fafc");
  const strokeColor = captionStyle.strokeColor || (darkText ? "#ffffff" : "#101820");
  const strokeWidth = Number(captionStyle.strokeWidth) || 0;
  const highlightColor = captionStyle.highlightColor || accent;
  const position = captionStyle.position || "center";
  const align = captionStyle.align || "left";
  const lineHeight = Number(captionStyle.lineHeight) || Math.round(fontSize * 1.24);
  ctx.fillStyle = textColor;
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = strokeWidth;
  ctx.font = `800 ${fontSize}px ${fontFamily}`;
  const sceneWords = scene.text.split(/\s+/).filter(Boolean);
  const effectiveTextStyle = mode === "summary" ? "summary" : textStyle;
  const activeGroupSize = effectiveTextStyle === "1 word" ? 1 : effectiveTextStyle === "3 words" ? 3 : sceneWords.length;
  const activeStart = Math.min(sceneWords.length - 1, Math.floor(localProgress * sceneWords.length));
  let activeWords = effectiveTextStyle === "summary" ? sceneWords : sceneWords.slice(Math.floor(activeStart / activeGroupSize) * activeGroupSize, Math.floor(activeStart / activeGroupSize) * activeGroupSize + activeGroupSize);
  if (timedWords.length) {
    const currentWordIndex = timedWords.findIndex((word) => elapsed <= word.end);
    const displayWordIndex = currentWordIndex >= 0 ? currentWordIndex : timedWords.length - 1;
    const groupStart = effectiveTextStyle === "1 word" ? displayWordIndex : Math.floor(displayWordIndex / 3) * 3;
    activeWords = timedWords.slice(groupStart, effectiveTextStyle === "1 word" ? groupStart + 1 : groupStart + 3).map((word) => word.punctuated_word || word.word);
  }
  const wordLines = wrapCanvasWords(ctx, activeWords, panelWidth - 84);
  const lines = wordLines.map((line) => line.join(" "));
  const contentHeight = lines.length * lineHeight;
  const textY = position === "top"
    ? panelY + 142
    : position === "bottom"
      ? panelY + panelHeight - contentHeight - 30
      : panelY + (panelHeight - contentHeight) / 2 + fontSize;
  const lineX = (line) => align === "center"
    ? panelX + (panelWidth - ctx.measureText(line).width) / 2
    : align === "right"
      ? panelX + panelWidth - 42 - ctx.measureText(line).width
      : panelX + 42;
  lines.forEach((line, index) => {
    const emphasis = true;
    ctx.globalAlpha = emphasis ? 1 : 0.78;
    const x = lineX(line);
    if (strokeWidth > 0) ctx.strokeText(line, x, textY + index * lineHeight);
    ctx.fillText(line, x, textY + index * lineHeight);
  });
  if (timedWords.length && effectiveTextStyle !== "summary") {
    const currentWordIndex = timedWords.findIndex((word) => elapsed <= word.end);
    if (currentWordIndex < 0) {
      ctx.globalAlpha = 1;
    } else {
      const groupStart = effectiveTextStyle === "1 word" ? currentWordIndex : Math.floor(currentWordIndex / 3) * 3;
    const activeWord = timedWords[currentWordIndex]?.punctuated_word || timedWords[currentWordIndex]?.word;
    const activeOffset = currentWordIndex - groupStart;
    const activeLine = wordLines.findIndex((line) => activeOffset >= 0 && activeOffset < line.length);
    if (activeWord && activeLine >= 0) {
      const wordsBefore = wordLines[activeLine].slice(0, activeOffset).join(" ");
      const prefix = wordsBefore ? wordsBefore + " " : "";
      const baseX = lineX(lines[activeLine]);
      const activeX = align === "center"
        ? baseX + ctx.measureText(prefix).width
        : align === "right"
          ? baseX + ctx.measureText(lines[activeLine]).width - ctx.measureText(activeWord).width - ctx.measureText(wordsBefore).width - (wordsBefore ? ctx.measureText(" ").width : 0)
          : baseX + ctx.measureText(prefix).width;
      ctx.fillStyle = highlightColor;
      ctx.fillText(activeWord, activeX, textY + activeLine * lineHeight);
    }
    }
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = darkText ? "rgba(24,32,42,0.16)" : "rgba(255,255,255,0.18)";
  drawRoundedRect(ctx, width * 0.12, height - 92, width * 0.76, 16, 8);
  ctx.fill();
  ctx.fillStyle = accent;
  drawRoundedRect(ctx, width * 0.12, height - 92, width * 0.76 * globalProgress, 16, 8);
  ctx.fill();

  ctx.font = "700 26px Inter, Arial, sans-serif";
  ctx.fillStyle = darkText ? "#2d3642" : "#eef2f7";
  ctx.fillText(`${sceneIndex + 1}/${scenes.length}`, width * 0.12, height - 118);
  ctx.fillText(`${Math.round(globalProgress * 100)}%`, width * 0.82, height - 118);

  if (mode === "focus") {
    ctx.fillStyle = `rgba(21, 120, 92, ${0.11 + pulse * 0.03})`;
    ctx.fillRect(0, height * (0.23 + localProgress * 0.5), width, 16);
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

function App() {
  const [sourceText, setSourceText] = useState(SAMPLE_TEXT);
  const [title, setTitle] = useState("Working Memory and Reading");
  const [mode, setMode] = useState("focus");
  const [theme, setTheme] = useState("Facts");
  const [inputType, setInputType] = useState("material");
  const [wordsPerScene, setWordsPerScene] = useState(42);
  const [accent, setAccent] = useState("#10b981");
  const [textStyle, setTextStyle] = useState("3 words");
  const [captionStyle, setCaptionStyle] = useState({ fontFamily: "Arial", fontSize: 58, textColor: "#f8fafc", strokeColor: "#101820", strokeWidth: 0, highlightColor: "#10b981", position: "center", align: "left", lineHeight: 72 });
  const [fontBase64, setFontBase64] = useState("");
  const [fontFileName, setFontFileName] = useState("");
  const [backgroundUrl, setBackgroundUrl] = useState("");
  const [backgroundName, setBackgroundName] = useState("");
  const [backgroundBase64, setBackgroundBase64] = useState("");
  const [clipUrl, setClipUrl] = useState("");
  const [clipLibrary, setClipLibrary] = useState([]);
  const [isDownloadingClip, setIsDownloadingClip] = useState(false);
  const [clipOffset, setClipOffset] = useState(0);
  const [apiSectionOpen, setApiSectionOpen] = useState(false);
  const [apiProvider, setApiProvider] = useState("gemini");
  const [apiModel, setApiModel] = useState(AI_PROVIDERS.gemini.model);
  const [aiApiKey, setAiApiKey] = useState("");
  const [deepgramApiKey, setDeepgramApiKey] = useState("");
  const [voiceModel, setVoiceModel] = useState("aura-asteria-en");
  const [apiSaved, setApiSaved] = useState(false);
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

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("focusvid-api-settings") || "{}");
      if (saved.provider && AI_PROVIDERS[saved.provider]) setApiProvider(saved.provider);
      if (saved.model) setApiModel(saved.model);
      if (saved.aiApiKey) setAiApiKey(saved.aiApiKey);
      if (saved.deepgramApiKey) setDeepgramApiKey(saved.deepgramApiKey);
      if (saved.voiceModel) setVoiceModel(saved.voiceModel);
      const editor = JSON.parse(localStorage.getItem("focusvid-editor-settings") || "{}");
      if (editor.inputType) setInputType(editor.inputType);
      if (editor.captionStyle) setCaptionStyle((current) => ({ ...current, ...editor.captionStyle, fontFamily: editor.captionStyle.fontFamily === "Inter, Arial, sans-serif" ? "Arial" : (editor.captionStyle.fontFamily || current.fontFamily) }));
      if (editor.accent) setAccent(editor.accent);
      if (editor.textStyle) setTextStyle(editor.textStyle);
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
      if (previous) URL.revokeObjectURL(previous);
      return "";
    });
  }, [sourceText, mode, wordsPerScene, voiceModel, deepgramApiKey]);

  useEffect(() => () => {
    if (videoUrl.startsWith("blob:")) URL.revokeObjectURL(videoUrl);
  }, [videoUrl]);

  const scenes = useMemo(
    () => makeScenes(sourceText, mode, wordsPerScene),
    [sourceText, mode, wordsPerScene]
  );

  const totalSeconds = timedWords.length ? timedWords.at(-1).end : scenes.reduce((sum, scene) => sum + scene.duration, 0);
  const wordCount = stripText(sourceText).split(/\s+/).filter(Boolean).length;

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
  }, [backgroundUrl]);

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
    if (file.type.startsWith("video/") || file.name.match(/\.(mp4|webm|mov|m4v)$/i)) {
      if (backgroundUrl) URL.revokeObjectURL(backgroundUrl);
      setBackgroundUrl(URL.createObjectURL(file));
      setBackgroundName(file.name);
      setBackgroundBase64(await blobToBase64(file));
      setClipOffset(0);
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
    const canvas = canvasRef.current;
    if (!canvas || !scenes.length) return;

    setIsRendering(true);
    setRenderProgress(0);
    setVideoUrl("");

    try {
    let renderVoiceUrl = voiceUrl;
    let renderVoiceBase64 = voiceBase64;
    let renderWords = timedWords;
    if (!renderVoiceUrl && deepgramApiKey) {
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
      setApiMessage("Generate a Deepgram voice before rendering the video.");
      setIsRendering(false);
      return;
    }

    if ((backgroundBase64 || backgroundUrl.startsWith("/clips/")) && renderVoiceUrl && renderWords.length) {
      try {
        const response = await fetch("/api/render", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ backgroundBase64, backgroundUrl, audioBase64: renderVoiceBase64, words: renderWords, textStyle, captionStyle, fontBase64, fontFileName, clipOffset })
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
    if (backgroundUrl) URL.revokeObjectURL(backgroundUrl);
    setBackgroundUrl("");
    setBackgroundName("");
    setBackgroundBase64("");
    setClipOffset(0);
  };

  const downloadClip = async () => {
    if (!clipUrl.trim()) return;
    setIsDownloadingClip(true);
    setApiMessage("");
    try {
      const response = await fetch("/api/clips/download", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: clipUrl.trim() }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Clip download failed");
      const absoluteUrl = data.url;
      setBackgroundUrl(absoluteUrl);
      setBackgroundName(data.name);
      setBackgroundBase64("");
      setClipOffset(0);
      setClipLibrary((current) => [...current, { name: data.name, url: absoluteUrl }]);
      setApiMessage("Clip downloaded");
    } catch (error) {
      setApiMessage(error.message || "Clip download failed");
    } finally {
      setIsDownloadingClip(false);
    }
  };

  const selectLibraryClip = (clip) => {
    if (!clip) return;
    setBackgroundUrl(clip.url);
    setBackgroundName(clip.name);
    setBackgroundBase64("");
    setClipOffset(0);
  };

  const randomizeClip = () => {
    const video = backgroundVideoRef.current;
    const duration = Number.isFinite(video?.duration) ? video.duration : 60;
    const nextOffset = Math.random() * Math.max(0, duration - Math.min(duration, totalSeconds));
    setClipOffset(nextOffset);
    if (video) video.currentTime = nextOffset;
  };

  const saveApiSettings = () => {
    localStorage.setItem(
      "focusvid-api-settings",
      JSON.stringify({ provider: apiProvider, model: apiModel, aiApiKey, deepgramApiKey, voiceModel })
    );
    localStorage.setItem("focusvid-editor-settings", JSON.stringify({ inputType, captionStyle, accent, textStyle }));
    setApiSaved(true);
    setApiMessage("Settings saved");
    window.setTimeout(() => setApiSaved(false), 2400);
  };

  const generateScript = async () => {
    if (!aiApiKey || !sourceText.trim()) {
      setApiSectionOpen(true);
      setApiMessage("Add input and an AI API key first");
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
      setApiMessage("Script generated");
    } catch (error) {
      setApiMessage(error.message || "Could not generate script");
    } finally {
      setIsGenerating(false);
    }
  };

  const chooseProvider = (value) => {
    setApiProvider(value);
    setApiModel(AI_PROVIDERS[value].model);
  };

  const prepareVoice = async ({ play = true } = {}) => {
    const script = scenes.map((scene) => scene.text).join(" ");
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
          URL.revokeObjectURL(url);
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
          URL.revokeObjectURL(url);
          setApiMessage("Material changed while voice was preparing.");
          return { url: "", words: [], base64: "", failed: true };
        }
        setVoiceBase64(audioBase64);
        setVoiceUrl((previous) => {
          if (previous) URL.revokeObjectURL(previous);
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
      <section className="topbar" aria-label="App summary">
        <div>
          <p className="eyebrow">FocusVid Reader</p>
          <h1>Read better. Finish more.</h1>
        </div>
        <div className="stats">
          <span>{wordCount} words</span>
          <span>{scenes.length} scenes</span>
          <span>{Math.ceil(totalSeconds)} sec</span>
        </div>
      </section>

      <section className="workspace">
        <aside className="controls">
          <section className="api-section">
            <button type="button" className="api-section-header" onClick={() => setApiSectionOpen((open) => !open)}>
              <span><Settings size={18} /> API setup</span>
              <span className="api-state">{apiSaved ? <CheckCircle2 size={16} /> : ""}{apiSectionOpen ? "Hide" : "Show"}</span>
            </button>
            {apiSectionOpen && (
              <div className="api-fields">
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
                  <span><KeyRound size={14} /> {AI_PROVIDERS[apiProvider].label} API key</span>
                  <input type="password" value={aiApiKey} onChange={(event) => setAiApiKey(event.target.value)} placeholder="Paste provider key" autoComplete="off" />
                </label>
                <label>
                  <span><Mic size={14} /> Deepgram API key</span>
                  <input type="password" value={deepgramApiKey} onChange={(event) => setDeepgramApiKey(event.target.value)} placeholder="Paste Deepgram key" autoComplete="off" />
                </label>
                <label>
                  <span>Voice model</span>
                  <select value={voiceModel} onChange={(event) => setVoiceModel(event.target.value)}>
                    {VOICE_MODELS.map((model) => <option key={model} value={model}>{model}</option>)}
                  </select>
                </label>
                <button type="button" className="save-api" onClick={saveApiSettings}><Save size={16} /> Save API settings</button>
                <p className="api-note">Keys stay in this browser&apos;s local storage and are sent only to the local API server when you generate.</p>
                {apiMessage && <p className="api-note api-message">{apiMessage}</p>}
              </div>
            )}
          </section>

          <label className="file-drop">
            <Upload size={20} />
            <span>{isExtracting ? "Reading file..." : "Upload PDF or text"}</span>
            <input type="file" accept=".pdf,.txt,.md,text/plain,application/pdf" onChange={handleFile} />
          </label>

          <label>
            <span>Project title</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>

          <label>
            <span>Input type</span>
            <select value={inputType} onChange={(event) => setInputType(event.target.value)}>
              <option value="material">Study material</option>
              <option value="idea">Idea</option>
            </select>
          </label>

          <label>
            <span>{inputType === "idea" ? "Video idea" : "Study material"}</span>
            <textarea value={sourceText} onChange={(event) => setSourceText(event.target.value)} />
          </label>

          <div className="mode-grid" role="radiogroup" aria-label="Video mode">
            {Object.entries(MODES).map(([key, item]) => {
              const Icon = item.icon;
              return (
                <button
                  className={mode === key ? "mode active" : "mode"}
                  key={key}
                  onClick={() => setMode(key)}
                  type="button"
                  title={item.description}
                >
                  <Icon size={18} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          <label>
            <span>Script theme</span>
            <select value={theme} onChange={(event) => setTheme(event.target.value)}>
              <option value="Facts">Facts</option>
              <option value="Horror">Horror</option>
            </select>
          </label>

          <details className="advanced-options">
            <summary>More options</summary>
            <div className="advanced-fields">
              <label className="file-drop clip-drop">
                <Video size={20} />
                <span>{backgroundName || "Choose background clip"}</span>
                <input type="file" accept="video/*,.mp4,.webm,.mov,.m4v" onChange={handleFile} />
              </label>

              <div className="clip-download-row">
                <input value={clipUrl} onChange={(event) => setClipUrl(event.target.value)} placeholder="YouTube clip URL" />
                <button type="button" className="secondary" onClick={downloadClip} disabled={isDownloadingClip || !clipUrl.trim()}>
                  {isDownloadingClip ? "Downloading" : "Download clip"}
                </button>
              </div>

              {clipLibrary.length > 0 && (
                <label>
                  <span>Clip library</span>
                  <select value={backgroundName} onChange={(event) => selectLibraryClip(clipLibrary.find((clip) => clip.name === event.target.value))}>
                    <option value="">Choose saved clip</option>
                    {clipLibrary.map((clip) => <option key={clip.name} value={clip.name}>{clip.name}</option>)}
                  </select>
                </label>
              )}

          {backgroundUrl && (
            <div className="clip-actions">
              <button type="button" onClick={randomizeClip} title="Choose a random starting point in the clip">
                <Shuffle size={16} />
                Randomize clip position
              </button>
              <button type="button" onClick={clearBackground} title="Remove background clip">
                <X size={16} />
                Remove
              </button>
            </div>
          )}

              <div className="style-row" role="radiogroup" aria-label="Caption timing style">
            <span>Caption timing</span>
            <div>
              {[["1 word", "1 word"], ["3 words", "3 words"]].map(([value, label]) => (
                <button type="button" key={value} className={textStyle === value ? "style-button active" : "style-button"} onClick={() => setTextStyle(value)}>
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

          <div className="action-row">
            <button type="button" onClick={speakPreview}>
              {isVoiceLoading ? <Loader2 className="spin" size={18} /> : <Mic size={18} />}
              {isVoiceLoading ? "Preparing voice" : "Preview voice"}
            </button>
            <button type="button" onClick={stopSpeech}>
              <Pause size={18} />
              Stop
            </button>
          </div>
            </div>
          </details>
        </aside>

        <section className="stage">
          <div className="stage-header">
            <div>
              <p className="eyebrow">{MODES[mode].label} · {Math.ceil(totalSeconds)} sec</p>
              <h2>{title || "Untitled reading"}</h2>
            </div>
            <div className="stage-actions">
              <button type="button" className="secondary" onClick={generateScript} disabled={isGenerating || !sourceText.trim()}>
                {isGenerating ? <Loader2 className="spin" size={17} /> : <Sparkles size={17} />}
                {isGenerating ? "Generating" : "Generate script"}
              </button>
              <button type="button" className="primary" onClick={renderVideo} disabled={isRendering || !scenes.length}>
                {isRendering ? <Loader2 className="spin" size={18} /> : <Video size={18} />}
                {isRendering ? `${Math.round(renderProgress * 100)}%` : "Render video"}
              </button>
            </div>
          </div>

          <canvas ref={canvasRef} width="1080" height="1920" aria-label="Video preview" />
          <video ref={backgroundVideoRef} src={backgroundUrl} muted loop playsInline className="source-video" aria-hidden="true" />

          <div className="outputs">
            <div className="script-panel">
              <div className="panel-title">
                <FileText size={18} />
                <span>Generated script</span>
              </div>

              <textarea readOnly value={scriptText} />
            </div>

            <div className="download-panel">
              <div className="panel-title">
                <Wand2 size={18} />
                <span>Export</span>
              </div>
              {videoUrl ? (
                <>
                  <video src={videoUrl} controls />
                  <a className="download" href={videoUrl} download={(title || "focus-video") + "." + (videoUrl.includes("/outputs/") ? "mp4" : "webm")}>
                    <Download size={18} />
                    Download {videoUrl.includes("/outputs/") ? "MP4" : "WebM"}
                  </a>
                </>
              ) : (
                <div className="empty-export">
                  <Play size={30} />
                  <span>Render when the scenes feel right.</span>
                </div>
              )}
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
