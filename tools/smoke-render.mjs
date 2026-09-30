import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import ffmpeg from "@ffmpeg-installer/ffmpeg";
import { moveScene, normalizeEditableScenes, sceneTotalSeconds, toEditableScenes } from "../src/scene-utils.js";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const ffmpegPath = ffmpeg.path;
const port = 39000 + Math.floor(Math.random() * 1000);
const baseUrl = `http://127.0.0.1:${port}`;

const run = (command, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { windowsHide: true, ...options });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
  child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
  child.on("error", reject);
  child.on("close", (code) => resolve({ code, stdout, stderr }));
});

const runChecked = async (command, args, options = {}) => {
  const result = await run(command, args, options);
  if (result.code !== 0) throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
  return result;
};

const waitForServer = async () => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/clips`);
      if (response.ok) return;
    } catch {
      // The server may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Render smoke server did not start in time.");
};

const render = async (fixture, options = {}) => {
  const response = await fetch(`${baseUrl}/api/render`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      backgroundBase64: fixture.backgroundBase64,
      audioBase64: fixture.audioBase64,
      words: fixture.words,
      textStyle: "1 word",
      captionStyle: { fontFamily: "Arial", fontSize: 58, textColor: "#ffffff", strokeColor: "#000000", strokeWidth: 3, highlightColor: "#ffcc00", position: "center", align: "center" },
      ...options
    })
  });
  const data = await response.json();
  assert.equal(response.ok, true, data.error || "Render request failed");
  return data;
};

const dimensions = async (filepath) => {
  const result = await run(ffmpegPath, ["-hide_banner", "-i", filepath]);
  const match = result.stderr.match(/Video:.*?(\d{3,5})x(\d{3,5})/);
  assert.ok(match, `Could not inspect dimensions for ${filepath}: ${result.stderr}`);
  return { width: Number(match[1]), height: Number(match[2]) };
};

const main = async () => {
  const seedScenes = toEditableScenes([
    { title: "First", text: "Read this first.", duration: 2 },
    { title: "Second", text: "Then read this.", duration: 3 }
  ]);
  assert.equal(seedScenes.length, 2, "editable scene conversion failed");
  assert.ok(seedScenes.every((scene) => scene.id), "editable scenes need stable ids");
  assert.equal(sceneTotalSeconds(seedScenes), 5, "scene duration total mismatch");
  const reordered = moveScene(seedScenes, 1, -1);
  assert.equal(reordered[0].title, "Second", "scene ordering failed");
  assert.equal(reordered[1].title, "First", "scene ordering did not preserve both scenes");
  assert.equal(normalizeEditableScenes([{ title: "Empty", text: "   ", duration: 3 }]).length, 0, "empty scenes should not be renderable");
  console.log("PASS editable scene model, ordering, duration totals, and validation");

  const tempRoot = await fs.mkdtemp(join(tmpdir(), "focusvid-render-smoke-"));
  const server = spawn(process.execPath, ["server.mjs"], {
    cwd: rootDir,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", DATA_DIR: tempRoot, APP_PASSWORD: "" }
  });

  try {
    await runChecked(ffmpegPath, ["-y", "-f", "lavfi", "-i", "color=c=blue:s=640x360:d=2", "-pix_fmt", "yuv420p", join(tempRoot, "background.mp4")]);
    await runChecked(ffmpegPath, ["-y", "-f", "lavfi", "-i", "sine=frequency=660:duration=2", "-t", "2", join(tempRoot, "voice.mp3")]);
    await runChecked(ffmpegPath, ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-t", "1", join(tempRoot, "music.mp3")]);
    const fixture = {
      backgroundBase64: (await fs.readFile(join(tempRoot, "background.mp4"))).toString("base64"),
      audioBase64: (await fs.readFile(join(tempRoot, "voice.mp3"))).toString("base64"),
      musicBase64: (await fs.readFile(join(tempRoot, "music.mp3"))).toString("base64"),
      words: [
        { word: "Creator", punctuated_word: "Creator", start: 0, end: 0.7 },
        { word: "test", punctuated_word: "test", start: 0.7, end: 1.4 }
      ]
    };

    await waitForServer();
    const musicUpload = await fetch(`${baseUrl}/api/music/upload?name=smoke-music.mp3`, {
      method: "POST",
      headers: { "Content-Type": "audio/mpeg" },
      body: await fs.readFile(join(tempRoot, "music.mp3"))
    });
    const musicData = await musicUpload.json();
    assert.equal(musicUpload.ok, true, musicData.error || "Music upload failed");
    const musicLibrary = await fetch(`${baseUrl}/api/music`).then((response) => response.json());
    assert.ok(musicLibrary.some((track) => track.name === musicData.name), "uploaded music was not listed");
    const voiceUpload = await fetch(`${baseUrl}/api/voiceovers/upload?name=smoke-voice.mp3`, {
      method: "POST",
      headers: { "Content-Type": "audio/mpeg" },
      body: await fs.readFile(join(tempRoot, "voice.mp3"))
    });
    assert.equal(voiceUpload.ok, true, await voiceUpload.text());
    console.log("PASS music and voiceover upload libraries");
    const cases = [
      { name: "portrait/full", expected: [1080, 1920], options: {} },
      { name: "landscape/bottom-third", expected: [1920, 1080], options: { renderProfile: "landscape", layout: "bottom-third", watermark: { enabled: true, text: "FocusVid", opacity: 0.7, scale: "medium" } } },
      { name: "square/split", expected: [1080, 1080], options: { renderProfile: "square", layout: "split", watermark: { enabled: true, text: "FocusVid", opacity: 0.7, scale: "small" } } },
      { name: "watermark-large", expected: [1080, 1920], options: { watermark: { enabled: true, text: "FocusVid", opacity: 0.7, scale: "large" } } },
      { name: "empty-watermark-and-invalid-options", expected: [1080, 1920], options: { renderProfile: "invalid", layout: "invalid", watermark: { enabled: true, text: "   ", opacity: 4, scale: "invalid" } } },
      { name: "synchronized/full", expected: [1080, 1920], options: { syncGameplay: true, sceneTimeline: [{ start: 0, end: 0.7, index: 0 }, { start: 0.7, end: 1.4, index: 1 }] } },
      { name: "synchronized/bottom-third", expected: [1920, 1080], options: { renderProfile: "landscape", layout: "bottom-third", syncGameplay: true, sceneTimeline: [{ start: 0, end: 0.7, index: 0 }, { start: 0.7, end: 1.4, index: 1 }] } },
      { name: "synchronized/split", expected: [1080, 1080], options: { renderProfile: "square", layout: "split", syncGameplay: true, sceneTimeline: [{ start: 0, end: 0.7, index: 0 }, { start: 0.7, end: 1.4, index: 1 }] } }
    ];

    for (const testCase of cases) {
      const data = await render(fixture, testCase.options);
      const outputPath = join(tempRoot, "outputs", basename(new URL(data.url, baseUrl).pathname));
      const actual = await dimensions(outputPath);
      assert.deepEqual([actual.width, actual.height], testCase.expected, `${testCase.name} dimensions mismatch`);
      console.log(`PASS ${testCase.name}: ${actual.width}x${actual.height}`);
    }

    const mixed = await render(fixture, { musicBase64: fixture.musicBase64, musicVolume: 0.18, ducking: true, backgroundVolume: 0.1 });
    const mixedPath = join(tempRoot, "outputs", basename(new URL(mixed.url, baseUrl).pathname));
    const mixedDimensions = await dimensions(mixedPath);
    assert.deepEqual([mixedDimensions.width, mixedDimensions.height], [1080, 1920], "mixed audio dimensions mismatch");
    console.log("PASS audio mixing with music, ducking, and gameplay audio");

    const captionless = await render({ ...fixture, words: [] }, { musicBase64: fixture.musicBase64, musicVolume: 0.18 });
    const captionlessPath = join(tempRoot, "outputs", basename(new URL(captionless.url, baseUrl).pathname));
    const captionlessDimensions = await dimensions(captionlessPath);
    assert.deepEqual([captionlessDimensions.width, captionlessDimensions.height], [1080, 1920], "captionless audio dimensions mismatch");
    console.log("PASS captionless narration render");

    const malformedSync = await render(fixture, { syncGameplay: true, sceneTimeline: [{ start: 0.4, end: 0.8, index: 0 }] });
    const malformedSyncPath = join(tempRoot, "outputs", basename(new URL(malformedSync.url, baseUrl).pathname));
    const malformedSyncDimensions = await dimensions(malformedSyncPath);
    assert.deepEqual([malformedSyncDimensions.width, malformedSyncDimensions.height], [1080, 1920], "malformed sync dimensions mismatch");
    console.log("PASS malformed synchronization fallback");

    const shortClipSync = await render(fixture, {
      syncGameplay: true,
      randomStart: true,
      clipOffset: 0.5,
      sceneTimeline: [
        { start: 0, end: 0.7, index: 0 },
        { start: 0.7, end: 1.4, index: 1 },
        { start: 1.4, end: 2.04, index: 2 }
      ]
    });
    const shortClipSyncPath = join(tempRoot, "outputs", basename(new URL(shortClipSync.url, baseUrl).pathname));
    const shortClipSyncDimensions = await dimensions(shortClipSyncPath);
    assert.deepEqual([shortClipSyncDimensions.width, shortClipSyncDimensions.height], [1080, 1920], "short clip synchronization dimensions mismatch");
    console.log("PASS synchronized looping with random start");
  } finally {
    server.kill();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
};

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
