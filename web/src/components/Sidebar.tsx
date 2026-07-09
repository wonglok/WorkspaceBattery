import { useEffect, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { listConversations, deleteConversation } from "../api";
import type { ConversationSummary } from "../types";

interface Props {
  activeId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRefresh: number;
  open: boolean;
  onToggle: () => void;
}

export function Sidebar({
  activeId,
  onSelect,
  onNew,
  onRefresh,
  open,
  onToggle,
}: Props) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  const fetchList = useCallback(async () => {
    const list = await listConversations();
    setConversations(list);
  }, []);

  useEffect(() => {
    fetchList();
  }, [fetchList, onRefresh]);

  // Focus confirm button & listen for Enter/Esc
  useEffect(() => {
    if (deleteTarget) {
      confirmRef.current?.focus();
      const handler = (e: KeyboardEvent) => {
        if (e.key === "Escape") setDeleteTarget(null);
      };
      window.addEventListener("keydown", handler);
      return () => window.removeEventListener("keydown", handler);
    }
  }, [deleteTarget]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const ok = await deleteConversation(deleteTarget);
    if (ok) {
      if (deleteTarget === activeId) onNew();
      fetchList();
    }
    setDeleteTarget(null);
  };

  const handleDeleteClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setDeleteTarget(id);
  };

  return (
    <>
      {/* Toggle button */}
      <button
        onClick={onToggle}
        className="fixed left-0 top-1/2 z-30 -translate-y-1/2 rounded-r-lg bg-white/50 px-1.5 py-4 text-ink-faint/40 shadow-sm backdrop-blur-sm transition-all hover:text-ink-faint/60"
        title={open ? "Close sidebar" : "Open sidebar"}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="h-4 w-4 transition-transform"
          style={{ transform: open ? "rotate(0deg)" : "rotate(180deg)" }}
        >
          <polyline points="15,18 9,12 15,6" />
        </svg>
      </button>

      {/* Sidebar panel */}
      <div
        className="fixed left-0 top-0 z-20 flex h-full w-64 flex-col border-r border-gold/10 shadow-lg transition-transform duration-300"
        style={{
          background: "rgba(250,247,242,0.85)",
          backdropFilter: "blur(20px) saturate(130%)",
          WebkitBackdropFilter: "blur(20px) saturate(130%)",
          transform: open ? "translateX(0)" : "translateX(-100%)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gold/10 px-4 py-3">
          <span className="font-body text-sm font-semibold tracking-wide text-ink-soft">
            Conversations
          </span>
          <button
            onClick={() => {
              onNew();
              fetchList();
            }}
            className="rounded-lg p-1.5 text-ink-faint/40 transition-all hover:bg-white/40 hover:text-ink-faint/60"
            title="New conversation"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="h-4 w-4"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 ? (
            <p className="px-4 py-8 text-center font-body text-xs text-ink-faint/35">
              No saved conversations yet
            </p>
          ) : (
            conversations.map((c) => (
              <button
                key={c.id}
                onClick={() => onSelect(c.id)}
                className={`group relative flex w-full items-start gap-1 px-4 py-3 text-left transition-all hover:bg-white/40 ${
                  c.id === activeId
                    ? "border-r-2 border-gold/60 bg-white/30"
                    : "border-r-2 border-transparent"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="font-body text-xs text-ink-soft line-clamp-2 leading-relaxed">
                    {c.preview || "Empty conversation"}
                  </div>
                  <div className="mt-1 font-body text-[10px] text-ink-faint/35">
                    {c.savedAt
                      ? new Date(c.savedAt).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : ""}
                  </div>
                </div>
                {/* Delete button — visible on hover */}
                <span
                  onClick={(e) => handleDeleteClick(e, c.id)}
                  className="mt-0.5 shrink-0 rounded p-0.5 text-ink-faint/20 opacity-0 transition-all hover:bg-rose/10 hover:text-rose-deep/60 group-hover:opacity-100"
                  title="Delete conversation"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    className="h-3.5 w-3.5"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </span>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Delete confirmation modal — portaled to body */}
      {deleteTarget &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
            onClick={() => setDeleteTarget(null)}
          >
            <div
              className="mx-4 w-full max-w-sm rounded-2xl bg-white/90 p-6 shadow-2xl backdrop-blur-md"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="font-body text-sm text-ink">
                Delete this conversation?
              </p>
              <p className="mt-1 font-body text-xs text-ink-faint/50">
                This action cannot be undone.
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  onClick={() => setDeleteTarget(null)}
                  className="rounded-xl px-4 py-2 font-body text-xs text-ink-faint/50 transition-all hover:bg-white/50"
                >
                  Cancel
                </button>
                <button
                  ref={confirmRef}
                  onClick={handleDelete}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleDelete();
                    }
                  }}
                  className="rounded-xl bg-rose-deep/80 px-4 py-2 font-body text-xs text-white transition-all hover:bg-rose-deep"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
