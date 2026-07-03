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
      <div className="flex min-h-screen items-center justify-center bg-zinc-950">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-600 border-t-violet-500" />
      </div>
    );
  }

  return <ChatScreen workspacePath={workspacePath} />;
}

export default App;
