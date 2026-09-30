import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import { ArrowRight, Brain, Check, ChevronDown, Copy, ExternalLink, FileText, Gift, GraduationCap, Menu, Mic, Moon, Play, Share2, Sparkles, Smartphone, Sun, Video, X, Zap } from "lucide-react";
import { apiFetch, assetUrl } from "./api.js";
import "./styles.css";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const EDGE_VOICES = {
  Ashley: "en-US-AriaNeural",
  Sarah: "en-US-JennyNeural",
  Deborah: "en-US-MichelleNeural",
  Olivia: "en-GB-SoniaNeural",
  Alex: "en-US-GuyNeural",
  Mark: "en-US-ChristopherNeural",
  Craig: "en-GB-RyanNeural",
  Ronald: "en-AU-NatashaNeural",
  Hades: "en-US-AriaNeural"
};

const arrayBufferToBase64 = (buffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
};

const extractPdfText = async (file) => {
  const document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= Math.min(document.numPages, 10); pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => item.str).join(" "));
  }
  return pages.join("\n\n").replace(/\s+/g, " ").trim();
};

const tools = [
  ["PDF to Brainrot", "Turn notes into a viral study video", FileText],
  ["Text to Brainrot", "Paste any text and start learning", Sparkles],
  ["Minecraft Parkour", "Add fast-moving background footage", Zap],
  ["Subway Surfers", "Make your study clip impossible to ignore", Smartphone],
];
const faqItems = [
  ["What is brainrot content and why does it help studying?", "Brainrot videos combine educational content with viral background gameplay like Minecraft or Subway Surfers. The constant visual stimulation helps ADHD students and Gen Z learners focus better by keeping attention locked on the screen."],
  ["Is EasyBrainrot really free to use?", "Yes. You can create unlimited videos for free with a watermark. Upgrade when you want watermark-free exports."],
  ["Can I edit the video after it's generated?", "You can adjust your voice, speed, background, and source text before generating a new version."],
  ["What file formats can I upload?", "Upload PDFs or paste text directly. PDF uploads can be up to 10 pages or 5,000 words."],
  ["Can I use these videos on TikTok and YouTube?", "Yes. Videos are built in a vertical 9:16 format for TikTok, Instagram Reels, and YouTube Shorts."],
  ["Why is speed control important?", "Different study moments call for different pacing. Slow down for new ideas or move to 1.2x when reviewing familiar material."],
  ["How long does it take to generate a video?", "Most videos are ready in about 60 seconds."],
  ["Can I share videos with my study group?", "Absolutely. Download the video and share it anywhere your study group already hangs out."],
  ["What makes EasyBrainrot different from other PDF converters?", "It combines narration, study-friendly pacing, and viral gameplay into a format designed for attention and recall."],
  ["Is my uploaded content private and secure?", "Your uploaded content is used to create your video and is not shared publicly by EasyBrainrot."],
];
const testimonials = [
  ["I have ADHD and regular study methods never worked. Brainrot videos help me actually focus and retain information. Went from failing biology to getting a B+ in 3 weeks!", "Sarah K.", "High School Senior, 3.9 GPA"],
  ["My study videos went viral! 127K views on TikTok and people are actually learning. EasyBrainrot helped me turn my notes into content that helps thousands of students.", "Mike T.", "College Freshman, @studywithmike"],
  ["Studying for MCAT was brutal until I found this. The speed control at 1.2x is perfect for reviewing hundreds of flashcards quickly. Cut my study time by 40%!", "Emma L.", "Med Student, Future Doctor"],
];

function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [playingCard, setPlayingCard] = useState(null);
  const [galleryOffset, setGalleryOffset] = useState(0);
  const [activeFaq, setActiveFaq] = useState(null);
  return <div className={dark ? "site dark" : "site"}>
    <header className="topbar">
      <a className="brand" href="#top"><img src="/easybrainrot/logo.png" alt="" /><span>EasyBrainrot</span></a>
      <div className="desktop-nav"><a href="#usage">How It Works</a><a href="#features">Features</a><a href="#faq">FAQ</a><a className="nav-cta" href="/pdf-to-brainrot">Try It Free <ArrowRight size={15}/></a><button className="icon-button" aria-label="Toggle dark mode" onClick={() => setDark(!dark)}>{dark ? <Sun size={18}/> : <Moon size={18}/>}</button></div>
      <button className="menu-button" aria-label={menuOpen ? "Close Menu" : "Open Menu"} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X size={21}/> : <Menu size={21}/>}</button>
    </header>
    {menuOpen && <div className="mobile-menu"><div className="mobile-menu-links"><button className="menu-row menu-tools" onClick={() => setToolsOpen(!toolsOpen)}><span>Tools</span><ChevronDown size={16} className={toolsOpen ? "rotate" : ""}/></button>{toolsOpen && <div className="tool-submenu"><a href="/pdf-to-brainrot" onClick={() => setMenuOpen(false)}>PDF to Brainrot</a><a href="/text-to-brainrot" onClick={() => setMenuOpen(false)}>Text to Brainrot</a><a href="/minecraft-parkour-video-generator" onClick={() => setMenuOpen(false)}>Minecraft Parkour</a><a href="/subway-surfers-video-generator" onClick={() => setMenuOpen(false)}>Subway Surfers</a></div>}<a className="menu-row" href="/blog" onClick={() => setMenuOpen(false)}>Blog</a><a className="menu-row" href="/slang" onClick={() => setMenuOpen(false)}>Slang</a><a className="menu-row" href="/pricing" onClick={() => setMenuOpen(false)}>Pricing</a></div><div className="mobile-menu-bottom"><button aria-label="Toggle dark mode" onClick={() => setDark(!dark)}>{dark ? <Sun size={18}/> : <Moon size={18}/>}</button><button aria-label="Change language">文</button><a className="menu-signin" href="/pdf-to-brainrot" onClick={() => setMenuOpen(false)}>Sign In</a></div></div>}
    <main id="top">
      <section className="hero wrap">
        <div className="hero-copy"><div className="pill"><Sparkles size={14}/> Study smarter, scroll happier</div><h1>Turn Boring PDFs into <span>Viral Brainrot</span> Videos</h1><p>Transform any PDF into entertaining, TikTok-inspired “brainrot” content. Learn faster, remember longer, and have fun doing it!</p><div className="hero-actions"><a className="primary" href="/pdf-to-brainrot">Start Converting Now <ArrowRight size={17}/></a><a className="secondary" href="#what-is-brainrot">See how it works <Play size={15} fill="currentColor"/></a></div><div className="trust"><Check size={15}/> Create unlimited videos free <span>·</span> Remove watermark anytime</div></div>
        <div className="hero-art"><div className="hero-card card-back"><span>📚</span><strong>Study notes</strong><small>Make them memorable</small></div><div className="hero-card card-main"><div className="card-top"><span className="sparkle">✦</span><span>READY TO LEARN</span><span className="dots">•••</span></div><div className="brain-graphic"><Brain size={85} strokeWidth={1.2}/><span className="graphic-dot d1"/><span className="graphic-dot d2"/><span className="graphic-dot d3"/></div><strong>focus mode</strong><div className="progress"><i/></div><small>01:24 · chapter 03</small></div><div className="float-note note-a"><Zap size={14}/> 1.2x speed</div><div className="float-note note-b"><Mic size={14}/> 7 AI voices</div></div>
      </section>
      <section className="tool-strip wrap"><span className="strip-label">Make it your way</span>{tools.map(([name,desc,Icon],i) => <a className="tool-card" href={["/pdf-to-brainrot","/text-to-brainrot","/minecraft-parkour-video-generator","/subway-surfers-video-generator"][i]} key={name}><Icon size={18}/><span><strong>{name}</strong><small>{desc}</small></span><ArrowRight className="tool-arrow" size={15}/></a>)}</section>
      <section className="section gallery-section"><div className="wrap"><div className="section-heading"><div><span className="eyebrow">Made for the feed</span><h2>Latest Brainrot Videos</h2></div><div className="gallery-heading-actions"><p>See what students are creating with EasyBrainrot</p><div className="gallery-controls"><button aria-label="Scroll left" disabled={galleryOffset===0} onClick={() => setGalleryOffset(Math.max(0,galleryOffset-1))}>‹</button><button aria-label="Scroll right" disabled={galleryOffset>=5} onClick={() => setGalleryOffset(Math.min(5,galleryOffset+1))}>›</button></div></div></div><div className="gallery" style={{'--gallery-offset': galleryOffset}}>{[["sample-80.mp4","Raw Mode"],["sample-82.mp4","Quiz Mode"],["what-is-brainrot-content.mp4","Focus Scroll"],["sample-80.mp4","Bionic Reading"],["sample-82.mp4","Study Summary"],["what-is-brainrot-content.mp4","Recall Beats"],["sample-80.mp4","Quick Review"],["sample-82.mp4","Deep Focus"],["what-is-brainrot-content.mp4","Chapter Notes"]].map(([src,mode],i)=><button className={playingCard===i ? "video-card playing" : "video-card"} key={i} aria-label={`Play ${mode} sample ${i+1}`} onClick={(e)=>{const v=e.currentTarget.querySelector("video"); if(v.paused){v.play();setPlayingCard(i);}else{v.pause();setPlayingCard(null);}}}><video src={"/easybrainrot/"+src} muted loop playsInline/><span className="play-badge">{playingCard===i ? <span className="pause-bars small">Ⅱ</span> : <Play size={16} fill="currentColor"/>}</span><span className="video-meta"><b>{mode}</b><small>November 2025</small></span></button>)}</div></div></section>
      <section className="section explain wrap" id="what-is-brainrot"><div className="explain-video"><video src="/easybrainrot/what-is-brainrot-content.mp4" muted loop playsInline autoPlay={videoPlaying} /><button className="big-play" aria-label={videoPlaying ? "Pause video" : "Play video"} onClick={() => setVideoPlaying(!videoPlaying)}>{videoPlaying ? <span className="pause-bars">Ⅱ</span> : <Play size={28} fill="currentColor"/>}</button><span className="video-caption">What is brainrot content?</span></div><div className="explain-copy"><span className="eyebrow">A better way to focus</span><h2>What is Brainrot Content?</h2><p className="lede">Those TikToks with Minecraft parkour or Subway Surfers in the background? That’s brainrot — and it actually helps you study.</p><div className="benefits"><Benefit Icon={Brain} title="Dual Stimulation">Background gameplay keeps your restless brain occupied while you absorb information.</Benefit><Benefit Icon={Smartphone} title="TikTok Format">Vertical 9:16 videos optimized for how Gen Z actually consumes content.</Benefit><Benefit Icon={Zap} title="ADHD-Friendly">Constant visual movement helps maintain focus for students who struggle with traditional studying.</Benefit><Benefit Icon={GraduationCap} title="Study Hack">Turn boring notes into memorable, shareable content. Study smarter, not harder.</Benefit></div><a className="text-link" href="/pdf-to-brainrot">Try It Free <ArrowRight size={16}/></a></div></section>
      <section className="section workflow" id="usage"><div className="wrap"><div className="center-heading"><span className="eyebrow">From notes to scroll-stopping</span><h2>How It Works</h2><p>Create viral brainrot study videos in 3 simple steps. Takes about 60 seconds.</p></div><div className="steps"><Step num="01" icon={<FileText size={24}/>} title="Upload Your PDF">Drag and drop your study notes, textbook pages, or paste text directly. Up to 10 pages or 5,000 words.</Step><Step num="02" icon={<Mic size={24}/>} title="Customize Voice & Speed ⚡">Choose from 7 AI voices and adjust speed (0.7x–1.2x). Pick your favorite viral background.</Step><Step num="03" icon={<Video size={24}/>} title="Share on TikTok">Download your viral study video in 60 seconds. Share directly to TikTok, Instagram, or YouTube Shorts.</Step></div></div></section>
      <section className="section features wrap" id="features"><div className="center-heading"><span className="eyebrow">Built for the way you learn</span><h2>Why Students Love EasyBrainrot</h2><p>Create viral study content with features designed for Gen Z learning.</p></div><div className="feature-grid"><Feature Icon={Zap} title="Speed Control ⚡">Adjust playback speed from 0.7x to 1.2x for better comprehension.</Feature><Feature Icon={Mic} title="Multiple AI Voices">Choose from 7 unique AI voices. Find the perfect narrator for your study vibe.</Feature><Feature Icon={Smartphone} title="Viral Backgrounds">Minecraft parkour, Subway Surfers, GTA gameplay, and abstract visuals.</Feature><Feature Icon={Gift} title="100% Free Start">Unlimited video generation with watermark. No credit card required.</Feature></div></section>
      <section className="section testimonials"><div className="wrap"><div className="center-heading"><span className="eyebrow">Real students, real results</span><h2>Student Success Stories</h2><p>Real students using EasyBrainrot to ace their exams and go viral on TikTok.</p></div><div className="testimonial-grid">{testimonials.map(([quote,name,role])=><article className="quote-card" key={name}><div className="quote-mark">“</div><p>{quote}</p><footer><span className="avatar">{name[0]}</span><span><strong>{name}</strong><small>{role}</small></span></footer></article>)}</div></div></section>
      <section className="section faq wrap" id="faq"><div className="center-heading"><span className="eyebrow">Need to know</span><h2>Frequently Asked Questions</h2><p>Everything you need to know about creating brainrot study videos.</p></div><div className="faq-list">{faqItems.map(([q,a],i)=><div className={activeFaq===i ? "faq-item open" : "faq-item"} key={q}><button onClick={() => setActiveFaq(activeFaq===i ? null : i)} aria-expanded={activeFaq===i}><span>{q}</span><ChevronDown size={18}/></button>{activeFaq===i && <div className="faq-answer"><p>{a}</p></div>}</div>)}</div><p className="support">Still have questions? Email us at <a href="mailto:support@easybrainrot.com">support@easybrainrot.com</a></p></section>
      <section className="cta" id="cta"><div className="wrap cta-inner"><div><span className="eyebrow">Ready when you are</span><h2>Ready to Create Your First Brainrot Video?</h2><p>Join 2,938+ students who are studying smarter with viral brainrot content.</p></div><div className="cta-actions"><a className="primary" href="/pdf-to-brainrot">PDF to Brainrot <ArrowRight size={16}/></a><a className="secondary" href="/text-to-brainrot">Text to Brainrot <ArrowRight size={16}/></a></div></div></section>
    </main>
    <footer className="footer"><div className="wrap footer-grid"><div className="footer-brand"><a className="brand" href="#top"><img src="/easybrainrot/logo.png" alt=""/><span>EasyBrainrot</span></a><p>Turn boring PDFs into viral brainrot study videos. Perfect for Gen Z students who learn better with TikTok-style content.</p></div><div><b>Tools</b><a href="/pdf-to-brainrot">PDF to Brainrot</a><a href="/text-to-brainrot">Text to Brainrot</a><a href="/minecraft-parkour-video-generator">Minecraft Parkour</a><a href="/subway-surfers-video-generator">Subway Surfers</a></div><div><b>Product</b><a href="#features">Features</a><a href="#usage">How It Works</a><a href="/pricing">Pricing</a><a href="#faq">FAQ</a></div><div><b>Resources</b><a href="/blog">Blog</a><a href="/slang">Slang Guide</a><a href="https://vicsee.com/">VicSee AI Studio</a><a href="https://hvacservice.io/">HVAC services near me</a><b>Legal</b><a href="/privacy-policy">Privacy Policy</a><a href="/terms-of-service">Terms of Service</a></div></div><div className="wrap footer-bottom"><span>© 2026 EasyBrainrot, All rights reserved</span><span>Made for focused minds ✦</span></div></footer>
  </div>;
}
function App() {
  const path = window.location.pathname;
  if (path === "/pdf-to-brainrot" || path === "/text-to-brainrot") {
    return <ToolPage type={path.startsWith("/pdf") ? "pdf" : "text"} />;
  }
  if (path === "/minecraft-parkour-video-generator" || path === "/subway-surfers-video-generator") {
    return <ToolPage type={path.startsWith("/minecraft") ? "minecraft" : "subway"} />;
  }
  if (path === "/pricing") return <PricingPage />;
  if (path === "/blog") return <ResourcePage kind="blog" />;
  if (path === "/slang") return <ResourcePage kind="slang" />;
  return <LandingPage />;
}

function SimpleHeader() { return <header className="tool-header wrap"><a className="brand" href="/"><img src="/easybrainrot/logo.png" alt=""/><span>EasyBrainrot</span></a><nav><a href="/blog">Blog</a><a href="/slang">Slang</a><a href="/pricing">Pricing</a><button aria-label="Toggle theme" onClick={() => document.body.classList.toggle("theme-dark")}><Moon size={17}/></button><a className="sign-in" href="/pdf-to-brainrot">Sign In</a></nav></header> }

function PricingPage() {
  const plans = [["Starter","$9","Perfect for trying a few videos","100 video generations"],["Growth","$25","Most popular for students","500 video generations"],["Pro","$45","Best value for power users","1,000 video generations"]];
  return <div className="resource-page"><SimpleHeader/><div className="tool-breadcrumb wrap"><a href="/">Home</a><span>›</span><span>Pricing</span></div><section className="pricing-intro"><h1>EasyBrainrot Pricing</h1><h2>Simple, transparent pricing</h2><p>Choose your credit package. No subscriptions, no hidden fees.</p></section><section className="pricing-grid wrap">{plans.map(([name,price,copy,credits],i)=><article className={i===1 ? "price-card popular" : "price-card"} key={name}>{i===1 && <span className="price-badge">Most Popular</span>}{i===2 && <span className="price-badge">Best Value</span>}<h3>{name}</h3><strong>{price}</strong><p>{copy}</p><small>{i===0 ? "$0.09" : i===1 ? "$0.05" : "$0.045"} per video</small><a className="primary" href="/pdf-to-brainrot">{i===1 ? "Get Started" : "Buy Now"}</a><hr/><b>Includes</b><ul><li>{credits}</li><li>No watermark</li><li>All 7 AI voices</li><li>All viral backgrounds</li><li>HD video export</li><li>Credits never expire</li></ul></article>)}</section><section className="pricing-note"><h2>Start creating for free</h2><p>Try the generator first, then choose a credit package when you’re ready to export without a watermark.</p><a className="primary" href="/text-to-brainrot">Try It Free <ArrowRight size={16}/></a></section></div>
}

function ResourcePage({ kind }) {
  const blogPosts = [["Why Brainrot Videos Help ADHD Brains Focus (Science Explained)","The neuroscience behind why Minecraft parkour helps you study.","Dec 2, 2025"],["The Complete Guide to Brainrot Studying for ADHD Students","Why brainrot videos help when textbooks fail.","Nov 29, 2025"],["PDF to Brainrot Free: Complete Guide 2025","Convert any PDF to brainrot video free.","Nov 28, 2025"],["What is Brainrot? The Complete Guide for 2025","Discover what brainrot really means and why it is changing study content.","Nov 27, 2025"],["Why Brainrot Videos Actually Help You Study","The science behind dual attention and retention.","Nov 25, 2025"]];
  const slang = [["Aura","What does aura mean in Gen Z slang? The viral concept of gaining and losing cool points explained.","2023-2024"],["Brainrot","What does brainrot mean? Oxford's 2024 Word of the Year explained.","2020s"],["Fanum Tax","The viral food-stealing meme explained.","2022-2023"],["Gyatt","The viral TikTok exclamation explained.","2022-2023"],["Mewing","The viral jawline trend explained.","2019-2024"],["NPC","The viral insult comparing people to video game characters explained.","2018-2023"],["Ohio","Why Gen Z says 'only in Ohio'.","2016-2022"],["Rizz","Oxford's 2023 Word of the Year explained.","2021-2022"],["Sigma","The sigma male meme and sigma grindset explained.","2021"],["Skibidi","The versatile slang term from Skibidi Toilet.","2023"]];
  const items = kind === "blog" ? blogPosts : slang; const title = kind === "blog" ? "Blog" : "Brainrot Slang Guide"; const subtitle = kind === "blog" ? "Read about our latest product features, solutions, and updates." : "Your complete guide to Gen Z slang, brainrot terms, and internet culture. Updated for 2025.";
  return <div className="resource-page"><SimpleHeader/><section className="resource-intro"><h1>{title}</h1><p>{subtitle}</p>{kind === "blog" && <div className="resource-tabs"><button className="selected">All</button><button>Guides</button><button>Education</button></div>}</section><section className="resource-grid wrap">{items.map(([name,copy,date],i)=><a className="resource-card" href={kind === "blog" ? "/blog" : "/slang"} key={name}>{kind === "blog" ? <div className={`resource-image image-${i%3}`}>{i===0 ? "ADHD + Brainrot" : i===2 ? "PDF to Brainrot" : "Study smarter"}</div> : <span className="resource-tag">{i%3===0 ? "Slang" : i%3===1 ? "TikTok Culture" : "Meme"}</span>}<h2>{name}</h2><p>{copy}</p><small>{kind === "blog" ? date + " · EasyBrainrot Team" : "Popular since: " + date}</small></a>)}</section>{kind === "slang" && <section className="resource-cta"><h2>Turn Your Notes into Brainrot Videos</h2><p>Convert boring study materials into TikTok-style videos you’ll actually watch.</p><a className="primary" href="/pdf-to-brainrot">Try PDF to Brainrot Free <ArrowRight size={16}/></a></section>}</div>
}

function ToolPage({ type }) {
  const isPdf = type === "pdf";
  const isText = type === "text";
  const label = isPdf ? "PDF to Brainrot" : isText ? "Text to Brainrot" : type === "minecraft" ? "Minecraft Parkour" : "Subway Surfers";
  const title = isPdf ? "PDF to Brainrot Video Generator" : isText ? "Text to Brainrot Generator" : `${label} Video Generator`;
  const description = isPdf ? "Transform your study notes into engaging brainrot videos perfect for TikTok, Instagram Reels, and YouTube Shorts." : isText ? "Convert your notes, blog posts, or any text into engaging brainrot videos perfect for TikTok, Instagram Reels, and YouTube Shorts." : `Create viral vertical videos with ${label.toLowerCase()} gameplay and your own narration.`;
  const [mode, setMode] = useState("Brainrot Mode");
  const [text, setText] = useState("");
  const [pdfFile, setPdfFile] = useState(null);
  const [fileName, setFileName] = useState("");
  const [background, setBackground] = useState(type === "subway" ? "Subway Surfer" : "Minecraft");
  const [music, setMusic] = useState("Fluffing a Duck");
  const [voice, setVoice] = useState("Ashley");
  const [advanced, setAdvanced] = useState(false);
  const [watermark, setWatermark] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState("");
  const [outputUrl, setOutputUrl] = useState("");
  const [speed, setSpeed] = useState(1);
  const [volume, setVolume] = useState(20);
  const [profile, setProfile] = useState(() => {
    try { return JSON.parse(localStorage.getItem("easybrainrot-reading-profile")) || { name: "Balanced", density: "medium", stimulation: "medium", speed: 1 }; } catch { return { name: "Balanced", density: "medium", stimulation: "medium", speed: 1 }; }
  });
  const [shareMessage, setShareMessage] = useState("");
  const previewRef = useRef(null);
  const hasInput = isPdf ? Boolean(fileName) : isText ? text.trim().length > 0 : true;
  const sample = "Working memory is the mental workspace used to hold and manipulate information for a short time. Break dense material into smaller goals, pause briefly, and restate the point in your own words.";
  const video = background === "Subway Surfer" ? "/easybrainrot/sample-82.mp4" : "/easybrainrot/sample-80.mp4";
  useEffect(() => {
    if (!previewRef.current) return;
    previewRef.current.load();
    previewRef.current.play().catch(() => undefined);
  }, [video, outputUrl]);
  useEffect(() => { localStorage.setItem("easybrainrot-reading-profile", JSON.stringify(profile)); setSpeed(profile.speed); }, [profile]);
  const profiles = { Balanced: { density: "medium", stimulation: "medium", speed: 1 }, "Deep Focus": { density: "low", stimulation: "low", speed: 0.8 }, "Quick Review": { density: "high", stimulation: "high", speed: 1.2 }, Custom: { density: profile.density, stimulation: profile.stimulation, speed } };
  const densitySize = { low: 70, medium: 58, high: 48 };
  const shareOutput = async (target) => {
    if (!outputUrl) return;
    const url = new URL(outputUrl, window.location.origin).href;
    if (target === "device" && navigator.share) { await navigator.share({ title: "My EasyBrainrot study video", url }); setShareMessage("Share sheet opened."); return; }
    if (target === "copy") { await navigator.clipboard?.writeText(url); setShareMessage("Video link copied."); return; }
    const shareUrls = { tiktok: "https://www.tiktok.com/upload?lang=en", youtube: "https://studio.youtube.com/channel/UC/videos/upload", instagram: "https://www.instagram.com/" };
    window.open(shareUrls[target], "_blank", "noopener,noreferrer"); setShareMessage("Upload page opened — select the downloaded video there.");
  };
  const downloadOutput = async () => {
    if (!outputUrl) return;
    try {
      const response = await apiFetch(outputUrl);
      if (!response.ok) throw new Error("The generated video could not be downloaded.");
      const downloadUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = "easybrainrot-study-video.mp4";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(downloadUrl);
      setShareMessage("Download started.");
    } catch (downloadError) { setShareMessage(downloadError.message || "Download failed."); }
  };
  const handleGenerate = async () => {
    setRendering(true); setGenerated(false); setError(""); setOutputUrl("");
    try {
      const selectedPdf = pdfFile || document.getElementById("pdf-input")?.files?.[0];
      const sourceText = isPdf ? await extractPdfText(selectedPdf) : text.trim();
      if (!sourceText) throw new Error("No readable text was found in this input.");
      const voiceResponse = await apiFetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "edge", model: EDGE_VOICES[voice] || EDGE_VOICES.Ashley, text: sourceText }) });
      const voiceData = await voiceResponse.json();
      if (!voiceResponse.ok) throw new Error(voiceData.error || "Voice generation failed.");
      const backgroundResponse = await fetch(video);
      if (!backgroundResponse.ok) throw new Error("Background video could not be loaded.");
      const renderResponse = await apiFetch("/api/render", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ backgroundBase64: arrayBufferToBase64(await backgroundResponse.arrayBuffer()), audioBase64: voiceData.audioBase64, words: voiceData.words, textStyle: profile.density === "high" ? "3 words" : "1 word", captionStyle: { fontFamily: "Arial", fontSize: densitySize[profile.density], textColor: "#ffffff", strokeColor: "#000000", strokeWidth: 3, highlightColor: "#ffcc00", position: "center", align: "center" }, narrationVolume: volume / 20, watermark: { enabled: !watermark, text: "EasyBrainrot", opacity: 0.72, scale: "medium" } }) });
      const renderData = await renderResponse.json();
      if (!renderResponse.ok) throw new Error(renderData.error || "Video rendering failed.");
      setOutputUrl(assetUrl(renderData.url)); setGenerated(true);
    } catch (generationError) { setError(generationError.message || "Could not create the video."); }
    finally { setRendering(false); }
  };
  return <div className="tool-page">
    <header className="tool-header wrap"><a className="brand" href="/"><img src="/easybrainrot/logo.png" alt="EasyBrainrot"/><span>EasyBrainrot</span></a><nav><a href="/">Home</a><a href="/blog">Blog</a><a href="/slang">Slang</a><a href="/pricing">Pricing</a><button aria-label="Toggle theme" onClick={() => document.body.classList.toggle("theme-dark")}><Moon size={17}/></button><a className="sign-in" href="#generator">Sign In</a></nav></header>
    <div className="tool-breadcrumb wrap"><a href="/">Home</a><span>›</span><span>{label}</span></div>
    <section className="tool-intro"><h1>{title}</h1><p>{description}</p><div className="tool-nav">{[["PDF to Brainrot","/pdf-to-brainrot"],["Text to Brainrot","/text-to-brainrot"],["Minecraft Parkour","/minecraft-parkour-video-generator"],["Subway Surfers","/subway-surfers-video-generator"]].map(([name,href])=><a className={name===label ? "active" : ""} href={href} key={name}>{name}</a>)}</div></section>
    <main className="generator-wrap wrap" id="generator"><section className="generator-panel"><h2>{isText ? "Text to Brainrot Generator" : `${label} Generator`}</h2><div className="mode-label">Select Mode</div><div className="mode-tabs">{["Brainrot Mode","Raw Mode","Quiz Mode"].map(item=><button className={mode===item ? "selected" : ""} onClick={()=>setMode(item)} key={item}>{item}</button>)}</div><p className="mode-hint">{mode === "Quiz Mode" ? "Turns key points into recall prompts." : mode === "Raw Mode" ? "Keeps your source text direct and readable." : "Presents content in a fun, engaging style."}</p>{isText || !isPdf ? <div className="field-block"><label>{isText ? "Enter Your Text" : "Enter Your Script"}</label><textarea value={text} onChange={e=>setText(e.target.value)} placeholder="Paste your notes, study guide, or any text here..." maxLength={2000}/><div className="field-footer"><span>{text.length} / 2000 characters</span><div><button onClick={()=>setText(sample)}>Try Sample Text</button><button disabled={!text} onClick={()=>setText("")}>Clear</button></div></div></div> : <div className={fileName ? "upload-box has-file" : "upload-box"}><input id="pdf-input" type="file" accept="application/pdf" onChange={e=>{const file=e.target.files?.[0] || null; setPdfFile(file); setFileName(file?.name || "");}}/><label htmlFor="pdf-input"><FileText size={28}/><strong>{fileName || "Drag & drop your PDF here"}</strong><span>{fileName ? "PDF selected — ready to customize" : "or click to browse"}</span><small>Max 10 pages or 5MB</small></label></div>}
      <div className="option-section"><label>Background</label><div className="option-tabs"><button className={background==="Minecraft" ? "selected" : ""} onClick={()=>setBackground("Minecraft")}>Minecraft</button><button className={background==="Subway Surfer" ? "selected" : ""} onClick={()=>setBackground("Subway Surfer")}>Subway Surfer</button></div><div className="background-grid">{[1,2,3,4,5,6,7,8].map(n=>{const choice=n%2 ? "Minecraft" : "Subway Surfer"; return <button className={background===choice ? "background-choice selected" : "background-choice"} key={n} onClick={()=>setBackground(choice)}><video src={n%2 ? "/easybrainrot/sample-80.mp4" : "/easybrainrot/sample-82.mp4"} muted autoPlay loop playsInline/><span>{n}</span></button>})}</div></div>
      <div className="option-section"><label>Background Music</label><div className="choice-list">{["No Music","Bladerunner 2049","Else Paris","Fluffing a Duck","Future Bass","Travel","Wii Music"].map(item=><button className={music===item ? "choice selected" : "choice"} onClick={()=>setMusic(item)} key={item}><span>{item}</span><small>{item === "No Music" ? "Silent" : item === "Fluffing a Duck" ? "Playful" : "Preview"}</small></button>)}</div></div>
      <div className="option-section"><label>Voice</label><div className="choice-list voice-list">{["Ashley","Sarah","Deborah","Olivia","Alex","Mark","Craig","Ronald","Hades"].map(item=><button className={voice===item ? "choice selected" : "choice"} onClick={()=>setVoice(item)} key={item}><span>{item}</span><small>{item === "Ashley" ? "Warm, natural voice" : "AI voice"}</small></button>)}</div></div>
      <div className="profile-section"><div><label htmlFor="reading-profile">Reading profile</label><small>Saved on this device and applied to new videos.</small></div><select id="reading-profile" value={profile.name} onChange={e=>setProfile({ name: e.target.value, ...profiles[e.target.value] })}>{Object.keys(profiles).map(name=><option key={name}>{name}</option>)}</select><span className="profile-summary">{profile.speed}x · {profile.density} captions · {profile.stimulation} stimulation</span></div>
      <button className="advanced-toggle" onClick={()=>setAdvanced(!advanced)}><span>Advanced Settings</span><span>Speed: {speed}x, Volume: {volume}% <ChevronDown size={16} className={advanced ? "rotate" : ""}/></span></button>{advanced && <div className="advanced-panel"><label>Speed <input type="range" min="0.7" max="1.2" step="0.1" value={speed} onChange={e=>{const next=Number(e.target.value); setSpeed(next); setProfile({...profile, name: "Custom", speed: next});}}/></label><label>Volume <input type="range" min="0" max="100" value={volume} onChange={e=>setVolume(Number(e.target.value))}/></label></div>}
      <label className="watermark-toggle"><input type="checkbox" checked={watermark} onChange={e=>setWatermark(e.target.checked)}/><span>Remove Watermark</span><small>EasyBrainrot.com will appear on your video unless removed.</small></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="generate-button" disabled={!hasInput || rendering} onClick={handleGenerate}>{rendering ? "Rendering video…" : generated ? "Render again" : "Generate Brainrot Video"}<ArrowRight size={17}/></button>
    </section><aside className="preview-panel"><h2>Preview Output</h2><div className="preview-video"><video ref={previewRef} src={outputUrl || video} muted autoPlay loop playsInline/><span>{outputUrl ? "Generated Output" : "Example Output"}</span>{generated && <div className="generated-badge">Generated video ready</div>}</div><p>Preview how your {mode.toLowerCase()} video will look.</p>{outputUrl && <><button className="primary download-button" onClick={downloadOutput}>Download video</button><div className="share-panel"><strong>Share your study video</strong><div className="share-actions"><button onClick={()=>shareOutput("device")}><Share2 size={15}/> Share</button><button onClick={()=>shareOutput("copy")}><Copy size={15}/> Copy link</button><button onClick={()=>shareOutput("tiktok")}><ExternalLink size={15}/> TikTok</button><button onClick={()=>shareOutput("youtube")}><ExternalLink size={15}/> YouTube</button><button onClick={()=>shareOutput("instagram")}><ExternalLink size={15}/> Instagram</button></div>{shareMessage && <small role="status">{shareMessage}</small>}</div></>}</aside></main>
    <section className="tool-info wrap"><div><span className="eyebrow">Why {label}?</span><h2>{isText ? "Turn any text into viral study content." : "Make study content people actually want to watch."}</h2><p>{description} Choose a background, voice, music, and pacing that fits the way you learn.</p></div><div className="info-grid">{[[Sparkles,"AI-Powered Creation","Automatically turns your source material into a short video script."],[Video,"Viral Backgrounds","Minecraft parkour, Subway Surfers, and more vertical gameplay clips."],[Gift,"Free to Use","Start with unlimited watermark exports and no account required."],[GraduationCap,"Study-Optimized","Perfect for lecture notes, textbooks, flashcards, and study guides."]].map(([Icon,title,copy])=><article key={title}><span className="icon-box"><Icon size={18}/></span><h3>{title}</h3><p>{copy}</p></article>)}</div></section>
    <section className="tool-steps"><div className="wrap"><div className="center-heading"><span className="eyebrow">From notes to scroll-stopping</span><h2>How It Works</h2></div><div className="tool-step-grid">{["Upload your source","Choose your background","Select voice and music","Download and share"].map((item,i)=><article key={item}><span>0{i+1}</span><h3>{item}</h3><p>{["Drag and drop or paste your study notes","Pick Minecraft, Subway Surfers, or other gameplay clips","Customize AI voice, music, speed, and volume","Get your video in 60 seconds and share on TikTok"][i]}</p></article>)}</div></div></section>
    <section className="cta"><div className="wrap cta-inner"><div><span className="eyebrow">Ready when you are</span><h2>Ready to Create Your First Brainrot Video?</h2><p>Join 2,938+ students who are studying smarter with viral brainrot content.</p></div><a className="primary" href={isText ? "/pdf-to-brainrot" : "/text-to-brainrot"}>Try Another Tool <ArrowRight size={16}/></a></div></section>
  </div>;
}

function Benefit({Icon,title,children}) { return <div className="benefit"><span className="icon-box"><Icon size={18}/></span><div><h3>{title}</h3><p>{children}</p></div></div> }
function Step({num,icon,title,children}) { return <article className="step"><span className="step-num">{num}</span><span className="step-icon">{icon}</span><h3>{title}</h3><p>{children}</p><ArrowRight className="step-arrow" size={20}/></article> }
function Feature({Icon,title,children}) { return <article className="feature"><span className="feature-icon"><Icon size={20}/></span><h3>{title}</h3><p>{children}</p></article> }
createRoot(document.getElementById("root")).render(<App />);
