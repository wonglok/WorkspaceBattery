import { useState, useRef, useCallback, useEffect } from "react";
import { loadConversation, startChatStream } from "../api";
import type {
  ContentPart,
  DisplayMessage,
  DisplayToolCall,
  SSEEvent,
} from "../types";
import { BASE_URL } from "../api";

export function useChat(workspacePath: string) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [conversationId, setConversationId] = useState(
    `${crypto.randomUUID()}`,
  );
  const [sidebarRefresh, setSidebarRefresh] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const [hovering, setHovering] = useState("");
  useEffect(() => {
    fetch(`${BASE_URL}/v1/models`)
      .then((r) => r.json())
      .then((data) => {
        const ids: string[] = (data?.data ?? [])
          .map((m: { id: string }) => m.id)
          .filter(Boolean);

        setModels(ids);
        if (ids.length > 0 && !selectedModel) setSelectedModel(ids[0]);
      })
      .catch(() => {
        // LLM server not available
      });
  }, [selectedModel, hovering]);

  const sendMessage = useCallback(
    async (parts: ContentPart[]) => {
      if (isStreaming) return;
      setError(null);

      const userMsg: DisplayMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: parts
          .filter((p) => p.type === "text")
          .map((p) => (p as { text: string }).text)
          .join(" "),
        parts,
        isStreaming: false,
      };

      const assistantId = crypto.randomUUID();
      const assistantMsg: DisplayMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        isStreaming: true,
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setIsStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      const prevMessages = messagesRef.current;

      try {
        await startChatStream(
          {
            messages: [...prevMessages, userMsg].map((m) => ({
              role: m.role,
              content: m.parts ?? m.content,
            })),
            model: selectedModel,
            workspace: workspacePath,
            conversationId,
          },
          (event: SSEEvent) => {
            switch (event.type) {
              case "content":
                setMessages((current) => {
                  const msgs = [...current];
                  const last = msgs[msgs.length - 1];
                  if (last && last.role === "assistant") {
                    msgs[msgs.length - 1] = {
                      ...last,
                      content: last.content + event.delta,
                      isStreaming: true,
                    };
                  }
                  return msgs;
                });
                break;
              case "think":
                setMessages((current) => {
                  const msgs = [...current];
                  const last = msgs[msgs.length - 1];
                  if (last && last.role === "assistant") {
                    msgs[msgs.length - 1] = {
                      ...last,
                      thinking: (last.thinking ?? "") + event.delta,
                    };
                  }
                  return msgs;
                });
                break;
              case "tool_start":
                setMessages((current) => {
                  const msgs = [...current];
                  const last = msgs[msgs.length - 1];
                  if (last && last.role === "assistant") {
                    msgs[msgs.length - 1] = {
                      ...last,
                      toolCalls: [
                        ...(last.toolCalls ?? []),
                        {
                          id: event.id,
                          name: event.name,
                          input: event.input,
                          status: "running" as const,
                        },
                      ],
                      isStreaming: true,
                    };
                  }
                  return msgs;
                });
                break;
              case "tool_result":
                setMessages((current) => {
                  const msgs = [...current];
                  const last = msgs[msgs.length - 1];
                  if (last?.toolCalls) {
                    msgs[msgs.length - 1] = {
                      ...last,
                      toolCalls: last.toolCalls.map((tc) =>
                        tc.id === event.id
                          ? {
                              ...tc,
                              output: event.output,
                              status: (event.output.startsWith("Error:")
                                ? "error"
                                : "done") as "error" | "done",
                            }
                          : tc,
                      ),
                    };
                  }
                  return msgs;
                });
                break;
              case "error":
                setError(event.message);
                setMessages((current) => {
                  const msgs = [...current];
                  const last = msgs[msgs.length - 1];
                  if (last && last.role === "assistant") {
                    msgs[msgs.length - 1] = {
                      ...last,
                      content: last.content + `\n\nError: ${event.message}`,
                      isStreaming: false,
                    };
                  }
                  return msgs;
                });
                break;
              case "done":
                setMessages((current) => {
                  const msgs = [...current];
                  const last = msgs[msgs.length - 1];
                  if (last && last.role === "assistant") {
                    msgs[msgs.length - 1] = { ...last, isStreaming: false };
                  }
                  return msgs;
                });
                break;
            }
          },
          controller.signal,
        );
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
        setMessages((current) => {
          const msgs = [...current];
          const last = msgs[msgs.length - 1];
          if (last && last.role === "assistant") {
            msgs[msgs.length - 1] = { ...last, isStreaming: false };
          }
          return msgs;
        });
      }
    },
    [selectedModel, workspacePath, isStreaming],
  );

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
    setConversationId(crypto.randomUUID());
  }, []);

  const loadChat = useCallback(
    async (id: string) => {
      if (isStreaming) return;
      const data = await loadConversation(id);
      if (!data) return;
      const loaded: DisplayMessage[] = [];
      for (const m of data.messages) {
        if (m.role === "system") continue;
        const toolCalls: DisplayToolCall[] | undefined = m.tool_calls?.map(
          (tc) => ({
            id: tc.id,
            name: tc.function.name,
            input: (() => {
              try {
                return JSON.parse(tc.function.arguments);
              } catch {
                return {};
              }
            })(),
            status: "done" as const,
          }),
        );
        let content: string;
        let parts: ContentPart[] | undefined;
        if (typeof m.content === "string") {
          content = m.content;
        } else if (Array.isArray(m.content)) {
          parts = m.content as ContentPart[];
          content = parts
            .filter((p) => p.type === "text")
            .map((p) => (p as { text: string }).text)
            .join(" ");
        } else {
          content = "";
        }
        loaded.push({
          id: crypto.randomUUID(),
          role: m.role as "user" | "assistant",
          content,
          parts,
          isStreaming: false,
          toolCalls,
        });
      }
      setMessages(loaded);
      setConversationId(`${id}`);
      setError(null);
    },
    [isStreaming],
  );

  return {
    setHovering,
    messages,
    isStreaming,
    error,
    models,
    selectedModel,
    setSelectedModel,
    sendMessage,
    stopGeneration,
    clearMessages,
    loadChat,
    conversationId,
    sidebarRefresh,
    setSidebarRefresh,
  };
}
