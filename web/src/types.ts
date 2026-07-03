export type ContentPart =
  | { type: "text"; text: string }
  | {
      type: "image_url";
      image_url: { url: string; detail?: "auto" | "low" | "high" };
    }
  | {
      type: "input_audio";
      input_audio: { data: string; format: "mp3" | "wav" | "ogg" | "webm" };
    };

export type MessageRole = "user" | "assistant" | "system";

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: MessageRole;
  content: string | ContentPart[];
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export type SSEEvent =
  | { type: "content"; delta: string }
  | { type: "think"; delta: string }
  | {
      type: "tool_start";
      id: string;
      name: string;
      input: Record<string, unknown>;
    }
  | { type: "tool_result"; id: string; name: string; output: string }
  | { type: "error"; message: string }
  | { type: "done" };

export interface WorkspaceConfig {
  workspace?: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  model: string;
  workspace: string;
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface DisplayMessage {
  id: string;
  role: MessageRole;
  content: string;
  parts?: ContentPart[];
  thinking?: string;
  toolCalls?: DisplayToolCall[];
  isStreaming: boolean;
}

export interface DisplayToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: string;
  status: "running" | "done" | "error";
}
