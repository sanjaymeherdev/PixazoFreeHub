# Pixazo Free Studio

A tiny full-stack app (Node/Express backend + vanilla JS frontend) that lets you
generate images, video, audio, and speech using **only Pixazo's free-tier
models** — no credit card required. Deployable to [Render](https://render.com)
in a few minutes.

## Studio tabs

The UI is organized into one tab per capability. Each tab has its own model
dropdown (free models only) and each model exposes its own configurable
parameters — no more one-size-fits-all "prompt box":

| Tab | Free models available |
|---|---|
| 🖼️ Text to Image | Flux Schnell, Stable Diffusion XL (Free), SDXL Lightning, PixelForge V2 (library search) |
| 🩹 Image Edit | Stable Diffusion Inpainting, PixelForge Relighting |
| 🎬 Text to Video | LTX 2.3 (Free) |
| 🔁 Video to Video | LTX 2.3 (Free) |
| 🎞️ Image to Video | LTX 2.3 (Free) |
| 🗣️ Voice Clone | Openbmb VoxCPM2 (voice cloning — speak new text in a cloned voice from a reference clip) |
| 🔊 Voice Generation | Openbmb VoxCPM2 (text to speech, supports voice-style tags like `(calm, whispering)`) |
| 🎵 Tracks (Music) | Pixazo Tracks — text-to-music |

**LTX 2.3 (Free)** is Pixazo's confirmed free video tier (Lightricks), and
it's the one model here that spans three tabs — it supports text-to-video,
image-to-video, and video-to-video, all under the `/ltx-video/v1/` base
path. Its text-to-video parameters are directly confirmed from Pixazo's
docs; image-to-video and video-to-video use the same model-family request
shape plus the relevant media URL — double check the video-to-video
parameter list against Pixazo's dashboard docs before relying on anything
beyond `prompt` and `video_url`, since that operation's full parameter
table wasn't retrievable at the time this was written.

Tabs with no free model simply say so rather than listing a paid model —
newer paid releases (FLUX 3 Video, LTX 2.5 Pro/Lite, LTX 2.3 Quality,
Stable Diffusion 3.5) are intentionally left out of this catalog. Swap a
tab's placeholder for a real model the moment Pixazo ships a free one, by
adding an entry to `models.js` with a matching `category` (see "Adding
more free models later" below).

## Per-model configurable parameters

Every model's fields now come from `models.js`, each typed as `text`,
`textarea`, `url`, `number` (with `min`/`max`/`step`), or `select` (with
`options`). Numeric/select fields ship with the same defaults the app already
sends to Pixazo — nothing invented — so tweaking them (e.g. Flux Schnell's
`width`/`height`/`num_steps`, VoxCPM2's `cfg_value`/`dit_steps`, PixelForge
V2's `type`/`seed`/`size`) is safe and reversible via the "default" value.

Free tier fair-use limit: **60 requests/minute per model**. No payment info needed.

> Pixazo actually mixes two response styles under the hood: some free models
> return the finished result **immediately** in the POST response (Flux
> Schnell, the SDXL family, VoxCPM2, PixelForge V2), while others queue the
> job and make you **poll** for the result (LTX, Tracks, Pixelforge
> Relighting — which even uses a different polling endpoint than the rest).
> `server.js` normalizes all of this into one consistent shape for the
> frontend, so you don't have to think about it per-model.

## How it works

1. Frontend lets you pick a free model and fill in its fields (just a prompt
   for most; an image/mask/audio/video URL for the ones that need source
   media — see "Uploading files from your PC" below).
2. Backend (`server.js`) submits the job to Pixazo using your `PIXAZO_API_KEY`.
3. If the model responds immediately, the frontend shows the result right away.
   If it's an async job, the frontend polls `/api/status/:modelId/:requestId`
   every 3s until it's done.

Your API key **never reaches the browser** — it stays on the server.

## Uploading files from your PC

Pixazo's API needs a *publicly reachable URL* for source media (reference
images, masks, audio, video) — it can't accept a raw file upload directly.
Every field that expects one has a **📁 Upload from PC** button next to
the URL box, so you don't have to host the file yourself first.

Uploads are **self-hosted on this server and deleted right after use** — no
third-party image/file host, no extra API key to configure:

- Picking a file POSTs it to `/api/upload` (multipart, capped at 40MB per
  request). It's saved to a local `uploads/` folder and served back at
  `/uploads/<name>`, which fills the URL box for you.
- The same code path handles images, audio, and video — there's no
  per-type branching or separate host to configure.
- Once Pixazo has actually used the file, it's deleted automatically:
  - Models that respond immediately (sync) — the file is deleted right
    after that response comes back.
  - Models that queue a job (async — video, tracks, etc.) — the file is
    deleted once `/api/status` reports the job finished, successfully or
    not.
  - As a safety net, anything left in `uploads/` for more than 30 minutes
    (an abandoned flow, a job that never resolves) is swept away by a
    periodic background check.

Because a file only needs to stay reachable for as long as Pixazo takes to
fetch it, this needs no persistent storage — fine for Railway, Render, or
any host with an ephemeral filesystem. If your app sits behind a proxy that
rewrites the public hostname, set `PUBLIC_BASE_URL` (e.g.
`https://your-app.up.railway.app`) as an env var so the returned upload URL
is correct; otherwise it's inferred from the incoming request.

You can still ignore the button entirely and paste a public URL by hand —
nothing requires the upload flow.

## 1. Get a free Pixazo API key

1. Sign up at https://api-console.pixazo.ai/signup (email only, no card).
2. Go to the API Key section of the dashboard and copy your key.

## 2. Run locally

```bash
git clone <this-repo>
cd pixazo-free-studio
cp .env.example .env
# edit .env and paste your PIXAZO_API_KEY

npm install
npm start
```

Visit http://localhost:3000

## 3. Deploy to Render

### Manual Web Service (works on the free plan, no payment method needed)

1. Push this folder to a GitHub repo.
2. In Render: **New +** → **Web Service** → connect your repo.
3. Settings:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
4. Under **Environment**, add:
   - `PIXAZO_API_KEY` = your key
5. Click **Create Web Service**.

Render's free plan works fine for this app (it may spin down when idle and take
~30s to wake up on the next request — normal for free-tier hosting).

### Optional — Blueprint (render.yaml)

This repo also includes `render.yaml`, which lets Render auto-configure the
service (**New +** → **Blueprint**) instead of filling in the settings by
hand. Note: Render currently requires a verified payment method on file to
use Blueprints at all, even though the service it creates can still run on
the free instance type. If you don't want to add a card, just use the manual
Web Service steps above — same result, no payment method required.

## Adding more free models later

Everything lives in one place: `models.js`. Each entry needs:

- `category` — which studio tab it shows up under. Must match one of the
  ids in the `CATEGORIES` list at the top of `models.js` (e.g.
  `"text-to-image"`, `"image-to-video"`, `"voice-clone"`, `"music"`, ...)
- `path` — the endpoint after `gateway.pixazo.ai`
- `responseMode` — `"sync"` (result comes back immediately) or `"async"`
  (you get a `request_id` and must poll)
- for sync models: `outputField` — which key in the response holds the
  media URL (or array of results, for search-style models)
- for async models: `statusMode` — `"v2"` for the standard
  `GET /v2/requests/status/{id}` endpoint, or a custom mode like Pixelforge's
  if the model uses something different
- `fields` — the form fields to show, each with a `type`
  (`text` | `textarea` | `url` | `number` | `select`) and, where relevant,
  `default` / `min` / `max` / `step` / `options` / `hint`. `buildBody()` then
  maps the collected field values to the request payload Pixazo expects.

Nothing else in the app needs to change — the frontend and backend both read
from this one config, including which tabs get a populated dropdown vs. the
"no free model yet" empty state.

## Project structure

```
pixazo-free-studio/
├── server.js         # Express server + Pixazo API proxy (normalizes sync/async)
├── models.js         # Single source of truth for all free models
├── package.json
├── render.yaml         # Render deployment blueprint
├── .env.example
└── public/
    ├── index.html
    ├── style.css
    └── app.js
```
