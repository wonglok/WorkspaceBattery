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
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
} from "fs";
import { resolve, normalize } from "path";
import { homedir } from "os";
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { createProxyMiddleware } from "http-proxy-middleware";
import { setupProactive } from "./src/proactive";

const PORT = parseInt(process.env.PORT ?? "", 10) || 8333;
const LLAMA_HOST = process.env.LLAMA_HOST || "http://localhost:8222";

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

const llamaProxy = createProxyMiddleware({
  target: LLAMA_HOST,
  changeOrigin: true,
  proxyTimeout: 600_000,
  timeout: 600_000,
});

app.use("/v1", llamaProxy);
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
// API — workspace config
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

app.get("/api/config", (_req: Request, res: Response) => {
  res.json(readConfig());
});

app.post("/api/config", (req: Request, res: Response) => {
  const { workspace } = req.body;
  writeConfig({ workspace });
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// API — folder picker (native dialog via node-file-dialog)
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
// API — file upload (saves attachments to workspace)
// ---------------------------------------------------------------------------

app.post("/api/upload", (req: Request, res: Response) => {
  const { data, name, conversationId } = req.body;
  if (!data || !name || !conversationId) {
    res
      .status(400)
      .json({ error: "data, name, and conversationId are required" });
    return;
  }

  const uploadDir = resolve(DEFAULT_WORKSPACE, "upload", conversationId);
  if (!existsSync(uploadDir)) mkdirSync(uploadDir, { recursive: true });

  const filePath = resolve(uploadDir, name);
  const buffer = Buffer.from(data, "base64");
  writeFileSync(filePath, buffer);

  res.json({
    path: filePath,
    relativePath: `upload/${conversationId}/${name}`,
  });
});

// ---------------------------------------------------------------------------
// API — chat with agentic loop (SSE)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Tool system — unified definition + handler
// ---------------------------------------------------------------------------

type ToolJson = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
};

interface ToolDef {
  json: ToolJson;
  fn: (input: Record<string, unknown>, workspaceRoot: string) => string;
}

function defineTool(
  json: ToolJson,
  fn: (input: Record<string, unknown>, workspaceRoot: string) => string,
): ToolDef {
  return { json, fn };
}

const TOOLS: ToolDef[] = [
  defineTool(
    {
      type: "function",
      function: {
        name: "readFile",
        description:
          "Read the contents of a file in the workspace. Path is relative to workspace root.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Relative path from workspace root",
            },
          },
          required: ["path"],
        },
      },
    },
    (input, root) => {
      return readFileSync(safeResolve(root, input.path as string), "utf-8");
    },
  ),
  defineTool(
    {
      type: "function",
      function: {
        name: "writeFile",
        description:
          "Write content to a file in the workspace. Creates parent directories if needed.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Relative path from workspace root",
            },
            content: { type: "string", description: "File content to write" },
          },
          required: ["path", "content"],
        },
      },
    },
    (input, root) => {
      const filePath = safeResolve(root, input.path as string);
      const dir = path.dirname(filePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(filePath, input.content as string, "utf-8");
      return `File written: ${input.path}`;
    },
  ),
  defineTool(
    {
      type: "function",
      function: {
        name: "listDir",
        description:
          "List files and directories in the workspace. Path is relative to workspace root.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description:
                "Relative path from workspace root (default: workspace root)",
            },
          },
          required: [],
        },
      },
    },
    (input, root) => {
      const dirPath = safeResolve(root, (input.path as string) || "");
      const entries = readdirSync(dirPath, { withFileTypes: true });
      return entries
        .map((e) => `${e.isDirectory() ? "📁" : "📄"} ${e.name}`)
        .join("\n");
    },
  ),
];

const MAX_ITERATIONS = 250;

function safeResolve(workspaceRoot: string, relativePath: string): string {
  const resolved = resolve(workspaceRoot, normalize(relativePath));
  if (
    !resolved.startsWith(workspaceRoot + path.sep) &&
    resolved !== workspaceRoot
  ) {
    throw new Error(`Path traversal denied: ${relativePath}`);
  }
  return resolved;
}

function sseWrite(res: Response, event: string, data: Record<string, unknown>) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

app.post("/api/chat", async (req: Request, res: Response) => {
  const { messages, model, conversationId } = req.body;
  // workspace: userInputworkspace

  const workspace = DEFAULT_WORKSPACE;

  if (!messages || !model || !workspace) {
    res
      .status(400)
      .json({ error: "messages, model, and workspace are required" });
    return;
  }

  const workspaceRoot = workspace;

  if (!existsSync(workspaceRoot)) {
    mkdirSync(workspaceRoot, { recursive: true });
  }

  console.log(workspaceRoot);
  if (!existsSync(workspaceRoot)) {
    res.status(400).json({ error: `Workspace not found: ${workspaceRoot}` });
    return;
  }

  // Load workspace memory file if present
  let workspaceMemory = "";
  const memoryFile = resolve(workspaceRoot, "system_memory.md");
  if (existsSync(memoryFile)) {
    try {
      workspaceMemory = readFileSync(memoryFile, "utf-8").trim();
      console.log(`Loaded workspace memory: ${memoryFile}`);
    } catch {
      // ignore unreadable memory files
    }
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const client = new OpenAI({ baseURL: `${LLAMA_HOST}/v1`, apiKey: "none" });

  const systemPrompt = [
    `You are a workspace AI assistant with access to the workspace at: ${workspaceRoot}`,
    `Today is: ${new Date().toISOString()}`,
    `Conversation ID is: ${conversationId}`,
    ``,
    `You have the following tools:`,
    `- readFile(path): Read file contents (relative to workspace root)`,
    `- writeFile(path, content): Write content to a file. Creates parent directories automatically.`,
    `- listDir(path): List files and directories (relative to workspace root, default: root)`,
    ``,
    `Always explain what you're doing before using a tool. Be concise.`,
    conversationId ? `\nConversation ID: ${conversationId}` : "",
    `User attachments for this conversation are saved in: upload/${conversationId}/`,
    workspaceMemory ? `\n## My System Memory:\n\n${workspaceMemory}` : "",
    `
    Always listDir of the workspace and see all the files and sub-folders and its files recursively.
    `,
  ]
    .join("\n")
    .trim();

  const conversation: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...messages.map((m: { role: string; content: unknown }) => ({
      role: m.role as "user" | "assistant",
      content: m.content as string,
    })),
  ];

  //

  try {
    let naturalStop = false;
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const stream = await client.chat.completions.create({
        model,
        messages: conversation,
        tools: TOOLS.map((t) => t.json),
        stream: true,
        reasoning_effort: "high",
      });

      let content = "";
      const toolCallMap = new Map<
        number,
        { id: string; name: string; arguments: string }
      >();

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;

        // llama.cpp reasoning/thinking tokens (extension field)
        const reasoning = (delta as Record<string, unknown>)
          .reasoning_content as string | undefined;
        if (reasoning) {
          sseWrite(res, "think", { delta: reasoning });
        }

        if (delta?.content) {
          content += delta.content;
          sseWrite(res, "content", { delta: delta.content });
        }

        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            if (!toolCallMap.has(idx)) {
              toolCallMap.set(idx, {
                id: tc.id ?? "",
                name: tc.function?.name ?? "",
                arguments: tc.function?.arguments ?? "",
              });
            } else {
              const existing = toolCallMap.get(idx)!;
              if (tc.id) existing.id = tc.id;
              if (tc.function?.name) existing.name += tc.function.name;
              if (tc.function?.arguments)
                existing.arguments += tc.function.arguments;
            }
          }
        }
      }

      const toolCalls = [...toolCallMap.values()].sort(
        (a, b) =>
          [...toolCallMap.keys()].indexOf(
            [...toolCallMap.keys()].find((k) => toolCallMap.get(k) === a) ?? 0,
          ) -
          [...toolCallMap.keys()].indexOf(
            [...toolCallMap.keys()].find((k) => toolCallMap.get(k) === b) ?? 0,
          ),
      );

      // Add assistant message to conversation
      const assistantMsg: ChatCompletionMessageParam = {
        role: "assistant",
        content: content || null,
      };

      if (toolCalls.length > 0) {
        assistantMsg.tool_calls = toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.arguments },
        }));
      }

      conversation.push(assistantMsg);

      // If no tool calls, we're done
      if (toolCalls.length === 0) {
        sseWrite(res, "done", {});
        naturalStop = true;
        break;
      }

      // Execute tool calls
      for (const tc of toolCalls) {
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(tc.arguments);
        } catch {
          // empty args
        }

        sseWrite(res, "tool_start", {
          id: tc.id,
          name: tc.name,
          input,
        });

        const tool = TOOLS.find((t) => t.json.function.name === tc.name);
        let output: string;
        try {
          output = tool
            ? tool.fn(input, workspaceRoot)
            : `Unknown tool: ${tc.name}`;
        } catch (err) {
          output = `Error: ${err instanceof Error ? err.message : String(err)}`;
        }

        sseWrite(res, "tool_result", {
          id: tc.id,
          name: tc.name,
          output,
        });

        conversation.push({
          role: "tool",
          tool_call_id: tc.id,
          content: output,
        });
      }
    }

    // If we hit max iterations without a natural stop
    if (!naturalStop) {
      sseWrite(res, "done", {});
    }
  } catch (err) {
    sseWrite(res, "error", {
      message: err instanceof Error ? err.message : String(err),
    });
    sseWrite(res, "done", {});
  }

  res.end();
});

// ---------------------------------------------------------------------------
// Static files — web UI
// ---------------------------------------------------------------------------

app.use(express.static(path.join(__dirname, "..", "dist")));

// ---------------------------

//

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

app.listen(PORT, "0.0.0.0", () => {
  console.log(`AI API: ${LLAMA_HOST}`);
  console.log(`Workspace UI: http://localhost:${PORT}`);
  console.log(`Workspace Vite (develoment): http://localhost:5173`);
});
