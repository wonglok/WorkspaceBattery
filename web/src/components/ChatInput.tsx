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
  const [audioFormat, setAudioFormat] = useState<string>("webm");
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
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "webm";
      setAudioFormat(ext);
    };
    reader.readAsDataURL(file);
  };

  const handleVoiceRecord = async () => {
    if (voice.isRecording) {
      const blob = await voice.stopRecording();
      const dataUri = await voice.getBase64Audio(blob);
      const base64 = dataUri.split(",")[1] ?? "";
      setAudioName("recording.wav");
      setAudioBase64(base64);
      setAudioFormat("wav");
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
        input_audio: { data: audioBase64, format: audioFormat as any },
      });
    }

    onSend(parts);
    setText("");
    setImagePreview(null);
    setImageBase64(null);
    setAudioName(null);
    setAudioBase64(null);
    setAudioFormat("webm");
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
    setAudioFormat("webm");
    if (audioInputRef.current) audioInputRef.current.value = "";
  };

  return (
    <div className="relative z-10 border-t border-gold/10 p-3" style={{ background: "rgba(250,247,242,0.6)", backdropFilter: "blur(20px) saturate(130%)", WebkitBackdropFilter: "blur(20px) saturate(130%)" }}>
      {/* Attachments preview */}
      {(imagePreview || audioName) && (
        <div className="mb-2 flex flex-wrap gap-2">
          {imagePreview && (
            <div className="inline-flex items-center gap-1.5 rounded-xl bg-white/60 px-2.5 py-1.5 font-body text-xs text-ink-soft shadow-sm backdrop-blur-sm">
              <img
                src={imagePreview}
                alt="attachment"
                className="h-8 w-8 rounded-lg object-cover"
              />
              Image
              <button
                onClick={clearImage}
                className="ml-1 text-ink-faint/40 transition-colors hover:text-rose-deep"
              >
                &#x2715;
              </button>
            </div>
          )}
          {audioName && (
            <div className="inline-flex items-center gap-1.5 rounded-xl bg-white/60 px-2.5 py-1.5 font-body text-xs text-ink-soft shadow-sm backdrop-blur-sm">
              {audioName}
              <button
                onClick={clearAudio}
                className="ml-1 text-ink-faint/40 transition-colors hover:text-rose-deep"
              >
                &#x2715;
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
          placeholder="Compose your message..."
          rows={1}
          className="flex-1 resize-none rounded-2xl border border-gold/10 bg-white/40 px-4 py-2.5 font-body text-[15px] text-ink placeholder:text-ink-faint/35 outline-none backdrop-blur-sm transition-all duration-300 focus:border-gold/25 focus:bg-white/60 focus:shadow-[0_0_24px_rgba(200,168,78,0.06)]"
        />

        {/* Image attach */}
        <button
          onClick={() => imageInputRef.current?.click()}
          disabled={isStreaming}
          className="rounded-xl p-2 text-ink-faint/30 transition-all duration-300 hover:text-gold/60 hover:bg-white/40 disabled:opacity-30"
          title="Attach image"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="h-5 w-5"
          >
            <rect x="3" y="3" width="18" height="18" rx="3" />
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
          className="rounded-xl p-2 text-ink-faint/30 transition-all duration-300 hover:text-gold/60 hover:bg-white/40 disabled:opacity-30"
          title="Attach audio"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
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
            className={`rounded-xl p-2 transition-all duration-300 disabled:opacity-30 ${
              voice.isRecording
                ? "bg-rose/40 text-rose-deep shadow-[0_0_16px_rgba(196,160,154,0.2)]"
                : "text-ink-faint/30 hover:text-rose/50 hover:bg-white/40"
            }`}
            title={
              voice.isRecording
                ? `Recording (${voice.duration}s)`
                : "Record voice"
            }
          >
            {voice.isRecording ? (
              <span className="flex items-center gap-1 font-body text-xs">
                <span className="h-2 w-2 animate-pulse rounded-full bg-rose-deep/70" />
                {voice.duration}s
              </span>
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
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
            className="rounded-xl bg-ink/5 p-2 text-ink-soft/60 transition-all duration-300 hover:bg-ink/10"
            title="Stop generation"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="h-5 w-5"
            >
              <rect x="7" y="7" width="10" height="10" rx="2" />
            </svg>
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!text.trim() && !imageBase64 && !audioBase64}
            className="rounded-xl p-2 transition-all duration-300 disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              background: "linear-gradient(135deg, rgba(200,168,78,0.7), rgba(180,148,58,0.8))",
              color: "#faf7f2",
              boxShadow: "0 2px 12px rgba(200,168,78,0.2)",
            }}
            title="Send message"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="h-4 w-4"
            >
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22,2 15,22 11,13 2,9" />
            </svg>
          </button>
        )}
      </div>

      {/* Model selector */}
      <div className="mt-2 flex items-center gap-2">
        <label className="font-body text-[11px] italic tracking-wide text-ink-faint/40">
          Model
        </label>
        <select
          value={selectedModel}
          onChange={(e) => onModelChange(e.target.value)}
          disabled={isStreaming || models.length === 0}
          className="flex-1 rounded-xl border border-gold/8 bg-white/35 px-3 py-1 font-body text-xs text-ink-soft outline-none backdrop-blur-sm transition-all duration-300 focus:border-gold/20 disabled:opacity-40"
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
