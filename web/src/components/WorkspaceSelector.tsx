import { useState } from "react";
import { pickFolder, saveConfig } from "../api";

interface Props {
  onConfirm: (path: string) => void;
}

export function WorkspaceSelector({ onConfirm }: Props) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [isPicking, setIsPicking] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePickFolder = async () => {
    setIsPicking(true);
    setError(null);
    try {
      const path = await pickFolder();
      if (path) {
        setSelectedPath(path);
      }
    } catch {
      setError("Failed to open folder picker");
    } finally {
      setIsPicking(false);
    }
  };

  const handleConfirm = async () => {
    if (!selectedPath) return;
    setIsSaving(true);
    setError(null);
    try {
      await saveConfig({ workspace: selectedPath });
      onConfirm(selectedPath);
    } catch {
      setError("Failed to save workspace config");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-6">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-8 shadow-2xl">
        <h1 className="mb-2 text-2xl font-semibold text-zinc-100">
          Workspace Battery
        </h1>
        <p className="mb-6 text-sm text-zinc-400">
          Select a workspace folder to get started. The AI assistant will be
          able to read, write, and list files within this folder.
        </p>

        <button
          onClick={handlePickFolder}
          disabled={isPicking}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-3 text-left text-sm text-zinc-200 transition-colors hover:border-zinc-600 hover:bg-zinc-700 disabled:opacity-50"
        >
          {isPicking ? (
            <span className="text-zinc-400">Opening folder picker...</span>
          ) : selectedPath ? (
            <span className="text-zinc-100">{selectedPath}</span>
          ) : (
            <span className="text-zinc-400">Pick a folder...</span>
          )}
        </button>

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

        <button
          onClick={handleConfirm}
          disabled={!selectedPath || isSaving}
          className="mt-4 w-full rounded-lg bg-violet-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isSaving ? "Saving..." : "Confirm Workspace"}
        </button>
      </div>
    </div>
  );
}
