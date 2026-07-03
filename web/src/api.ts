import type { ChatRequest, SSEEvent, WorkspaceConfig } from "./types";

export const BASE_URL = "http://localhost:8333";

const BASE = BASE_URL;

export async function pickFolder(): Promise<string | null> {
  const res = await fetch(`${BASE}/api/folder-picker`, { method: "POST" });
  const data = (await res.json()) as any;
  return data?.path ? data?.path : null;
}

export async function getConfig(): Promise<WorkspaceConfig> {
  const res = await fetch(`${BASE}/api/config`);
  if (!res.ok) return {};
  return res.json() as WorkspaceConfig;
}

export async function uploadFile(
  data: string,
  name: string,
  conversationId: string,
): Promise<string> {
  const res = await fetch(`${BASE}/api/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data, name, conversationId }),
  });
  if (!res.ok) throw new Error("Upload failed");
  const json = (await res.json()) as any;
  return json.relativePath as string;
}

export async function saveConfig(config: WorkspaceConfig): Promise<void> {
  await fetch(`${BASE}/api/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
}

export async function startChatStream(
  request: ChatRequest,
  onEvent: (event: SSEEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || `HTTP ${res.status}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      let eventType = "";
      for (const line of lines) {
        if (line.startsWith("event: ")) {
          eventType = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          const data = line.slice(6);
          try {
            const parsed = JSON.parse(data);
            if (eventType) {
              onEvent({ type: eventType as SSEEvent["type"], ...parsed });
            } else {
              onEvent(parsed as SSEEvent);
            }
          } catch {
            // skip malformed JSON lines
          }
          eventType = "";
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
