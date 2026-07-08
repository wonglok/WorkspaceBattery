import { useState, useEffect } from "react";
import { getConfig } from "./api";
import { ChatScreen } from "./components/ChatScreen";

function App() {
  const [workspacePath, setWorkspacePath] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getConfig()
      .then((config) => {
        if (config.workspace) setWorkspacePath(config.workspace);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        style={{
          background:
            "linear-gradient(170deg, #faf7f2 0%, #f6efe5 30%, #eef0f5 70%, #f5eee5 100%)",
        }}
      >
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-amber-300/30 border-t-amber-400/70" />
          <span className="font-display text-sm italic text-ink-faint tracking-wide">
            Preparing your workspace...
          </span>
        </div>
      </div>
    );
  }

  return <ChatScreen workspacePath={workspacePath} />;
}

export default App;

//
