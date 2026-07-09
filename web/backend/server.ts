// Llama Web Server
// ================
// Serves the web management UI and proxies the llama-server API.
// Runs alongside the macOS app's llama-server process.
//
// Start:  npx tsx server.ts [--port PORT]
// Default port: 8333

import cors from "cors";
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import path from "path";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { homedir } from "os";
import { createProxyMiddleware } from "http-proxy-middleware";
import { setupProactive } from "./src/proactive";
import { LLAMA_HOST } from "./src/tools";
import chatRouter from "./src/routes/chat";
import createConversationRoutes from "./src/routes/conversations";

const PORT = parseInt(process.env.PORT ?? "", 10) || 8333;

const app = express();

// ---------------------------------------------------------------------------
// Parent-process watchdog
// ---------------------------------------------------------------------------
const PPID: number | null = process.env.DISABLE_WATCHDOG ? null : process.ppid;
if (PPID) {
  const watchdog = setInterval(() => {
    try {
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

app.use(cors());
app.use(express.json({ limit: "4096MB" }));

// ---------------------------------------------------------------------------
// Proxy to llama-server
// ---------------------------------------------------------------------------

const llamaProxy = createProxyMiddleware({
  target: LLAMA_HOST,
  changeOrigin: true,
  proxyTimeout: 600_000,
  timeout: 600_000,
});

app.use("/v1", llamaProxy);
app.use("/models", llamaProxy);

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CONFIG_DIR = resolve(homedir(), "workspace-battery");
const CONFIG_FILE = resolve(CONFIG_DIR, "config.json");
const DEFAULT_WORKSPACE = resolve(homedir(), "workspace-battery");

function readConfig(): { workspace?: string } {
  try {
    if (!existsSync(CONFIG_FILE)) return { workspace: DEFAULT_WORKSPACE };
    const raw = readFileSync(CONFIG_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { workspace: DEFAULT_WORKSPACE };
  }
}

function writeConfig(config: { workspace?: string }): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// API — status
// ---------------------------------------------------------------------------

app.get("/api/status", async (_req: Request, res: Response) => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    const resp = await fetch(`${LLAMA_HOST}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    res.json({ status: "ok", llama: resp.ok });
  } catch {
    res.json({ status: "ok", llama: false });
  }
});

// ---------------------------------------------------------------------------
// API — workspace config
// ---------------------------------------------------------------------------

app.get("/api/config", (_req: Request, res: Response) => {
  res.json(readConfig());
});

app.post("/api/config", (req: Request, res: Response) => {
  const { workspace } = req.body;
  writeConfig({ workspace });
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// API — folder picker
// ---------------------------------------------------------------------------

app.post("/api/folder-picker", async (_req: Request, res: Response) => {
  try {
    const nfd = await import("nativefiledialog-for-bun");
    const folder = await nfd.pickFolder();
    console.log(folder);
    res.json({ path: folder ?? null });
  } catch {
    res.json({ path: null });
  }
});

// ---------------------------------------------------------------------------
// API — file upload
// ---------------------------------------------------------------------------

app.post("/api/upload", (req: Request, res: Response) => {
  const { data, name, conversationId } = req.body;
  if (!data || !name || !conversationId) {
    res
      .status(400)
      .json({ error: "data, name, and conversationId are required" });
    return;
  }

  const uploadDir = resolve(DEFAULT_WORKSPACE, "conversation", conversationId);
  if (!existsSync(uploadDir)) mkdirSync(uploadDir, { recursive: true });

  const filePath = resolve(uploadDir, name);
  const buffer = Buffer.from(data, "base64");
  writeFileSync(filePath, buffer);

  res.json({
    path: filePath,
    relativePath: `conversation/${conversationId}/${name}`,
  });
});

// ---------------------------------------------------------------------------
// API — chat (agentic loop with SSE)
// ---------------------------------------------------------------------------

app.use("/api", chatRouter);

// ---------------------------------------------------------------------------
// API — conversations CRUD
// ---------------------------------------------------------------------------

app.use("/api/conversations", createConversationRoutes(DEFAULT_WORKSPACE));

// ---------------------------------------------------------------------------
// Static files — web UI
// ---------------------------------------------------------------------------

app.use(express.static(path.join(__dirname, "..", "dist")));

app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path.startsWith("/api/") || req.path.startsWith("/v1/")) {
    return next();
  }
  res.sendFile(path.join(__dirname, "..", "dist", "index.html"));
});

setTimeout(() => {
  setupProactive();
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

app.listen(PORT, "127.0.0.1", () => {
  console.log(`AI API: ${LLAMA_HOST}`);
  console.log(`Workspace UI: http://localhost:${PORT}`);
  console.log(`Workspace Vite (develoment): http://localhost:5173`);
});

// ---------------------------------------------------------------------------
// Workspace file server
// ---------------------------------------------------------------------------

const workspaceApp = express();
workspaceApp.use(cors());
workspaceApp.use(express.static(DEFAULT_WORKSPACE));
workspaceApp.listen(8555, "127.0.0.1", () => {
  console.log(`Workspace Files: http://localhost:8555`);
});
