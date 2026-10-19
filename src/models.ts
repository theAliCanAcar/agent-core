import type { Model, ModelInput, ModelMessage, ModelOutput, ModelToolCall } from "./types";

/**
 * Model adapters. The rest of the kit never sees provider-specific code.
 */

/** MockModel: scripted outputs for fast local testing. */
export class MockModel implements Model {
  private readonly queue: ModelOutput[];
  public readonly inputs: ModelInput[] = [];

  constructor(outputs: ModelOutput[] = []) {
    this.queue = [...outputs];
  }

  enqueue(output: ModelOutput): this {
    this.queue.push(output);
    return this;
  }

  async run(input: ModelInput): Promise<ModelOutput> {
    this.inputs.push(input);
    const next = this.queue.shift();
    return next ?? { text: "", toolCalls: [] };
  }
}

export type OpenAIModelConfig = {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  temperature?: number;
  maxOutputTokens?: number;
  fetchImpl?: typeof fetch;
};

/**
 * OpenAIModel: structured tool calling over the Chat Completions API.
 * Uses plain fetch — no SDK coupling in agent projects.
 */
export class OpenAIModel implements Model {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly temperature?: number;
  private readonly maxOutputTokens?: number;
  private readonly doFetch: typeof fetch;

  constructor(config: OpenAIModelConfig = {}) {
    this.apiKey = config.apiKey ?? process.env.OPENAI_API_KEY ?? "";
    this.model = config.model ?? "gpt-4o-mini";
    this.baseUrl = (config.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
    this.temperature = config.temperature;
    this.maxOutputTokens = config.maxOutputTokens;
    this.doFetch = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async run(input: ModelInput): Promise<ModelOutput> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: input.messages.map(toOpenAIMessage),
      ...(input.tools?.length
        ? {
            tools: input.tools.map((t) => ({
              type: "function",
              function: {
                name: t.name,
                description: t.description,
                parameters: t.schema,
              },
            })),
          }
        : {}),
      ...(input.toolChoice && input.tools?.length
        ? {
            tool_choice:
              input.toolChoice === "auto" || input.toolChoice === "none"
                ? input.toolChoice
                : { type: "function", function: { name: input.toolChoice } },
          }
        : {}),
      ...(this.temperature !== undefined ? { temperature: this.temperature } : {}),
      ...(this.maxOutputTokens !== undefined ? { max_tokens: this.maxOutputTokens } : {}),
    };

    const res = await this.doFetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`OpenAI chat/completions -> HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    const parsed = JSON.parse(text) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{
            id: string;
            function?: { name?: string; arguments?: string };
          }>;
        };
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const message = parsed.choices?.[0]?.message;
    const toolCalls: ModelToolCall[] | undefined = message?.tool_calls?.map((call) => ({
      id: call.id,
      name: call.function?.name ?? "",
      arguments: safeJson(call.function?.arguments ?? "{}"),
    }));

    return {
      text: message?.content ?? "",
      ...(toolCalls?.length ? { toolCalls } : {}),
      ...(parsed.usage
        ? {
            usage: {
              ...(parsed.usage.prompt_tokens !== undefined
                ? { inputTokens: parsed.usage.prompt_tokens }
                : {}),
              ...(parsed.usage.completion_tokens !== undefined
                ? { outputTokens: parsed.usage.completion_tokens }
                : {}),
            },
          }
        : {}),
    };
  }
}

function toOpenAIMessage(message: ModelMessage): Record<string, unknown> {
  switch (message.role) {
    case "tool":
      return {
        role: "tool",
        tool_call_id: message.toolCallId,
        content: message.content,
      };
    case "assistant":
      return {
        role: "assistant",
        content: message.content,
        ...(message.toolCalls?.length
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: "function",
                function: {
                  name: call.name,
                  arguments: JSON.stringify(call.arguments ?? {}),
                },
              })),
            }
          : {}),
      };
    default:
      return { role: message.role, content: message.content };
  }
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}