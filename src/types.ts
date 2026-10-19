import type { JsonSchema, Tool } from "agent-tools";

/**
 * agent-core types. agent projects shares this agent interface.
 */

export type AgentContext = {
  userId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
  /** Working memory for the current task (level 1). */
  state?: Record<string, unknown>;
};

export type ToolCallRecord = {
  id: string;
  name: string;
  input: unknown;
  output?: unknown;
  status: "running" | "success" | "error" | "denied";
  error?: { code?: string; message: string };
  durationMs?: number;
};

export type AgentResult = {
  text: string;
  toolCalls: ToolCallRecord[];
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
};

export type Agent = {
  run(input: string, ctx?: AgentContext): Promise<AgentResult>;
};

/** Messages exchanged with a model. */
export type ModelMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ModelToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export type ModelToolCall = {
  id: string;
  name: string;
  arguments: unknown;
};

export type ModelToolSpec = {
  name: string;
  description: string;
  schema: JsonSchema;
};

export type ModelInput = {
  messages: ModelMessage[];
  tools?: ModelToolSpec[];
  /** Force a specific tool ("auto" | "none" | tool name). */
  toolChoice?: "auto" | "none" | string;
};

export type ModelOutput = {
  /** Final assistant text (may be empty when the model only requested tools). */
  text: string;
  toolCalls?: ModelToolCall[];
  usage?: { inputTokens?: number; outputTokens?: number };
};

/**
 * Keep the LLM provider behind one small adapter.
 * Implementations: OpenAIModel, MockModel.
 */
export interface Model {
  run(input: ModelInput): Promise<ModelOutput>;
}

/** Anything accepted where a tool list is expected. */
export type Toolish = Tool<any, any> | ToolFactory;

/** A lazily-built tool (e.g. bound to memory/approval handles). */
export type ToolFactory = () => Tool<any, any>;