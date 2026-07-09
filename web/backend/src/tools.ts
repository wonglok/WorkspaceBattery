import { execSync } from "child_process";
import OpenAI from "openai";
import path from "path";
import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
} from "fs";
import { resolve, normalize } from "path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const LLAMA_HOST = process.env.LLAMA_HOST || "http://localhost:8222";

// ---------------------------------------------------------------------------
// Tool system types
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

export interface ToolDef {
  json: ToolJson;
  fn: (
    input: Record<string, unknown>,
    workspaceRoot: string,
  ) => string | Promise<string>;
}

function defineTool(
  json: ToolJson,
  fn: (
    input: Record<string, unknown>,
    workspaceRoot: string,
  ) => string | Promise<string>,
): ToolDef {
  return { json, fn };
}

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

let currentModel = "";

export function setCurrentModel(model: string) {
  currentModel = model;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function safeResolve(
  workspaceRoot: string,
  relativePath: string,
): string {
  const resolved = resolve(workspaceRoot, normalize(relativePath));
  if (
    !resolved.startsWith(workspaceRoot + path.sep) &&
    resolved !== workspaceRoot
  ) {
    throw new Error(`Path traversal denied: ${relativePath}`);
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export const TOOLS: ToolDef[] = [
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
  defineTool(
    {
      type: "function",
      function: {
        name: "displayImage",
        description:
          "Display an image from the workspace in the chat. Returns a markdown image tag that renders in the frontend. Use after writing an image file to show it to the user. Path is relative to workspace root.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description:
                "Relative path to the image file from workspace root",
            },
            alt: {
              type: "string",
              description: "Alt text / caption for the image",
            },
          },
          required: ["path"],
        },
      },
    },
    (input, root) => {
      const filePath = safeResolve(root, input.path as string);
      if (!existsSync(filePath)) {
        return `Error: image not found at ${input.path}`;
      }
      const alt = (input.alt as string) || (input.path as string);
      return `![${alt}](http://localhost:8555/${input.path})`;
    },
  ),
  defineTool(
    {
      type: "function",
      function: {
        name: "saveMemory",
        description:
          "Save important information to your persistent memory file. Use this to remember user preferences, project context, decisions, or any information the user asks you to remember. The memory persists across conversations.",
        parameters: {
          type: "object",
          properties: {
            content: {
              type: "string",
              description:
                "The memory content to save (markdown format). Will be appended to existing memory.",
            },
          },
          required: ["content"],
        },
      },
    },
    (input, root) => {
      const memoryFile = resolve(root, "system_memory.md");
      const entry = `\n---\n## ${new Date().toISOString()}\n\n${input.content}\n`;
      if (existsSync(memoryFile)) {
        appendFileSync(memoryFile, entry, "utf-8");
      } else {
        writeFileSync(memoryFile, entry.trim(), "utf-8");
      }
      return `Memory saved to system_memory.md`;
    },
  ),
  defineTool(
    {
      type: "function",
      function: {
        name: "readImage",
        description:
          "Read and describe an image file from the workspace using AI vision. Returns a textual description of what's in the image. Use this to understand images the user has uploaded or that exist in the workspace. Path is relative to workspace root.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description:
                "Relative path to the image file from workspace root",
            },
          },
          required: ["path"],
        },
      },
    },
    async (input, root) => {
      const filePath = safeResolve(root, input.path as string);
      if (!existsSync(filePath)) {
        return `Error: image not found at ${input.path}`;
      }
      const buffer = readFileSync(filePath);
      const ext = (input.path as string).split(".").pop()?.toLowerCase() ?? "";
      const mimeMap: Record<string, string> = {
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        gif: "image/gif",
        webp: "image/webp",
        svg: "image/svg+xml",
        bmp: "image/bmp",
      };
      const mime = mimeMap[ext] ?? "image/png";
      const dataUrl = `data:${mime};base64,${buffer.toString("base64")}`;

      const visionClient = new OpenAI({
        baseURL: `${LLAMA_HOST}/v1`,
        apiKey: "none",
      });

      const resp = await visionClient.chat.completions.create({
        model: currentModel,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Describe this image in detail. What do you see?",
              },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        max_tokens: 1024,
      });

      return resp.choices[0]?.message?.content ?? "No description available.";
    },
  ),
  defineTool(
    {
      type: "function",
      function: {
        name: "openInBrowser",
        description:
          "Open a file in browser from the workspace in the system browser. Use this to preview web pages you've created. Path is relative to workspace root.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Relative path to the HTML file from workspace root",
            },
          },
          required: ["path"],
        },
      },
    },
    (input, root) => {
      const filePath = safeResolve(root, input.path as string);
      if (!existsSync(filePath)) {
        return `Error: file not found at ${input.path}`;
      }
      const url = `http://localhost:8555/${input.path}`;
      try {
        execSync(`open "${url}"`);
        return `Opened in browser: ${url}`;
      } catch {
        return `Error: failed to open browser. URL: ${url}`;
      }
    },
  ),
];
