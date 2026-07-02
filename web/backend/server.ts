// Llama Web Server
// ================
// Serves the web management UI and proxies the llama-server API.
// Runs alongside the macOS app's llama-server process.
//
// Start:  npx tsx server.ts [--port PORT]
// Default port: 8391

import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import path from "path";
import { createProxyMiddleware } from "http-proxy-middleware";

const PORT = parseInt(process.env.PORT ?? "", 10) || 8333;
const LLAMA_HOST = process.env.LLAMA_HOST || "http://localhost:8222";

const app = express();

// ---------------------------------------------------------------------------
// Parent-process watchdog
// ---------------------------------------------------------------------------
// When the Llama app that launched this server terminates (normally or
// abnormally) this child process becomes an orphan.  Watch the parent PID
// every 3 seconds and exit if it's gone, so we never leave a stray server
// holding the port.
const PPID: number | null = process.env.DISABLE_WATCHDOG ? null : process.ppid;
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
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With",
  );
  res.setHeader(
    "Access-Control-Expose-Headers",
    "Content-Length, Content-Type",
  );

  if (_req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }

  next();
});

app.use(express.json({ limit: "4096MB" }));

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

app.get("/api/status", async (_req: Request, res: Response) => {
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
// Static files — web UI
// ---------------------------------------------------------------------------

app.use(express.static(path.join(__dirname, "..", "dist")));

// SPA fallback: serve index.html for any unmatched route (except API).
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path.startsWith("/api/") || req.path.startsWith("/v1/")) {
    return next();
  }
  res.sendFile(path.join(__dirname, "..", "dist", "index.html"));
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

app.listen(PORT, "0.0.0.0", () => {
  console.log(`AI API: ${LLAMA_HOST}`);
  console.log(`Workspace UI: http://localhost:${PORT}`);
  console.log(`Workspace Vite (develoment): http://localhost:5173`);
});

//
