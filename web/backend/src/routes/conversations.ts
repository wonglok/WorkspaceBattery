import { Router, type Request, type Response } from "express";
import { readFileSync, readdirSync, existsSync, rmSync } from "fs";
import { resolve } from "path";

export default function createConversationRoutes(workspaceRoot: string) {
  const router = Router();

  function extractPreview(content: unknown): string {
    if (typeof content === "string") return content.slice(0, 80);
    if (Array.isArray(content)) {
      const textParts = content
        .filter((p) => p?.type === "text")
        .map((p) => (p as { text: string }).text ?? "")
        .join(" ");
      return textParts.slice(0, 80);
    }
    return "";
  }

  router.get("/", (_req: Request, res: Response) => {
    try {
      const convRoot = resolve(workspaceRoot, "conversation");
      if (!existsSync(convRoot)) {
        res.json([]);
        return;
      }
      const entries = readdirSync(convRoot, { withFileTypes: true });
      const conversations = entries
        .filter((e) => e.isDirectory())
        .map((e) => {
          const file = resolve(convRoot, e.name, "conversation.json");
          try {
            const raw = readFileSync(file, "utf-8");
            const data = JSON.parse(raw);
            const userMsg = data.messages?.find(
              (m: { role: string }) => m.role === "user",
            );
            return {
              id: e.name,
              savedAt: data.savedAt ?? "",
              model: data.model ?? "",
              preview: extractPreview(userMsg?.content),
            };
          } catch {
            return { id: e.name, savedAt: "", model: "", preview: "" };
          }
        })
        .sort(
          (a, b) =>
            new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime(),
        );
      res.json(conversations);
    } catch {
      res.json([]);
    }
  });

  router.get("/:id", (req: Request, res: Response) => {
    try {
      const convId = req.params.id as string;
      const file = resolve(
        workspaceRoot,
        "conversation",
        convId,
        "conversation.json",
      );
      if (!existsSync(file)) {
        res.status(404).json({ error: "Conversation not found" });
        return;
      }
      const raw = readFileSync(file, "utf-8");
      res.json(JSON.parse(raw));
    } catch {
      res.status(500).json({ error: "Failed to load conversation" });
    }
  });

  router.delete("/:id", (req: Request, res: Response) => {
    try {
      const convId = req.params.id as string;
      const convDir = resolve(workspaceRoot, "conversation", convId);
      if (!existsSync(convDir)) {
        res.status(404).json({ error: "Conversation not found" });
        return;
      }
      rmSync(convDir, { recursive: true });
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "Failed to delete conversation" });
    }
  });

  return router;
}
