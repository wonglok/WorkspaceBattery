import { useEffect, useRef } from "react";
import { useChat } from "../hooks/useChat";
import { ChatInput } from "./ChatInput";

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
  } = useChat(workspacePath);

  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const displayPath =
    workspacePath.length > 40
      ? "..." + workspacePath.slice(-37)
      : workspacePath;

  return (
    <div className="flex h-screen flex-col bg-zinc-950">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
        <div className="flex items-center gap-2 text-sm text-zinc-400">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="h-4 w-4"
          >
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          <span className="font-mono text-xs" title={workspacePath}>
            {displayPath}
          </span>
        </div>
        <button
          onClick={clearMessages}
          className="text-xs text-zinc-500 transition-colors hover:text-zinc-300"
        >
          Clear chat
        </button>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-zinc-500">
              Send a message to start chatting about your workspace.
            </p>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${
                  msg.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[80%] rounded-xl px-4 py-3 text-sm ${
                    msg.role === "user"
                      ? "bg-violet-600 text-white"
                      : "bg-zinc-800 text-zinc-200"
                  }`}
                >
                  {/* Thinking */}
                  {msg.thinking && (
                    <details className="mb-2">
                      <summary className="cursor-pointer text-xs text-zinc-400">
                        Thinking...
                      </summary>
                      <p className="mt-1 whitespace-pre-wrap text-xs text-zinc-500">
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
                            className="mb-2 max-h-48 rounded-lg object-contain"
                          />
                        );
                      }
                      if (part.type === "input_audio") {
                        return (
                          <audio
                            key={i}
                            controls
                            className="mb-2 w-full"
                            src={`data:audio/webm;base64,${part.input_audio.data}`}
                          />
                        );
                      }
                      return null;
                    })}

                  {/* Text content */}
                  {msg.content && (
                    <p className="whitespace-pre-wrap break-words">
                      {msg.content}
                      {msg.isStreaming && (
                        <span className="ml-0.5 inline-block h-4 w-1 animate-pulse bg-zinc-400" />
                      )}
                    </p>
                  )}

                  {/* Tool calls */}
                  {msg.toolCalls && msg.toolCalls.length > 0 && (
                    <div className="mt-2 space-y-1 border-t border-zinc-700 pt-2">
                      {msg.toolCalls.map((tc) => (
                        <div
                          key={tc.id}
                          className="rounded bg-zinc-900 px-2 py-1 text-xs"
                        >
                          <span className="font-mono text-violet-400">
                            {tc.name}
                          </span>
                          <span className="text-zinc-500">
                            {" "}
                            ({JSON.stringify(tc.input)})
                          </span>
                          {tc.status === "running" && (
                            <span className="ml-2 animate-pulse text-zinc-500">
                              running...
                            </span>
                          )}
                          {tc.status === "done" && (
                            <span className="ml-2 text-green-500">done</span>
                          )}
                          {tc.status === "error" && (
                            <span className="ml-2 text-red-400">error</span>
                          )}
                          {tc.output && (
                            <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap text-zinc-500 text-[10px]">
                              {tc.output.length > 300
                                ? tc.output.slice(0, 300) + "..."
                                : tc.output}
                            </pre>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Error toast */}
      {error && (
        <div className="mx-4 mb-1 rounded-lg border border-red-800 bg-red-950 px-3 py-2 text-xs text-red-400">
          {error}
        </div>
      )}

      {/* Input */}
      <ChatInput
        onSend={sendMessage}
        isStreaming={isStreaming}
        onStop={stopGeneration}
        models={models}
        selectedModel={selectedModel}
        onModelChange={setSelectedModel}
      />
    </div>
  );
}
