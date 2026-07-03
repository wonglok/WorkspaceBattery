import { useState, useRef, useCallback } from "react";
import { useVoiceRecorder } from "../hooks/useVoiceRecorder";
import type { ContentPart } from "../types";

interface Props {
  onSend: (parts: ContentPart[]) => void;
  isStreaming: boolean;
  onStop: () => void;
  models: string[];
  selectedModel: string;
  onModelChange: (model: string) => void;
}

export function ChatInput({
  onSend,
  isStreaming,
  onStop,
  models,
  selectedModel,
  onModelChange,
}: Props) {
  const [text, setText] = useState("");
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [audioName, setAudioName] = useState<string | null>(null);
  const [audioBase64, setAudioBase64] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const voice = useVoiceRecorder();

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  const handleImageAttach = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUri = reader.result as string;
      setImagePreview(dataUri);
      setImageBase64(dataUri);
    };
    reader.readAsDataURL(file);
  };

  const handleAudioAttach = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUri = reader.result as string;
      const base64 = dataUri.split(",")[1] ?? "";
      setAudioName(file.name);
      setAudioBase64(base64);
    };
    reader.readAsDataURL(file);
  };

  const handleVoiceRecord = async () => {
    if (voice.isRecording) {
      const blob = await voice.stopRecording();
      const dataUri = await voice.getBase64Audio(blob);
      const base64 = dataUri.split(",")[1] ?? "";
      setAudioName("recording.webm");
      setAudioBase64(base64);
    } else {
      await voice.startRecording();
    }
  };

  const handleSend = () => {
    const hasContent = text.trim() || imageBase64 || audioBase64;
    if (!hasContent || isStreaming) return;

    const parts: ContentPart[] = [];
    if (text.trim()) {
      parts.push({ type: "text", text: text.trim() });
    }
    if (imageBase64) {
      parts.push({
        type: "image_url",
        image_url: { url: imageBase64, detail: "auto" },
      });
    }
    if (audioBase64) {
      parts.push({
        type: "input_audio",
        input_audio: { data: audioBase64, format: "webm" },
      });
    }

    onSend(parts);
    setText("");
    setImagePreview(null);
    setImageBase64(null);
    setAudioName(null);
    setAudioBase64(null);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const clearImage = () => {
    setImagePreview(null);
    setImageBase64(null);
    if (imageInputRef.current) imageInputRef.current.value = "";
  };

  const clearAudio = () => {
    setAudioName(null);
    setAudioBase64(null);
    if (audioInputRef.current) audioInputRef.current.value = "";
  };

  return (
    <div className="border-t border-zinc-800 bg-zinc-950 p-3">
      {/* Attachments preview */}
      {(imagePreview || audioName) && (
        <div className="mb-2 flex flex-wrap gap-2">
          {imagePreview && (
            <div className="relative inline-flex items-center gap-1 rounded-lg bg-zinc-800 px-2 py-1 text-xs text-zinc-300">
              <img
                src={imagePreview}
                alt="attachment"
                className="h-8 w-8 rounded object-cover"
              />
              Image
              <button
                onClick={clearImage}
                className="ml-1 text-zinc-500 hover:text-zinc-200"
              >
                x
              </button>
            </div>
          )}
          {audioName && (
            <div className="relative inline-flex items-center gap-1 rounded-lg bg-zinc-800 px-2 py-1 text-xs text-zinc-300">
              {audioName}
              <button
                onClick={clearAudio}
                className="ml-1 text-zinc-500 hover:text-zinc-200"
              >
                x
              </button>
            </div>
          )}
        </div>
      )}

      {/* Input row */}
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            adjustHeight();
          }}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          rows={1}
          className="flex-1 resize-none rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-violet-600"
        />

        {/* Image attach */}
        <button
          onClick={() => imageInputRef.current?.click()}
          disabled={isStreaming}
          className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40"
          title="Attach image"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="h-5 w-5"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21,15 16,10 5,21" />
          </svg>
        </button>
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          onChange={handleImageAttach}
          className="hidden"
        />

        {/* Audio attach */}
        <button
          onClick={() => audioInputRef.current?.click()}
          disabled={isStreaming}
          className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40"
          title="Attach audio"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="h-5 w-5"
          >
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
          </svg>
        </button>
        <input
          ref={audioInputRef}
          type="file"
          accept="audio/*"
          onChange={handleAudioAttach}
          className="hidden"
        />

        {/* Voice record */}
        {voice.isSupported && (
          <button
            onClick={handleVoiceRecord}
            disabled={isStreaming}
            className={`rounded-lg p-2 transition-colors disabled:opacity-40 ${
              voice.isRecording
                ? "bg-red-600 text-white hover:bg-red-500"
                : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            }`}
            title={
              voice.isRecording
                ? `Recording (${voice.duration}s)`
                : "Record voice"
            }
          >
            {voice.isRecording ? (
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
                {voice.duration}s
              </span>
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="h-5 w-5"
              >
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            )}
          </button>
        )}

        {/* Send / Stop */}
        {isStreaming ? (
          <button
            onClick={onStop}
            className="rounded-lg bg-zinc-700 p-2 text-zinc-200 transition-colors hover:bg-zinc-600"
            title="Stop generation"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="h-5 w-5"
            >
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!text.trim() && !imageBase64 && !audioBase64}
            className="rounded-lg bg-violet-600 p-2 text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
            title="Send message"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="h-5 w-5"
            >
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22,2 15,22 11,13 2,9" />
            </svg>
          </button>
        )}
      </div>

      {/* Model selector */}
      <div className="mt-2 flex items-center gap-2">
        <label className="text-xs text-zinc-500">Model:</label>
        <select
          value={selectedModel}
          onChange={(e) => onModelChange(e.target.value)}
          disabled={isStreaming || models.length === 0}
          className="flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-300 outline-none disabled:opacity-50"
        >
          {models.length === 0 ? (
            <option value="">No models available</option>
          ) : (
            models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))
          )}
        </select>
      </div>
    </div>
  );
}
