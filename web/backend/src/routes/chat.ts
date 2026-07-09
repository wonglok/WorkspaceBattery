import { Router, type Request, type Response } from "express";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { TOOLS, LLAMA_HOST, setCurrentModel } from "../tools";

const router = Router();

const MAX_ITERATIONS = 250;

function sseWrite(res: Response, event: string, data: Record<string, unknown>) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

router.post("/chat", async (req: Request, res: Response) => {
  const { messages, model, conversationId, workspace } = req.body;
  setCurrentModel(model ?? "");

  if (!messages || !model) {
    res.status(400).json({ error: "messages and model are required" });
    return;
  }

  const workspaceRoot = workspace
    ? String(workspace)
    : resolve(process.env.HOME ?? "/tmp", "workspace-battery");

  if (!existsSync(workspaceRoot)) {
    mkdirSync(workspaceRoot, { recursive: true });
  }

  // Load workspace memory
  let workspaceMemory = "";
  const memoryFile = resolve(workspaceRoot, "system_memory.md");
  if (existsSync(memoryFile)) {
    try {
      workspaceMemory = readFileSync(memoryFile, "utf-8").trim();
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
    `- displayImage(path, alt?): Display an image from the workspace in the chat. Use after writing an image file to show it to the user. Returns a markdown image that renders in the frontend UI.`,
    `- saveMemory(content): Save important information to your persistent memory file. Use to remember user preferences, project context, or anything the user asks you to keep. Memory persists across conversations.`,
    `- readImage(path): Read and describe an image file from the workspace using AI vision. Returns a textual description of what's in the image.`,
    ``,
    `Always explain what you're doing before using a tool. Be concise.`,
    ``,
    `Memory: Use the saveMemory tool whenever you learn something worth keeping — user preferences, project decisions, key context, or when the user explicitly asks you to remember something. Your memory is loaded at the start of every conversation, so anything important should be saved. If you don't yet know the user's name, ask for it and remember it.`,
    conversationId ? `\nConversation ID: ${conversationId}` : "",
    `User attachments for this conversation are saved in: conversation/${conversationId}/`,
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

        const reasoning = (delta as Record<string, unknown>)
          .reasoning_content as string | undefined;
        if (reasoning) sseWrite(res, "think", { delta: reasoning });

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

      if (toolCalls.length === 0) {
        sseWrite(res, "done", {});
        naturalStop = true;
        break;
      }

      for (const tc of toolCalls) {
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(tc.arguments);
        } catch {
          // empty args
        }

        sseWrite(res, "tool_start", { id: tc.id, name: tc.name, input });

        const tool = TOOLS.find((t) => t.json.function.name === tc.name);
        let output: string;
        try {
          output = tool
            ? await tool.fn(input, workspaceRoot)
            : `Unknown tool: ${tc.name}`;
        } catch (err) {
          output = `Error: ${err instanceof Error ? err.message : String(err)}`;
        }

        sseWrite(res, "tool_result", { id: tc.id, name: tc.name, output });

        conversation.push({
          role: "tool",
          tool_call_id: tc.id,
          content: output,
        });
      }
    }

    if (!naturalStop) sseWrite(res, "done", {});
  } catch (err) {
    sseWrite(res, "error", {
      message: err instanceof Error ? err.message : String(err),
    });
    sseWrite(res, "done", {});
  }

  // Persist conversation
  if (conversationId) {
    try {
      const convDir = resolve(workspaceRoot, "conversation", conversationId);
      if (!existsSync(convDir)) mkdirSync(convDir, { recursive: true });
      const convFile = resolve(convDir, "conversation.json");
      const payload = {
        conversationId,
        model,
        savedAt: new Date().toISOString(),
        messages: conversation.map((m) => {
          const msg = m as unknown as Record<string, unknown>;
          return {
            role: msg.role,
            content: msg.content,
            ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {}),
            ...(msg.tool_call_id ? { tool_call_id: msg.tool_call_id } : {}),
          };
        }),
      };
      writeFileSync(convFile, JSON.stringify(payload, null, 2), "utf-8");
    } catch (e) {
      console.error("Failed to save conversation:", e);
    }
  }

  res.end();
});

export default router;
