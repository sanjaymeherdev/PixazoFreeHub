const tabsEl = document.getElementById("tabs");
const modelSelect = document.getElementById("model-select");
const modelDescription = document.getElementById("model-description");
const fieldsContainer = document.getElementById("fields");
const emptyState = document.getElementById("empty-state");
const generateBtn = document.getElementById("generate-btn");
const errorMsg = document.getElementById("error-msg");
const statusEl = document.getElementById("status");
const outputEl = document.getElementById("output");

let categories = [];
let models = [];
let currentCategory = null;
let currentModel = null;
let pollTimer = null;

async function loadCatalog() {
  const [catRes, modelRes] = await Promise.all([fetch("/api/categories"), fetch("/api/models")]);
  categories = await catRes.json();
  models = await modelRes.json();

  tabsEl.innerHTML = categories
    .map(
      (c) => `<button class="tab" data-cat="${c.id}">${c.icon || ""} ${c.label}</button>`
    )
    .join("");

  tabsEl.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => selectCategory(btn.dataset.cat));
  });

  // Pick the first category that actually has a free model, defaulting to the first tab.
  const firstWithModels = categories.find((c) => models.some((m) => m.category === c.id));
  selectCategory((firstWithModels || categories[0]).id);
}

function modelsForCategory(catId) {
  return models.filter((m) => m.category === catId);
}

function selectCategory(catId) {
  currentCategory = catId;
  tabsEl.querySelectorAll(".tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.cat === catId);
  });

  const catModels = modelsForCategory(catId);
  errorMsg.textContent = "";
  statusEl.textContent = "";
  statusEl.className = "status";
  outputEl.innerHTML = "";
  clearInterval(pollTimer);

  if (catModels.length === 0) {
    modelSelect.innerHTML = "";
    modelSelect.style.display = "none";
    modelDescription.textContent = "";
    fieldsContainer.innerHTML = "";
    fieldsContainer.style.display = "none";
    generateBtn.style.display = "none";
    emptyState.style.display = "block";
    currentModel = null;
    return;
  }

  emptyState.style.display = "none";
  modelSelect.style.display = "";
  fieldsContainer.style.display = "";
  generateBtn.style.display = "";

  modelSelect.innerHTML = catModels.map((m) => `<option value="${m.id}">${m.label}</option>`).join("");
  selectModel(catModels[0].id);
}

// Human-readable "supported range" note shown under number fields (width,
// height, steps, frames, etc.) so people know the limits before they type,
// e.g. "Supported range: 256–1536px (steps of 64)".
function rangeHintText(f) {
  if (f.min === undefined && f.max === undefined) return "";
  const unit = /width|height/i.test(f.name) ? "px" : "";
  let text;
  if (f.min !== undefined && f.max !== undefined) {
    text = `Supported range: ${f.min}${unit}–${f.max}${unit}`;
  } else if (f.max !== undefined) {
    text = `Max: ${f.max}${unit}`;
  } else {
    text = `Min: ${f.min}${unit}`;
  }
  if (f.step !== undefined && f.step !== 1) text += ` (steps of ${f.step})`;
  return text;
}

function fieldInputHtml(f) {
  const id = `field-${f.name}`;
  const defaultVal = f.default !== undefined ? f.default : "";

  if (f.type === "select") {
    const opts = f.options
      .map((o) => `<option value="${o}" ${o === defaultVal ? "selected" : ""}>${o}</option>`)
      .join("");
    return `<select id="${id}">${opts}</select>`;
  }

  if (f.type === "number") {
    const attrs = [
      f.min !== undefined ? `min="${f.min}"` : "",
      f.max !== undefined ? `max="${f.max}"` : "",
      f.step !== undefined ? `step="${f.step}"` : "",
    ]
      .filter(Boolean)
      .join(" ");
    const input = `<input type="number" id="${id}" value="${defaultVal}" placeholder="${f.placeholder || ""}" data-min="${f.min ?? ""}" data-max="${f.max ?? ""}" data-step="${f.step ?? ""}" ${attrs} />`;
    const range = rangeHintText(f);
    return range ? `${input}<span class="field-range">${range}</span>` : input;
  }

  if (f.type === "url") {
    const input = `<input type="url" id="${id}" value="${defaultVal}" placeholder="${f.placeholder || ""}" />`;
    if (!f.upload) return input;

    const accept = { image: "image/*", audio: "audio/*", video: "video/*" }[f.upload] || "*/*";
    return `
      <div class="upload-row">
        ${input}
        <label class="upload-btn" for="upload-${f.name}">📁 Upload from PC</label>
        <input type="file" id="upload-${f.name}" class="upload-input" data-field="${f.name}" data-kind="${f.upload}" accept="${accept}" style="display:none" />
      </div>
      <span class="upload-status" id="upload-status-${f.name}"></span>`;
  }

  if (f.type === "text") {
    return `<input type="text" id="${id}" value="${defaultVal}" placeholder="${f.placeholder || ""}" />`;
  }

  if (f.type === "checkbox") {
    const checked = f.default === true ? "checked" : "";
    return `<input type="checkbox" id="${id}" ${checked} />`;
  }

  // textarea (default)
  return `<textarea id="${id}" placeholder="${f.placeholder || ""}">${defaultVal}</textarea>`;
}

function selectModel(id) {
  currentModel = models.find((m) => m.id === id);
  modelSelect.value = id;
  modelDescription.textContent = currentModel.description;

  fieldsContainer.innerHTML = currentModel.fields
    .map((f) => {
      const hint = f.hint ? `<span class="field-hint">${f.hint}</span>` : "";
      return `<label for="field-${f.name}">${f.name}${f.required ? " *" : ""}${hint}</label>${fieldInputHtml(f)}`;
    })
    .join("");

  wireUploadInputs();
  wireRangeClamping();
}

// Clamps every number input to its declared min/max the moment focus leaves
// it (typing out-of-range values is still allowed while editing), so the
// value sent to Pixazo is always inside the supported range.
function wireRangeClamping() {
  fieldsContainer.querySelectorAll('input[type="number"]').forEach((input) => {
    input.addEventListener("blur", () => clampNumberInput(input));
  });
}

function clampNumberInput(input) {
  if (input.value === "") return;
  const min = input.dataset.min !== "" ? Number(input.dataset.min) : undefined;
  const max = input.dataset.max !== "" ? Number(input.dataset.max) : undefined;
  let val = Number(input.value);
  if (Number.isNaN(val)) return;
  if (min !== undefined && val < min) val = min;
  if (max !== undefined && val > max) val = max;
  input.value = val;
}

// Hooks up every file-picker in the current form: pick a file -> POST it to
// /api/upload -> the returned public URL fills the matching text field.
function wireUploadInputs() {
  fieldsContainer.querySelectorAll(".upload-input").forEach((fileInput) => {
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      if (!file) return;

      const fieldName = fileInput.dataset.field;
      const kind = fileInput.dataset.kind;
      const urlField = document.getElementById(`field-${fieldName}`);
      const statusEl2 = document.getElementById(`upload-status-${fieldName}`);

      statusEl2.textContent = `Uploading ${file.name}...`;
      statusEl2.className = "upload-status processing";

      try {
        const body = new FormData();
        body.append("file", file);
        body.append("kind", kind);

        const res = await fetch("/api/upload", { method: "POST", body });
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.message || data.details?.message || "Upload failed.");
        }

        urlField.value = data.url;
        statusEl2.textContent = `Uploaded ✔ (hosted via ${data.host})`;
        statusEl2.className = "upload-status completed";
      } catch (err) {
        statusEl2.textContent = err.message;
        statusEl2.className = "upload-status failed";
      } finally {
        fileInput.value = "";
      }
    });
  });
}

modelSelect.addEventListener("change", (e) => selectModel(e.target.value));

function collectParams() {
  const params = {};
  for (const f of currentModel.fields) {
    const el = document.getElementById(`field-${f.name}`);
    if (f.type === "number") clampNumberInput(el);
    if (f.type === "checkbox") {
      params[f.name] = el.checked;
    } else {
      params[f.name] = el.value.trim ? el.value.trim() : el.value;
    }
  }
  return params;
}

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className = `status ${cls || ""}`;
}

function renderMedia(mediaUrl, type) {
  if (!mediaUrl) {
    outputEl.innerHTML = `<p class="hint">No media URL in response.</p>`;
    return;
  }
  if (type === "image") outputEl.innerHTML = `<img src="${mediaUrl}" alt="Generated result" />`;
  else if (type === "video") outputEl.innerHTML = `<video src="${mediaUrl}" controls autoplay loop muted></video>`;
  else if (type === "audio") outputEl.innerHTML = `<audio src="${mediaUrl}" controls></audio>`;
  else outputEl.innerHTML = `<a href="${mediaUrl}" target="_blank">${mediaUrl}</a>`;
}

function renderSearchResults(results) {
  if (!results || results.length === 0) {
    outputEl.innerHTML = `<p class="hint">No matching images found.</p>`;
    return;
  }
  outputEl.innerHTML = results
    .slice(0, 12)
    .map(
      (r) => `
      <div style="margin-bottom:10px;">
        <img src="${r.url}" alt="${r.caption || "result"}" style="margin-bottom:4px;" />
        <p class="hint" style="margin:0;">${r.caption || ""}</p>
      </div>`
    )
    .join("");
}

async function pollStatus(modelId, requestId, type) {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      const res = await fetch(`/api/status/${modelId}/${requestId}`);
      const data = await res.json();

      if (data.status === "PROCESSING" || data.status === "QUEUED") {
        setStatus(`Status: ${data.status}...`, "processing");
      } else if (data.status === "COMPLETED") {
        clearInterval(pollTimer);
        setStatus("Completed ✔", "completed");
        generateBtn.disabled = false;
        const mediaUrl = (data.output?.media_url || [])[0];
        renderMedia(mediaUrl, type);
      } else if (data.status === "FAILED" || data.status === "ERROR") {
        clearInterval(pollTimer);
        setStatus(`Failed: ${data.error || "unknown error"}`, "failed");
        generateBtn.disabled = false;
      }
    } catch (err) {
      clearInterval(pollTimer);
      setStatus("Error while checking status.", "failed");
      generateBtn.disabled = false;
    }
  }, 3000);
}

generateBtn.addEventListener("click", async () => {
  if (!currentModel) return;
  errorMsg.textContent = "";
  outputEl.innerHTML = "";
  const params = collectParams();

  const missing = currentModel.fields.find((f) => f.required && !params[f.name]);
  if (missing) {
    errorMsg.textContent = `Please fill in "${missing.name}".`;
    return;
  }

  generateBtn.disabled = true;
  setStatus("Submitting job...", "processing");

  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelId: currentModel.id, params }),
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.details?.message || data.message || "Request failed.");
    }

    if (data.completed) {
      generateBtn.disabled = false;
      setStatus("Completed ✔", "completed");
      if (currentModel.type === "image-search") {
        renderSearchResults(data.results);
      } else {
        renderMedia(data.mediaUrl, currentModel.type);
      }
    } else {
      setStatus(`Queued (id: ${data.requestId})`, "processing");
      pollStatus(data.modelId, data.requestId, currentModel.type);
    }
  } catch (err) {
    generateBtn.disabled = false;
    setStatus("", "");
    errorMsg.textContent = err.message;
  }
});

loadCatalog();
