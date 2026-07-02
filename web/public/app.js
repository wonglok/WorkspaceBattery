// Llama Web UI
// ============

const STATE = {
  models: [],
  activeModelId: null,
  llamaRunning: false,
  statusInterval: null,
};

// ── DOM refs ────────────────────────────────────────────────────────────────

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const dom = {
  serverStatus: $("#serverStatus"),
  statusDot: $("#serverStatus .status-dot"),
  statusText: $("#serverStatus .status-text"),
  modelIndicator: $("#modelIndicator .model-name"),

  // Navigation
  navItems: $$(".nav-item"),
  views: {
    chat: $("#viewChat"),
    models: $("#viewModels"),
    settings: $("#viewSettings"),
  },

  // Chat
  modelSelector: $("#modelSelector"),
  loadModelBtn: $("#loadModelBtn"),
  chatMessages: $("#chatMessages"),
  chatInput: $("#chatInput"),
  sendBtn: $("#sendBtn"),

  // Models
  modelsContent: $("#modelsContent"),

  // Settings
  llamaPort: $("#llamaPort"),
  webPort: $("#webPort"),
  infoStatus: $("#infoStatus"),
  infoUrl: $("#infoUrl"),
  infoWebUrl: $("#infoWebUrl"),
};

// ── Fetch helpers ───────────────────────────────────────────────────────────

const LLAMA_HOST = () => `http://localhost:${dom.llamaPort.value}`;
const WEB_HOST = () => `http://localhost:${dom.webPort.value}`;

async function apiFetch(path, opts = {}) {
  const url = `/api/proxy/${path.replace(/^\//, "")}`;
  try {
    const resp = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...opts,
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

async function llamaFetch(path, opts = {}) {
  const url = `${LLAMA_HOST()}/${path.replace(/^\//, "")}`;
  try {
    const resp = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(5000),
      ...opts,
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

// ── Status polling ──────────────────────────────────────────────────────────

async function checkStatus() {
  try {
    const resp = await fetch("/api/status", { signal: AbortSignal.timeout(3000) });
    const data = await resp.json();
    STATE.llamaRunning = data.llama;
  } catch {
    STATE.llamaRunning = false;
  }

  dom.statusDot.className = "status-dot " + (STATE.llamaRunning ? "online" : "offline");
  dom.statusText.textContent = STATE.llamaRunning ? "Connected" : "Offline";
  dom.infoStatus.textContent = STATE.llamaRunning ? "Online" : "Offline";
  dom.infoUrl.textContent = STATE.llamaRunning ? `${LLAMA_HOST()}` : "—";
  dom.infoWebUrl.textContent = `http://localhost:${dom.webPort.value}`;

  // Enable/disable chat controls based on server status
  const hasModel = STATE.activeModelId !== null;
  dom.modelSelector.disabled = !STATE.llamaRunning;
  dom.loadModelBtn.disabled = !STATE.llamaRunning || !dom.modelSelector.value;
  dom.chatInput.disabled = !(STATE.llamaRunning && hasModel);
  dom.sendBtn.disabled = !(STATE.llamaRunning && hasModel);
}

// ── Model management ────────────────────────────────────────────────────────

async function fetchModels() {
  // Fetch llama-server's model list (loaded/available models)
  let serverModels = [];
  let loadedId = null;

  if (STATE.llamaRunning) {
    const modelsResp = await llamaFetch("v1/models");
    if (modelsResp && modelsResp.data) {
      serverModels = modelsResp.data;
      // Find which model is loaded
      for (const m of serverModels) {
        if (m.status && m.status.value === "loaded") {
          loadedId = m.id;
          break;
        }
      }
    }
  }

  STATE.activeModelId = loadedId;
  updateModelIndicator();
  updateModelSelector(serverModels);
  updateChatControls();
  updateModelsList(serverModels);
}

function updateModelIndicator() {
  dom.modelIndicator.textContent = STATE.activeModelId || "No model loaded";
}

function updateModelSelector(serverModels) {
  const sel = dom.modelSelector;
  const current = sel.value;

  // Preserve the current selection if possible
  sel.innerHTML = `<option value="">— Select a model —</option>`;

  if (serverModels.length === 0) {
    sel.innerHTML += `<option value="" disabled>No models available</option>`;
    return;
  }

  for (const m of serverModels) {
    const id = m.id;
    const label = m.status && m.status.value === "loaded" ? `${id} (active)` : id;
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = label;

    if (m.status && m.status.value === "loaded") {
      opt.selected = true;
    }

    sel.appendChild(opt);
  }

  // If no model loaded, try to preserve previous selection
  if (!sel.value && current) {
    for (const opt of sel.options) {
      if (opt.value === current) {
        opt.selected = true;
        break;
      }
    }
  }

  dom.loadModelBtn.disabled = !STATE.llamaRunning || !sel.value;
}

function updateChatControls() {
  const hasModel = STATE.activeModelId !== null;
  dom.chatInput.disabled = !(STATE.llamaRunning && hasModel);
  dom.sendBtn.disabled = !(STATE.llamaRunning && hasModel);
  dom.chatInput.placeholder = hasModel
    ? `Send a message to ${STATE.activeModelId}...`
    : "Load a model to start chatting.";
}

async function loadModel() {
  const modelId = dom.modelSelector.value;
  if (!modelId || !STATE.llamaRunning) return;

  dom.loadModelBtn.disabled = true;
  dom.loadModelBtn.textContent = "Loading...";

  try {
    const resp = await llamaFetch("models/load", {
      method: "POST",
      body: JSON.stringify({ model: modelId }),
    });

    // Wait a moment for the server to respond, then refresh
    await new Promise((r) => setTimeout(r, 1000));
    await fetchModels();
  } catch {
    // ignore
  }

  dom.loadModelBtn.textContent = "Load";
  dom.loadModelBtn.disabled = !STATE.llamaRunning || !dom.modelSelector.value;
}

async function unloadModel() {
  if (!STATE.activeModelId || !STATE.llamaRunning) return;

  await llamaFetch("models/unload", {
    method: "POST",
    body: JSON.stringify({ model: STATE.activeModelId }),
  });

  await new Promise((r) => setTimeout(r, 500));
  await fetchModels();
}

// ── Models list display ─────────────────────────────────────────────────────

function updateModelsList(serverModels) {
  const container = dom.modelsContent;

  if (!serverModels || serverModels.length === 0) {
    container.innerHTML = `<div class="loading-state">No models available on the server.</div>`;
    return;
  }

  // Group models by status
  const loaded = serverModels.filter((m) => m.status?.value === "loaded");
  const loading = serverModels.filter((m) => m.status?.value === "loading");
  const unloaded = serverModels.filter((m) => !m.status || m.status.value === "unloaded" || m.status.value === "sleeping");

  let html = "";

  if (loaded.length > 0) {
    html += `<h3 style="color:var(--green);margin-bottom:8px;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Loaded</h3>`;
    for (const m of loaded) {
      html += modelCard(m, "loaded");
    }
  }

  if (loading.length > 0) {
    html += `<h3 style="color:var(--yellow);margin-bottom:8px;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;margin-top:16px;">Loading</h3>`;
    for (const m of loading) {
      html += modelCard(m, "loading");
    }
  }

  if (unloaded.length > 0) {
    html += `<h3 style="color:var(--text-dim);margin-bottom:8px;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;margin-top:16px;">Available</h3>`;
    for (const m of unloaded) {
      html += modelCard(m, "available");
    }
  }

  container.innerHTML = html;
}

function modelCard(model, status) {
  const tags = {
    loaded: '<span class="model-tag loaded">Loaded</span>',
    loading: '<span class="model-tag downloading">Loading</span>',
    available: '<span class="model-tag available">Available</span>',
  };

  const isActive = model.status?.value === "loaded";

  return `
    <div class="model-card">
      <div class="model-info">
        <div class="model-title">${model.id} ${tags[status] || ""}</div>
        <div class="model-meta">${model.status?.value || "unloaded"}</div>
      </div>
      <div class="model-action">
        ${isActive
      ? `<button class="btn btn-sm" onclick="unloadModel()">Unload</button>`
      : status === "available"
        ? `<button class="btn btn-sm" onclick="document.getElementById('modelSelector').value='${model.id}';loadModel()">Load</button>`
        : ""
    }
      </div>
    </div>
  `;
}

// ── Chat ────────────────────────────────────────────────────────────────────

let abortController = null;

function addMessage(role, content) {
  const msg = document.createElement("div");
  msg.className = `message ${role}`;
  msg.innerHTML = formatMessage(content);
  dom.chatMessages.appendChild(msg);
  dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
  return msg;
}

function formatMessage(text) {
  // Escape HTML, then apply simple markdown
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/```(\w*)\n?([\s\S]*?)```/g, "<pre><code>$2</code></pre>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
  return html;
}

// ── Streaming chat (SSE) ──────────────────────────────────────────────────

async function sendMessage() {
  const text = dom.chatInput.value.trim();
  if (!text || !STATE.activeModelId || !STATE.llamaRunning) return;

  dom.chatInput.value = "";
  dom.chatInput.style.height = "auto";

  // Remove empty state if present
  const empty = dom.chatMessages.querySelector(".empty-state");
  if (empty) empty.remove();

  addMessage("user", text);

  // Create the assistant message element (will fill incrementally as tokens arrive)
  const assistantMsg = document.createElement("div");
  assistantMsg.className = "message assistant";
  dom.chatMessages.appendChild(assistantMsg);
  dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;

  abortController = new AbortController();
  let fullContent = "";

  try {
    const resp = await fetch("/api/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: STATE.activeModelId,
        messages: [{ role: "user", content: text }],
      }),
      signal: abortController.signal,
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "Unknown error");
      assistantMsg.innerHTML = `Error: ${resp.status} — ${errText}`;
      return;
    }

    // Read the SSE response body as a stream
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Split on SSE message boundaries (\n\n)
      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";

      for (const part of parts) {
        if (!part.trim()) continue;

        // Each part may have multiple "data:" lines — find the last one
        const lines = part.split("\n");
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;

            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta?.content || "";
              if (delta) {
                fullContent += delta;
                assistantMsg.innerHTML = formatMessage(fullContent);
                dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
              }
            } catch {
              // skip malformed JSON chunks
            }
          }
        }
      }
    }
  } catch (err) {
    if (err.name !== "AbortError") {
      assistantMsg.innerHTML = `Error: ${err.message}`;
    }
  } finally {
    abortController = null;
  }
}

// ── Chat input auto-resize ──────────────────────────────────────────────────

dom.chatInput.addEventListener("input", () => {
  dom.chatInput.style.height = "auto";
  dom.chatInput.style.height = Math.min(dom.chatInput.scrollHeight, 200) + "px";
});

dom.chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// ── Navigation ──────────────────────────────────────────────────────────────

dom.navItems.forEach((item) => {
  item.addEventListener("click", () => {
    const view = item.dataset.view;
    dom.navItems.forEach((n) => n.classList.remove("active"));
    item.classList.add("active");
    Object.values(dom.views).forEach((v) => v.classList.remove("active"));
    dom.views[view].classList.add("active");
  });
});

// ── Open Workspace ─────────────────────────────────────────────────────────

document.getElementById("openWorkspaceBtn").addEventListener("click", () => {
  window.open(`http://localhost:${dom.webPort.value}`, "_blank", "noopener,noreferrer");
});

// ── Event bindings ──────────────────────────────────────────────────────────

dom.sendBtn.addEventListener("click", sendMessage);
dom.loadModelBtn.addEventListener("click", loadModel);
dom.modelSelector.addEventListener("change", () => {
  dom.loadModelBtn.disabled = !STATE.llamaRunning || !dom.modelSelector.value;
});

// ── Polling ─────────────────────────────────────────────────────────────────

async function poll() {
  await checkStatus();
  await fetchModels();
}

// ── Init ────────────────────────────────────────────────────────────────────

poll();
setInterval(poll, 3000);
