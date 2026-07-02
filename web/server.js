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

const PORT = parseInt(process.env.PORT, 10) || 8331;
const LLAMA_HOST = process.env.LLAMA_HOST || "http://localhost:8080";

const app = express();

// ---------------------------------------------------------------------------
// Parent-process watchdog
// ---------------------------------------------------------------------------
// When the Llama app that launched this server terminates (normally or
// abnormally) this child process becomes an orphan.  Watch the parent PID
// every 3 seconds and exit if it's gone, so we never leave a stray server
// holding the port.
const PPID = process.ppid;
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

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Llama web server listening on http://localhost:${PORT}`);
  console.log(`Proxying llama-server at ${LLAMA_HOST}`);
  console.log(`Web UI: http://localhost:${PORT}`);
});
