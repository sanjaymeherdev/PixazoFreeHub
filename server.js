require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");
const { MODELS, GATEWAY_BASE, CATEGORIES } = require("./models");

const app = express();
app.set("trust proxy", true);
const PORT = process.env.PORT || 3000;
const PIXAZO_API_KEY = process.env.PIXAZO_API_KEY;

// In-memory upload buffer, capped at 40MB — enough for a reference image/audio
// clip or a short source video while staying safe on small free-tier hosts.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 40 * 1024 * 1024 } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ---------------------------------------------------------------------------
// Self-hosted, delete-after-use file storage
//
// Uploaded reference media (images, audio, video) used to be pushed out to
// imgbb/catbox to get a public URL. That's gone now — instead the file is
// written to a local `uploads/` folder and served at /uploads/<name>, which
// Pixazo can fetch just like any other public URL. Once Pixazo has consumed
// it, the file is deleted:
//   - sync models:  deleted right after the /api/generate call returns
//   - async models: deleted once /api/status reports a terminal state
//   - safety net:   a periodic sweep deletes anything left over past
//                    UPLOAD_MAX_AGE_MS (e.g. an abandoned or failed flow)
// ---------------------------------------------------------------------------
const UPLOADS_DIR = path.join(__dirname, "uploads");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
app.use("/uploads", express.static(UPLOADS_DIR));

const UPLOAD_MAX_AGE_MS = 30 * 60 * 1000; // safety-net sweep: 30 minutes
// requestId -> array of filenames to delete once that async job finishes
const pendingAsyncCleanup = new Map();

function getBaseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  const host = req.headers["x-forwarded-host"] || req.get("host");
  return `${proto}://${host}`;
}

function deleteUploadFile(filename) {
  if (!filename) return;
  const filePath = path.join(UPLOADS_DIR, path.basename(filename));
  fs.unlink(filePath, (err) => {
    if (err && err.code !== "ENOENT") {
      console.warn(`Failed to delete upload ${filename}:`, err.message);
    }
  });
}

// Find any of our own /uploads/<filename> URLs referenced inside a request
// body (recursively), so we know what to clean up once Pixazo is done.
function findLocalUploadFilenames(value, out = []) {
  if (typeof value === "string") {
    const matches = value.matchAll(/\/uploads\/([a-zA-Z0-9._-]+)/g);
    for (const m of matches) out.push(m[1]);
  } else if (Array.isArray(value)) {
    value.forEach((v) => findLocalUploadFilenames(v, out));
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((v) => findLocalUploadFilenames(v, out));
  }
  return out;
}

const TERMINAL_STATUSES = new Set(["COMPLETED", "SUCCEEDED", "FAILED", "ERROR", "CANCELLED", "CANCELED"]);

// Called from /api/status once a job's status is known. If it's finished
// (success or failure) and we're tracking uploaded source media for it,
// delete that media now and stop tracking it.
function cleanupIfTerminal(requestId, status) {
  const normalized = String(status || "").toUpperCase();
  if (!TERMINAL_STATUSES.has(normalized)) return;
  const filenames = pendingAsyncCleanup.get(requestId);
  if (!filenames) return;
  filenames.forEach(deleteUploadFile);
  pendingAsyncCleanup.delete(requestId);
}

function sweepOldUploads() {
  fs.readdir(UPLOADS_DIR, (err, files) => {
    if (err) return;
    const now = Date.now();
    files.forEach((file) => {
      const filePath = path.join(UPLOADS_DIR, file);
      fs.stat(filePath, (statErr, stats) => {
        if (statErr) return;
        if (now - stats.mtimeMs > UPLOAD_MAX_AGE_MS) {
          fs.unlink(filePath, () => {});
        }
      });
    });
  });
}
setInterval(sweepOldUploads, 5 * 60 * 1000);

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

// Host a locally-picked file (image, audio, or video — same code path for
// all of them) on this server so it has a public URL Pixazo's API can fetch.
// The file is deleted automatically once Pixazo has used it — see the
// cleanup hooks in /api/generate and /api/status below, plus the periodic
// sweep as a safety net for jobs that never reach a terminal state.
app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file", message: "No file was uploaded." });
    }

    const ext = path.extname(req.file.originalname || "") || "";
    const filename = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`;
    const filePath = path.join(UPLOADS_DIR, filename);

    await fs.promises.writeFile(filePath, req.file.buffer);

    const url = `${getBaseUrl(req)}/uploads/${filename}`;
    return res.json({ url, host: "local", filename });
  } catch (err) {
    res.status(500).json({ error: "Upload failed", details: { message: err.message } });
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
    const uploadedFilenames = findLocalUploadFilenames(body);

    let response;
    try {
      response = await axios.post(url, body, {
        headers: pixazoHeaders(),
        timeout: 60000,
      });
    } catch (err) {
      // Pixazo either fetched the source media or rejected the request outright —
      // either way we're done with the uploaded file(s), so clean up now.
      uploadedFilenames.forEach(deleteUploadFile);
      throw err;
    }

    const data = response.data;

    if (model.responseMode === "sync") {
      // Sync models return the finished result in this same call, so Pixazo
      // has already consumed any source media — safe to delete now.
      uploadedFilenames.forEach(deleteUploadFile);

      // For "image-search" style models, outputField is an array of results.
      if (model.type === "image-search") {
        return res.json({ completed: true, results: data[model.outputField] || [] });
      }
      const mediaUrl = data[model.outputField] || data.output || data.imageUrl;
      return res.json({ completed: true, mediaUrl });
    }

    // Async: response looks like { request_id, status, polling_url }. The job
    // is still running, so hold off deleting until /api/status sees it finish.
    if (uploadedFilenames.length && data.request_id) {
      pendingAsyncCleanup.set(data.request_id, uploadedFilenames);
    }

    return res.json({
      completed: false,
      requestId: data.request_id,
      modelId,
    });
  } catch (err) {
    const status = err.response?.status || 500;
    const data = err.response?.data || { message: err.message };
    console.error(`Pixazo /api/generate error [${status}]:`, JSON.stringify(data));
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
      const normalizedStatus = data.status?.toUpperCase() === "SUCCEEDED" ? "COMPLETED" : (data.status || "PROCESSING").toUpperCase();
      cleanupIfTerminal(requestId, normalizedStatus);
      // Normalize Pixelforge's shape to look like the standard one.
      return res.json({
        status: normalizedStatus,
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
    cleanupIfTerminal(requestId, data.status);
    res.json(data);
  } catch (err) {
    // A failed status check doesn't necessarily mean the job is done, so we
    // don't clean up here — the periodic sweep will catch it eventually if
    // the job never resolves.
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
});
