require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const path = require("path");
const multer = require("multer");
const FormData = require("form-data");
const { MODELS, GATEWAY_BASE, CATEGORIES } = require("./models");

const app = express();
const PORT = process.env.PORT || 3000;
const PIXAZO_API_KEY = process.env.PIXAZO_API_KEY;
const IMGBB_API_KEY = process.env.IMGBB_API_KEY;

// In-memory upload buffer, capped at 40MB — enough for a reference image/audio
// clip or a short source video while staying safe on small free-tier hosts.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 40 * 1024 * 1024 } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function pixazoHeaders() {
  return {
    "Content-Type": "application/json",
    "Cache-Control": "no-cache",
    "Ocp-Apim-Subscription-Key": PIXAZO_API_KEY,
  };
}

// Fill in any missing optional fields with their documented default,
// so buildBody() can always assume a value is present.
function normalizeParams(model, params) {
  const out = { ...(params || {}) };
  for (const field of model.fields) {
    const val = out[field.name];
    const isEmpty = val === undefined || val === null || val === "";
    if (isEmpty && field.default !== undefined) {
      out[field.name] = field.default;
    }
  }
  return out;
}

// Expose the studio tabs + free model catalog to the frontend (no secrets in here)
app.get("/api/categories", (req, res) => {
  res.json(CATEGORIES);
});

app.get("/api/models", (req, res) => {
  const catalog = Object.entries(MODELS).map(([id, m]) => ({
    id,
    label: m.label,
    category: m.category,
    type: m.type,
    description: m.description,
    fields: m.fields,
  }));
  res.json(catalog);
});

// Host a locally-picked file so it has a public URL Pixazo's API can fetch.
//   - images        -> imgbb (https://api.imgbb.com) — free, needs IMGBB_API_KEY
//   - audio & video -> catbox.moe — free, anonymous, no key/signup required,
//                      permanent hosting up to 200MB per file
// (api.video was evaluated for video hosting but its free sandbox tier
// watermarks clips, caps them at 30s, and auto-deletes after 24h — a poor
// fit for feeding a reference clip straight into another API — so catbox.moe
// is used instead. No account needed on either the app or the user's side.)
app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file", message: "No file was uploaded." });
    }
    const kind = (req.body.kind || req.query.kind || "image").toLowerCase();

    if (kind === "image") {
      if (!IMGBB_API_KEY) {
        return res.status(500).json({
          error: "Missing IMGBB_API_KEY",
          message:
            "Set IMGBB_API_KEY as an environment variable to enable image uploads. Get a free key (no card) at https://api.imgbb.com/. You can still paste a public image URL directly.",
        });
      }
      const form = new FormData();
      form.append("image", req.file.buffer, { filename: req.file.originalname || "upload.png" });
      const response = await axios.post(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, form, {
        headers: form.getHeaders(),
        timeout: 60000,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });
      const url = response.data?.data?.url;
      if (!url) throw new Error("imgbb did not return a URL.");
      return res.json({ url, host: "imgbb" });
    }

    if (kind === "audio" || kind === "video") {
      const form = new FormData();
      form.append("reqtype", "fileupload");
      form.append("fileToUpload", req.file.buffer, {
        filename: req.file.originalname || `upload-${Date.now()}`,
      });
      const response = await axios.post("https://catbox.moe/user/api.php", form, {
        headers: form.getHeaders(),
        timeout: 120000,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });
      const url = String(response.data || "").trim();
      if (!url.startsWith("http")) {
        throw new Error(`Catbox upload failed: ${url || "empty response"}`);
      }
      return res.json({ url, host: "catbox" });
    }

    return res.status(400).json({ error: "Unknown kind", message: `Unsupported upload kind: ${kind}` });
  } catch (err) {
    const status = err.response?.status || 500;
    const data = err.response?.data || { message: err.message };
    res.status(status).json({ error: "Upload failed", details: data });
  }
});


// into one shape the frontend understands:
//   { completed: true,  mediaUrl }                — sync models
//   { completed: true,  results: [...] }           — search-style models (pixelforge v2)
//   { completed: false, requestId, modelId }        — async models (frontend should poll)
app.post("/api/generate", async (req, res) => {
  try {
    if (!PIXAZO_API_KEY) {
      return res.status(500).json({
        error: "Missing PIXAZO_API_KEY",
        message: "Set PIXAZO_API_KEY as an environment variable (see .env.example).",
      });
    }

    const { modelId, params } = req.body;
    const model = MODELS[modelId];
    if (!model) {
      return res.status(400).json({ error: "Unknown model", message: `No such model: ${modelId}` });
    }

    for (const field of model.fields) {
      if (field.required && !params?.[field.name]) {
        return res.status(400).json({ error: "Missing field", message: `Field "${field.name}" is required.` });
      }
    }

    const normalized = normalizeParams(model, params);
    const body = model.buildBody(normalized);
    const url = `${GATEWAY_BASE}${model.path}`;

    const response = await axios.post(url, body, {
      headers: pixazoHeaders(),
      timeout: 60000,
    });

    const data = response.data;

    if (model.responseMode === "sync") {
      // For "image-search" style models, outputField is an array of results.
      if (model.type === "image-search") {
        return res.json({ completed: true, results: data[model.outputField] || [] });
      }
      const mediaUrl = data[model.outputField] || data.output || data.imageUrl;
      return res.json({ completed: true, mediaUrl });
    }

    // Async: response looks like { request_id, status, polling_url }
    return res.json({
      completed: false,
      requestId: data.request_id,
      modelId,
    });
  } catch (err) {
    const status = err.response?.status || 500;
    const data = err.response?.data || { message: err.message };
    res.status(status).json({ error: "Pixazo request failed", details: data });
  }
});

// Poll a job's status. Handles both the standard v2 status endpoint and
// Pixelforge's custom "prediction" polling endpoint.
app.get("/api/status/:modelId/:requestId", async (req, res) => {
  try {
    if (!PIXAZO_API_KEY) {
      return res.status(500).json({ error: "Missing PIXAZO_API_KEY" });
    }
    const { modelId, requestId } = req.params;
    const model = MODELS[modelId];
    if (!model) {
      return res.status(400).json({ error: "Unknown model", message: `No such model: ${modelId}` });
    }

    let data;

    if (model.statusMode === "pixelforge") {
      // Custom: POST .../relighting/prediction with { prediction_id }
      const url = `${GATEWAY_BASE}${model.statusPath}`;
      const response = await axios.post(
        url,
        { prediction_id: requestId },
        { headers: pixazoHeaders(), timeout: 30000 }
      );
      data = response.data;
      // Normalize Pixelforge's shape to look like the standard one.
      return res.json({
        status: data.status?.toUpperCase() === "SUCCEEDED" ? "COMPLETED" : (data.status || "PROCESSING").toUpperCase(),
        output: { media_url: data.output ? [].concat(data.output) : [] },
        error: data.error || null,
      });
    }

    // Standard: GET /v2/requests/status/{request_id}
    const url = `${GATEWAY_BASE}/v2/requests/status/${requestId}`;
    const response = await axios.get(url, {
      headers: pixazoHeaders(),
      timeout: 30000,
    });
    data = response.data;
    res.json(data);
  } catch (err) {
    const status = err.response?.status || 500;
    const data = err.response?.data || { message: err.message };
    res.status(status).json({ error: "Pixazo status check failed", details: data });
  }
});

app.get("/healthz", (req, res) => res.status(200).send("ok"));

// Multer errors (e.g. file too large) land here instead of the generic 500 handler.
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: "Upload error", message: err.message });
  }
  next(err);
});

app.listen(PORT, () => {
  console.log(`Pixazo Free Studio running on port ${PORT}`);
  if (!PIXAZO_API_KEY) {
    console.warn("⚠️  PIXAZO_API_KEY is not set. Requests to Pixazo will fail until you set it.");
  }
  if (!IMGBB_API_KEY) {
    console.warn("⚠️  IMGBB_API_KEY is not set. Image file-picker uploads will fail until you set it (audio/video uploads via catbox.moe work without it).");
  }
});
