import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useChat } from "../hooks/useChat";
import { ChatInput } from "./ChatInput";
import { Sidebar } from "./Sidebar";

interface Props {
  workspacePath: string;
}

export function ChatScreen({ workspacePath }: Props) {
  const {
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
    setHovering,
  } = useChat(workspacePath);

  const [sidebarOpen, setSidebarOpen] = useState(true);

  const bottomRef = useRef<HTMLDivElement>(null);

  const wasStreaming = useRef(isStreaming);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Refresh sidebar when a conversation finishes
  useEffect(() => {
    if (wasStreaming.current && !isStreaming && messages.length > 0) {
      setSidebarRefresh((n) => n + 1);
    }
    wasStreaming.current = isStreaming;
  }, [isStreaming, messages.length, setSidebarRefresh]);

  const displayPath =
    workspacePath.length > 40
      ? "..." + workspacePath.slice(-37)
      : workspacePath;

  // const hasMedia = (msg: { parts?: { type: string }[] }) =>
  //   msg.parts?.some(
  //     (p) => p.type === "image_url" || p.type === "input_audio",
  //   ) ?? false;

  return (
    <div
      className="relative flex h-screen flex-col overflow-hidden transition-[padding-left] duration-300"
      style={{
        background:
          "linear-gradient(170deg, #faf7f2 0%, #f6efe5 15%, #f2e8e0 30%, #eef0f5 50%, #f0e8e2 65%, #f5eee5 80%, #faf6f0 100%)",
        paddingLeft: sidebarOpen ? "16rem" : "0",
      }}
    >
      {/* Cloud wisps */}
      <div className="cloud-wisp cloud-wisp-1" />
      <div className="cloud-wisp cloud-wisp-2" />
      <div className="cloud-wisp cloud-wisp-3" />
      <div className="cloud-wisp cloud-wisp-4" />

      {/* Sidebar */}
      <Sidebar
        activeId={conversationId}
        onSelect={loadChat}
        onNew={() => {
          clearMessages();
          setSidebarRefresh((n) => n + 1);
        }}
        onRefresh={sidebarRefresh}
        open={sidebarOpen}
        onToggle={() => setSidebarOpen((o) => !o)}
      />

      {/* Header */}
      <header className="glass-strong filigree-border relative z-10 flex items-center justify-between px-5 py-3">
        <div className="header-path-mono">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="header-path-icon"
          >
            <path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2l-2-2H9L7 5H5a2 2 0 0 0-2 2Z" />
            <path d="M12 12v5" strokeWidth="1" />
            <path d="M9.5 14.5 12 12l2.5 2.5" strokeWidth="1" />
          </svg>
          <span className="header-path-text" title={workspacePath}>
            {displayPath}
          </span>
        </div>
      </header>

      {/* Messages */}
      <div className="relative z-10 flex-1 overflow-y-auto px-4 py-6">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-6">
            {/* Decorative ornament */}
            <div className="flex items-center gap-4">
              <div className="h-px w-12 bg-linear-to-r from-transparent to-gold/20" />
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 32 32"
                fill="none"
                className="h-8 w-8"
              >
                <circle
                  cx="16"
                  cy="16"
                  r="15"
                  stroke="rgba(200,168,78,0.15)"
                  strokeWidth="1"
                />
                <circle
                  cx="16"
                  cy="16"
                  r="8"
                  stroke="rgba(200,168,78,0.2)"
                  strokeWidth="0.5"
                />
                <circle cx="16" cy="16" r="2" fill="rgba(200,168,78,0.25)" />
                <line
                  x1="16"
                  y1="1"
                  x2="16"
                  y2="5"
                  stroke="rgba(200,168,78,0.2)"
                  strokeWidth="0.5"
                />
                <line
                  x1="16"
                  y1="27"
                  x2="16"
                  y2="31"
                  stroke="rgba(200,168,78,0.2)"
                  strokeWidth="0.5"
                />
                <line
                  x1="1"
                  y1="16"
                  x2="5"
                  y2="16"
                  stroke="rgba(200,168,78,0.2)"
                  strokeWidth="0.5"
                />
                <line
                  x1="27"
                  y1="16"
                  x2="31"
                  y2="16"
                  stroke="rgba(200,168,78,0.2)"
                  strokeWidth="0.5"
                />
              </svg>
              <div className="h-px w-12 bg-linear-to-l from-transparent to-gold/20" />
            </div>
            <div className="empty-editorial">
              <p className="editorial-main">Begin a conversation</p>
              <div className="editorial-rule" />
              <p className="editorial-sub">with your workspace</p>
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-5">
            {messages.map((msg, idx) => {
              const isUser = msg.role === "user";
              const isFirst = idx === 0;
              return (
                <div
                  key={msg.id}
                  className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`
                      relative max-w-[78%] px-5 py-3 text-base leading-relaxed
                      ${
                        isUser
                          ? "rounded-2xl rounded-br-md bg-[#f0e8cc]/60 text-ink shadow-sm border border-gold/15"
                          : `glass rounded-2xl rounded-bl-md ${isFirst ? "drop-cap" : ""}`
                      }
                    `}
                  >
                    {/* Assistant message ornament */}
                    {!isUser && (
                      <div className="absolute -left-3 -top-3 h-6 w-6">
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          className="h-full w-full"
                        >
                          <circle
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="rgba(200,168,78,0.2)"
                            strokeWidth="0.5"
                          />
                          <circle
                            cx="12"
                            cy="12"
                            r="3"
                            fill="rgba(200,168,78,0.15)"
                          />
                        </svg>
                      </div>
                    )}

                    {/* Thinking */}
                    {msg.thinking && (
                      <details
                        open={msg.thinking.length > 0 && !msg.content}
                        className="mb-2"
                      >
                        <summary className="cursor-pointer font-body text-xs italic tracking-wide text-ink-faint/50 transition-colors hover:text-gold/70">
                          Reflection...
                        </summary>
                        <p className="mt-1 whitespace-pre-wrap font-body text-sm italic leading-relaxed text-ink-faint/60">
                          {msg.thinking}
                        </p>
                      </details>
                    )}

                    {/* Content parts (user messages with images/audio) */}
                    {msg.parts &&
                      msg.parts.map((part, i) => {
                        if (part.type === "image_url") {
                          return (
                            <img
                              key={i}
                              src={part.image_url.url}
                              alt="attachment"
                              className="mb-2 max-h-48 rounded-xl object-contain"
                            />
                          );
                        }

                        if (part.type === "input_audio") {
                          return (
                            <div className="min-w-[260px]">
                              <audio
                                key={i}
                                controls
                                className="mb-2 w-full"
                                src={`data:audio/wav;base64,${part.input_audio.data}`}
                              />
                            </div>
                          );
                        }

                        if (part.type === "video") {
                          return (
                            <div key={i} className="min-w-[260px]">
                              <video
                                controls
                                className="mb-2 max-h-64 w-full rounded-xl object-contain"
                                src={`data:video/${part.video.format};base64,${part.video.data}`}
                              />
                            </div>
                          );
                        }
                        return null;
                      })}

                    {/* Text content */}
                    {msg.content && !isUser && (
                      <div className="prose max-w-none font-body text-base leading-relaxed text-ink prose-headings:font-display prose-headings:text-ink prose-headings:font-medium prose-a:text-gold prose-a:no-underline hover:prose-a:underline prose-code:font-mono prose-code:text-xs prose-code:bg-white/40 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-ink-soft prose-pre:bg-white/30 prose-pre:backdrop-blur-sm prose-pre:rounded-xl prose-pre:text-sm prose-strong:text-ink prose-em:italic prose-em:text-ink-soft prose-li:marker:text-gold/40">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {msg.content}
                        </ReactMarkdown>
                        {msg.isStreaming && (
                          <span className="ml-0.5 inline-block h-4 w-1 animate-pulse rounded-full bg-gold/50" />
                        )}
                      </div>
                    )}

                    {msg.content && isUser && (
                      <p className="whitespace-pre-wrap wrap-break-word font-body text-base leading-relaxed">
                        {typeof msg.content === "string" ? msg.content : ""}
                      </p>
                    )}

                    {/* Tool calls */}
                    {msg.toolCalls && msg.toolCalls.length > 0 && (
                      <div className="mt-3 space-y-1.5 border-t border-gold/10 pt-3">
                        {msg.toolCalls.map((tc) => (
                          <div
                            key={tc.id}
                            className="rounded-xl bg-white/30 px-3 py-1.5 font-body text-xs backdrop-blur-sm"
                          >
                            <span className="font-semibold tracking-wide text-gold">
                              {tc.name}
                            </span>
                            <span className="text-ink-faint/70">
                              {" "}
                              ({JSON.stringify(tc.input)})
                            </span>
                            {tc.status === "running" && (
                              <span className="ml-2 inline-flex items-center gap-1 text-ink-faint/50">
                                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gold/40" />
                                working...
                              </span>
                            )}
                            {tc.status === "done" && (
                              <span className="ml-2 text-emerald-600/60">
                                complete
                              </span>
                            )}
                            {tc.status === "error" && (
                              <span className="ml-2 text-rose-400">error</span>
                            )}
                            {tc.output &&
                            tc.name === "displayImage" &&
                            tc.status === "done" ? (
                              (() => {
                                // const m =
                                //   tc.output.match(/^!\[(.*)\]\((.*)\)$/);
                                // if (m) {
                                //   return (
                                //     <img
                                //       src={m[2]}
                                //       alt={m[1]}
                                //       className="mt-1 max-h-64 max-w-full rounded-xl object-contain"
                                //     />
                                //   );
                                // }

                                return (
                                  <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap font-body text-[10px] leading-relaxed text-ink-faint/50">
                                    {tc.output}
                                  </pre>
                                );
                              })()
                            ) : tc.output ? (
                              <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap font-body text-[10px] leading-relaxed text-ink-faint/50">
                                {tc.output.length > 300
                                  ? tc.output.slice(0, 300) + "..."
                                  : tc.output}
                              </pre>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Error toast */}
      {error && (
        <div className="relative z-10 mx-4 mb-1 rounded-2xl border border-rose/30 bg-white/50 px-4 py-2.5 font-body text-sm text-rose-deep backdrop-blur-md">
          {error}
        </div>
      )}

      {/* Input */}
      <ChatInput
        setHovering={setHovering}
        onSend={sendMessage}
        isStreaming={isStreaming}
        onStop={stopGeneration}
        models={models}
        selectedModel={selectedModel}
        onModelChange={setSelectedModel}
        conversationId={conversationId}
      />
    </div>
  );
}
