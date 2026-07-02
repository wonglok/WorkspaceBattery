// Llama Web Server
// ================
// Serves the web management UI and proxies the llama-server API.
// Runs alongside the macOS app's llama-server process.
//
// Start:  node server.js [--port PORT]
// Default port: 8391

const express = require("express");
const path = require("path");
const { createProxyMiddleware } = require("http-proxy-middleware");

const PORT = parseInt(process.env.PORT, 10) || 8333;
const LLAMA_HOST = process.env.LLAMA_HOST || "http://localhost:8080";

const app = express();

// ---------------------------------------------------------------------------
// Parent-process watchdog
// ---------------------------------------------------------------------------
// When the Llama app that launched this server terminates (normally or
// abnormally) this child process becomes an orphan.  Watch the parent PID
// every 3 seconds and exit if it's gone, so we never leave a stray server
// holding the port.
const PPID = process.env.DISABLE_WATCHDOG ? null : process.ppid;
if (PPID) {
  const watchdog = setInterval(() => {
    try {
      // Signal 0 tests whether the process exists without actually sending
      // a signal.  Throws ESRCH when the parent is gone.
      process.kill(PPID, 0);
    } catch {
      clearInterval(watchdog);
      console.log("Parent process exited — shutting down.");
      process.exit(0);
    }
  }, 3000);
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

// CORS — allow cross-origin requests from any origin so that browser-based
// tools and other apps on the LAN can call the API.
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Type");

  if (_req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }

  next();
});

app.use(express.json({ limit: "100mb" }));

// ---------------------------------------------------------------------------
// API — proxy to llama-server
// ---------------------------------------------------------------------------

// Proxy OpenAI-compatible endpoints (/v1/...) to llama-server.
// This lets any OpenAI client pointed at this server work transparently.
const llamaProxy = createProxyMiddleware({
  target: LLAMA_HOST,
  changeOrigin: true,
  proxyTimeout: 600_000, // 10 min for long completions
  timeout: 600_000,
});

app.use("/v1", llamaProxy);

// Proxy /models (non-v1) for backward compat with llama-server's own routes.
app.use("/models", llamaProxy);

// ---------------------------------------------------------------------------
// API — status endpoint
// ---------------------------------------------------------------------------

app.get("/api/status", async (_req, res) => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    const resp = await fetch(`${LLAMA_HOST}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (resp.ok) {
      res.json({ status: "ok", llama: true });
    } else {
      res.json({ status: "ok", llama: false });
    }
  } catch {
    res.json({ status: "ok", llama: false });
  }
});
// ---------------------------------------------------------------------------

// API — streaming chat endpoint (Server-Sent Events)
// ---------------------------------------------------------------------------
// Proxies the llama-server's streaming chat completions endpoint and
// forwards each SSE chunk to the browser in real time.

app.post('/api/chat/stream', async (req, res) => {
  const { model, messages } = req.body;
  if (!model || !messages) {
    return res.status(400).json({ error: 'model and messages are required' });
  }

  // SSE headers — tell the browser to keep the connection open
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  try {
    const resp = await fetch(`${LLAMA_HOST}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: messages,
        stream: true,
      }),
      signal: AbortSignal.timeout(600_000),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => 'Unknown error');
      res.write(`data: ${JSON.stringify({ error: `${resp.status} \u2014 ${errText}` })}\n\n`);
      res.end();
      return;
    }

    // Read the upstream SSE stream chunk by chunk and forward each event
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Split on each SSE message boundary (\n\n) and process complete events
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';

      for (const part of parts) {
        if (!part.trim()) continue;
        for (const line of part.split('\n')) {
          if (line.startsWith('data: ')) {
            res.write(line + '\n\n');
          }
        }
      }
    }

    // Flush any remaining data in the buffer
    if (buffer.trim()) {
      for (const line of buffer.split('\n')) {
        if (line.startsWith('data: ')) {
          res.write(line + '\n\n');
        }
      }
    }

    // Signal the end of the stream
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
});
// API — open proxy endpoint (passthrough to llama-server)
// ---------------------------------------------------------------------------

app.all("/api/proxy/{*path}", async (req, res) => {
  const targetPath = req.params.path;
  const targetUrl = `${LLAMA_HOST}/${targetPath}${req.url.includes("?") ? "?" + req.url.split("?")[1] : ""}`;

  try {
    const options = {
      method: req.method,
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(600_000),
    };
    if (req.method !== "GET" && req.method !== "HEAD") {
      options.body = JSON.stringify(req.body);
    }

    const resp = await fetch(targetUrl, options);
    const data = await resp.text();

    // Try to parse as JSON for pretty response; fall back to raw text.
    let payload;
    try {
      payload = JSON.parse(data);
    } catch {
      payload = data;
    }

    res.status(resp.status).json(payload);
  } catch (err) {
    res.status(502).json({
      error: `llama-server proxy failed: ${err.message}`,
    });
  }
});

// ---------------------------------------------------------------------------
// Static files — web UI
// ---------------------------------------------------------------------------

app.use(express.static(path.join(__dirname, "public")));

// SPA fallback: serve index.html for any unmatched route (except API).
app.use((req, res, next) => {
  if (req.path.startsWith("/api/") || req.path.startsWith("/v1/")) {
    return next();
  }
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Llama web server listening on http://localhost:${PORT}`);
  console.log(`Proxying llama-server at ${LLAMA_HOST}`);
  console.log(`Web UI: http://localhost:${PORT}`);
});
