/**
 * Configuration for Pixazo's FREE tier models, organized by studio tab.
 *
 * Docs: https://www.pixazo.ai/api/free and individual model pages under
 * https://www.pixazo.ai/models/<model>
 *
 * Response shapes:
 *   1. SYNC models: the POST call itself returns the finished result
 *      immediately — no polling needed.
 *        - Flux Schnell / SDXL / SDXL Lightning / SD Inpainting -> image url
 *        - PixelForge V2 (search)   -> { results: [...] }
 *        - VoxCPM2 (text-to-speech) -> { output: "...wav" }
 *        - VoxCPM2 (voice cloning)  -> { url / audio_url: "...wav" }
 *   2. ASYNC models (queue-based): POST returns
 *      { request_id, status: "QUEUED", polling_url }, poll
 *      GET /v2/requests/status/{request_id} until COMPLETED.
 *      Pixelforge Relighting uses a custom polling endpoint instead.
 *
 * Each model declares:
 *   - category   -> which studio tab it appears under
 *   - type       -> media kind, used to render the result (image/video/audio/image-search)
 *   - fields     -> the configurable parameters shown in the UI. Every field
 *                   has a `type` (text | textarea | url | number | select | checkbox)
 *                   plus, where relevant, default/min/max/step/options — sourced
 *                   from the model's documented request parameters (or, where a
 *                   free endpoint isn't separately documented, from the values
 *                   this app already sends so nothing is invented). `url` fields
 *                   that expect user-supplied media may also carry
 *                   `upload: "image" | "audio" | "video"`, which the frontend
 *                   uses to show a PC file-picker next to the URL box — picking
 *                   a file POSTs it to /api/upload, which hosts it (imgbb for
 *                   images, catbox.moe for audio/video — see server.js) and
 *                   fills the URL box with the resulting public link. Manually
 *                   pasting a URL still works and needs no server config.
 *
 * IMPORTANT — only confirmed FREE models are listed. Newer paid models
 * (FLUX 3 Video, LTX 2.5 Pro, Stable Diffusion 3.5) are intentionally
 * excluded from this catalog; tabs with no free model yet simply show an
 * empty state in the UI (none currently — every tab has a free model).
 */

const GATEWAY_BASE = "https://gateway.pixazo.ai";

// ---- Studio tabs -----------------------------------------------------
const CATEGORIES = [
  { id: "text-to-image", label: "Text to Image", icon: "🖼️" },
  { id: "image-edit", label: "Image Edit", icon: "🩹" },
  { id: "text-to-video", label: "Text to Video", icon: "🎬" },
  { id: "video-to-video", label: "Video to Video", icon: "🔁" },
  { id: "image-to-video", label: "Image to Video", icon: "🎞️" },
  { id: "voice-clone", label: "Voice Clone", icon: "🗣️" },
  { id: "voice-generation", label: "Voice Generation", icon: "🔊" },
  { id: "music", label: "Tracks (Music)", icon: "🎵" },
];

const MODELS = {
  // ======================= TEXT TO IMAGE =======================

  "flux-schnell": {
    label: "Flux Schnell",
    category: "text-to-image",
    type: "image",
    description: "Ultra-fast image generation (12B param model). Confirmed free & synchronous.",
    method: "POST",
    path: "/flux-1-schnell/v1/getData",
    responseMode: "sync",
    outputField: "output",
    fields: [
      { name: "prompt", type: "textarea", required: true, placeholder: "a serene mountain lake at golden hour" },
      { name: "width", type: "number", default: 1024, min: 256, max: 1536, step: 64 },
      { name: "height", type: "number", default: 1024, min: 256, max: 1536, step: 64 },
      { name: "num_steps", type: "number", default: 4, min: 1, max: 8, step: 1, hint: "Flux Schnell is distilled — 4 steps is usually enough." },
    ],
    buildBody: ({ prompt, width, height, num_steps }) => ({
      prompt,
      width: Number(width),
      height: Number(height),
      num_steps: Number(num_steps),
    }),
  },

  "sdxl": {
    label: "Stable Diffusion XL (Free)",
    category: "text-to-image",
    type: "image",
    description: "High-resolution SDXL base 1.0 — free during preview.",
    method: "POST",
    path: "/getImage/v1/getSDXLImage",
    responseMode: "sync",
    outputField: "imageUrl",
    fields: [
      { name: "prompt", type: "textarea", required: true, placeholder: "a futuristic city skyline at sunset, ultra detailed" },
      { name: "width", type: "number", default: 1024, min: 512, max: 1536, step: 64 },
      { name: "height", type: "number", default: 1024, min: 512, max: 1536, step: 64 },
      { name: "num_steps", type: "number", default: 20, min: 1, max: 50, step: 1 },
      { name: "guidance_scale", type: "number", default: 7.5, min: 1, max: 20, step: 0.5 },
    ],
    buildBody: ({ prompt, width, height, num_steps, guidance_scale }) => ({
      prompt,
      width: Number(width),
      height: Number(height),
      num_steps: Number(num_steps),
      guidance_scale: Number(guidance_scale),
    }),
  },

  "sdxl-lightning": {
    label: "SDXL Lightning",
    category: "text-to-image",
    type: "image",
    description: "Distilled few-step SDXL variant — fast, free.",
    method: "POST",
    path: "/sdxl_lightning/getImage/v1/getSDXLImage",
    responseMode: "sync",
    outputField: "imageUrl",
    fields: [
      { name: "prompt", type: "textarea", required: true, placeholder: "cyberpunk street market at night, neon signs" },
      { name: "width", type: "number", default: 1024, min: 512, max: 1536, step: 64 },
      { name: "height", type: "number", default: 1024, min: 512, max: 1536, step: 64 },
      { name: "num_steps", type: "number", default: 8, min: 1, max: 8, step: 1 },
      { name: "guidance", type: "number", default: 5, min: 0, max: 10, step: 0.5 },
    ],
    buildBody: ({ prompt, width, height, num_steps, guidance }) => ({
      prompt,
      width: Number(width),
      height: Number(height),
      num_steps: Number(num_steps),
      guidance: Number(guidance),
    }),
  },

  "pixelforge-v2-search": {
    label: "PixelForge V2 (Library Search)",
    category: "text-to-image",
    type: "image-search",
    description:
      "Not a generator — searches Pixazo's existing image library by tag/caption. Free, synchronous, up to 100 results.",
    method: "POST",
    path: "/pixelforge-image-v2/v1/text-to-image",
    responseMode: "sync",
    outputField: "results",
    fields: [
      { name: "text", type: "text", required: true, placeholder: "red dress", hint: "Search query — matches the image library." },
      {
        name: "type",
        type: "select",
        default: "tags,caption",
        options: ["tags,caption", "tags", "caption"],
        hint: "Which fields to match against.",
      },
      { name: "seed", type: "number", placeholder: "random", hint: "Deterministic shuffle seed — same seed, same order." },
      { name: "size", type: "number", default: 10, min: 1, max: 100, step: 1, hint: "Number of results (max 100)." },
    ],
    buildBody: ({ text, type, seed, size }) => {
      const body = { text, type, size: Number(size) };
      if (seed !== undefined && seed !== null && seed !== "") body.seed = Number(seed);
      return body;
    },
  },

  // ======================= IMAGE EDIT =======================

  "sd-inpainting": {
    label: "Stable Diffusion Inpainting",
    category: "image-edit",
    type: "image",
    description: "Repaint part of an existing image using a prompt + mask. Free.",
    method: "POST",
    path: "/inpainting/v1/getImage",
    responseMode: "sync",
    outputField: "imageUrl",
    fields: [
      { name: "prompt", type: "textarea", required: true, placeholder: "change to a lion" },
      { name: "imageUrl", type: "url", required: true, upload: "image", placeholder: "https://example.com/source.png (public URL, <1MB)" },
      { name: "maskUrl", type: "url", required: true, upload: "image", placeholder: "https://example.com/mask.png (white = area to repaint)" },
      { name: "num_steps", type: "number", default: 20, min: 1, max: 50, step: 1 },
      { name: "guidance", type: "number", default: 7.5, min: 1, max: 20, step: 0.5 },
    ],
    buildBody: ({ prompt, imageUrl, maskUrl, num_steps, guidance }) => ({
      prompt,
      imageUrl,
      maskUrl,
      num_steps: Number(num_steps),
      guidance: Number(guidance),
    }),
  },

  "pixelforge-relight": {
    label: "PixelForge Relighting",
    category: "image-edit",
    type: "image",
    description: "Relight an existing photo (studio / daylight / cinematic). Free, async with a custom polling endpoint.",
    method: "POST",
    path: "/pixelforge-relighting-api/v1/relighting/generate",
    responseMode: "async",
    statusMode: "pixelforge",
    statusPath: "/pixelforge-relighting-api/v1/relighting/prediction",
    fields: [
      { name: "prompt", type: "textarea", required: true, placeholder: "professional studio lighting with soft shadows" },
      { name: "imageUrl", type: "url", required: true, upload: "image", placeholder: "https://example.com/photo.jpg (public URL)" },
      { name: "num_images", type: "number", default: 1, min: 1, max: 4, step: 1 },
      { name: "output_format", type: "select", default: "png", options: ["png", "jpg", "webp"] },
    ],
    buildBody: ({ prompt, imageUrl, num_images, output_format }) => ({
      prompt,
      image_urls: [imageUrl],
      num_images: Number(num_images),
      output_format,
    }),
  },

  // ======================= TEXT TO VIDEO =======================
  // LTX 2.3 — Pixazo's confirmed FREE video tier (variant id "ltx-v2-3-free"
  // on https://www.pixazo.ai/models/ltx, tagged "free"). It supports Text to
  // Video, Image to Video, and Video to Video, all under the /ltx-video/v1/
  // base path. Text-to-video's exact params are confirmed from the docs;
  // image-to-video and video-to-video share the same model family and
  // request shape, with the addition of the relevant media URL.

  "ltx": {
    label: "LTX 2.3 (Free)",
    category: "text-to-video",
    type: "video",
    description: "Text-to-video by Lightricks — Pixazo's free video tier. Async job.",
    method: "POST",
    path: "/ltx-video/v1/text-to-video",
    responseMode: "async",
    statusMode: "v2",
    fields: [
      { name: "prompt", type: "textarea", required: true, placeholder: "drone shot over a foggy forest at dawn" },
      { name: "aspect", type: "select", default: "auto", options: ["auto", "16:9", "9:16", "1:1", "4:3", "3:4", "21:9"], hint: "Overrides width/height." },
      { name: "num_frames", type: "number", default: 121, min: 9, max: 241, step: 8, hint: "8k+1 form, e.g. 121, 161, 241." },
      { name: "frame_rate", type: "number", default: 24, min: 1, max: 60, step: 1 },
      { name: "enhance_prompt", type: "select", default: "false", options: ["false", "true"], hint: "Auto-enrich the prompt before generation." },
    ],
    buildBody: ({ prompt, aspect, num_frames, frame_rate, enhance_prompt }) => ({
      prompt,
      aspect,
      num_frames: Number(num_frames),
      frame_rate: Number(frame_rate),
      enhance_prompt: enhance_prompt === "true",
    }),
  },

  // ==================== IMAGE TO VIDEO ====================

  "ltx-image-to-video": {
    label: "LTX 2.3 (Free)",
    category: "image-to-video",
    type: "video",
    description: "Animate a still image with Lightricks LTX 2.3 — Pixazo's free video tier. Async job.",
    method: "POST",
    path: "/ltx-video/v1/image-to-video",
    responseMode: "async",
    statusMode: "v2",
    fields: [
      { name: "prompt", type: "textarea", required: true, placeholder: "the camera slowly pushes in as the scene comes alive" },
      { name: "imageUrl", type: "url", required: true, upload: "image", placeholder: "https://example.com/source.jpg (public URL)" },
      { name: "aspect", type: "select", default: "auto", options: ["auto", "16:9", "9:16", "1:1", "4:3", "3:4", "21:9"] },
      { name: "num_frames", type: "number", default: 121, min: 9, max: 241, step: 8 },
      { name: "frame_rate", type: "number", default: 24, min: 1, max: 60, step: 1 },
    ],
    buildBody: ({ prompt, imageUrl, aspect, num_frames, frame_rate }) => ({
      prompt,
      image_url: imageUrl,
      aspect,
      num_frames: Number(num_frames),
      frame_rate: Number(frame_rate),
    }),
  },

  // ==================== VIDEO TO VIDEO ====================

  "ltx-video-to-video": {
    label: "LTX 2.3 (Free)",
    category: "video-to-video",
    type: "video",
    description:
      "Restyle or re-render an existing clip with Lightricks LTX 2.3 — Pixazo's free video tier. Async job. This operation's full parameter list wasn't fully documented at fetch time; prompt and source video are confirmed required.",
    method: "POST",
    path: "/ltx-video/v1/video-to-video",
    responseMode: "async",
    statusMode: "v2",
    fields: [
      { name: "prompt", type: "textarea", required: true, placeholder: "restyle as a moody anime sequence, vivid color grading" },
      { name: "videoUrl", type: "url", required: true, upload: "video", placeholder: "https://example.com/source.mp4 (public URL)" },
    ],
    buildBody: ({ prompt, videoUrl }) => ({
      prompt,
      video_url: videoUrl,
    }),
  },

  // ======================= VOICE CLONE =======================
  // Openbmb VoxCPM2 — confirmed free voice-cloning endpoint, documented at
  // https://www.pixazo.ai/models/voxcpm#doc-openbmb-voxcpm2-voice-cloning-code

  "voxcpm2-voice-cloning": {
    label: "Openbmb VoxCPM2 (Voice Cloning)",
    category: "voice-clone",
    type: "audio",
    description:
      "Clone a voice from a short reference clip and speak new text in that voice. Free, synchronous.",
    method: "POST",
    path: "/voxcpm/v1/voice-cloning",
    responseMode: "sync",
    outputField: "url",
    fields: [
      { name: "text", type: "textarea", required: true, placeholder: "Hello, this is a test." },
      {
        name: "reference_audio_url",
        type: "url",
        required: true,
        upload: "audio",
        placeholder: "https://your-audio-file.wav",
        hint: "Publicly reachable MP3/WAV of a single speaker — a few clear seconds is enough.",
      },
      {
        name: "prompt_text",
        type: "text",
        placeholder: "transcript of reference audio (optional)",
        hint: "Exact transcript of the reference audio. Improves fidelity via continuation-style cloning; omit for isolated voice cloning.",
      },
    ],
    buildBody: ({ text, reference_audio_url, prompt_text }) => {
      const body = { text, reference_audio_url };
      if (prompt_text !== undefined && prompt_text !== null && prompt_text !== "") {
        body.prompt_text = prompt_text;
      }
      return body;
    },
  },

  // ==================== VOICE GENERATION ====================

  "voxcpm2": {
    label: "Openbmb VoxCPM2 (Text to Speech)",
    category: "voice-generation",
    type: "audio",
    description:
      "Text-to-speech with optional voice-style instructions, e.g. '(calm, whispering) Hello there'. Free, synchronous.",
    method: "POST",
    path: "/voxcpm/v1/text-to-speech",
    responseMode: "sync",
    outputField: "output",
    fields: [
      { name: "text", type: "textarea", required: true, placeholder: "(calm, warm) Hello, from Pixazo." },
      {
        name: "cfg_value",
        type: "number",
        default: 2.0,
        min: 1.0,
        max: 3.0,
        step: 0.1,
        hint: "Guidance scale — how strictly speech follows the text/voice conditioning.",
      },
      {
        name: "dit_steps",
        type: "number",
        default: 10,
        min: 4,
        max: 30,
        step: 1,
        hint: "Diffusion steps — more improves detail/stability, costs speed.",
      },
    ],
    buildBody: ({ text, cfg_value, dit_steps }) => ({
      text,
      cfg_value: Number(cfg_value),
      dit_steps: Number(dit_steps),
    }),
  },

  // ======================= TRACKS (MUSIC) =======================

  "tracks-music": {
    label: "Pixazo Tracks (Music)",
    category: "music",
    type: "audio",
    description: "Text-to-music: generate an instrumental track from a prompt. Async job.",
    method: "POST",
    path: "/tracks/generate-music",
    responseMode: "async",
    statusMode: "v2",
    fields: [
      { name: "prompt", type: "textarea", required: true, placeholder: "lo-fi hip hop beat, chill, no vocals" },
    ],
    buildBody: ({ prompt }) => ({ prompt }),
  },
};

module.exports = { MODELS, GATEWAY_BASE, CATEGORIES };
