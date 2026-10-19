import type { ApprovalGate } from "agent-approval";
import type { AuditLogger } from "agent-audit";
import type { Memory } from "agent-memory";
import { runTool, type Tool, type ToolContext } from "agent-tools";
import { MockModel } from "./models";
import type {
  Agent,
  AgentContext,
  AgentResult,
  Model,
  ModelMessage,
  ToolCallRecord,
  Toolish,
} from "./types";

export type AgentOptions = {
  name: string;
  instructions: string;
  tools?: Toolish[];
  /** Defaults to MockModel — pass OpenAIModel in real projects. */
  model?: Model;
  memory?: Memory;
  audit?: AuditLogger;
  approval?: ApprovalGate;
  /** Max model<->tool rounds per run. Default 8. */
  maxSteps?: number;
};

/**
 * createAgent: the shared agent interface for agent projects.
 *
 *   const agent = createAgent({
 *     name: "Invoice Agent",
 *     instructions: `Find unpaid invoices...`,
 *     tools: [invoices.list, invoices.get, email.draft],
 *   });
 *   const result = await agent.run("Handle this week's overdue invoices.");
 */
export function createAgent(options: AgentOptions): Agent {
  const tools: Tool<any, any>[] = (options.tools ?? []).map((t) =>
    typeof t === "function" ? (t as () => Tool<any, any>)() : t
  );
  const byName = new Map(tools.map((t) => [t.name, t]));
  const model = options.model ?? new MockModel();
  const maxSteps = options.maxSteps ?? 8;

  return {
    async run(input: string, ctx: AgentContext = {}): Promise<AgentResult> {
      const sessionId = ctx.sessionId ?? "default";
      const startedAt = Date.now();
      const toolCalls: ToolCallRecord[] = [];
      const usage = { inputTokens: 0, outputTokens: 0 };

      await options.audit?.log({
        agentId: options.name,
        sessionId,
        type: "run_started",
        input,
        status: "pending",
      });

      try {
        // Level 2 memory: replay prior session events into the conversation.
        const messages: ModelMessage[] = [{ role: "system", content: options.instructions }];
        if (options.memory) {
          const history = await options.memory.session.get(sessionId);
          for (const event of history) {
            if (event.text) messages.push({ role: "user", content: event.text });
          }
        }
        messages.push({ role: "user", content: input });

        let text = "";
        for (let step = 0; step < maxSteps; step++) {
          const output = await model.run({
            messages,
            tools: tools.map((t) => ({
              name: t.name,
              description: t.description,
              schema: t.schema,
            })),
            toolChoice: tools.length ? "auto" : "none",
          });

          if (output.usage) {
            usage.inputTokens += output.usage.inputTokens ?? 0;
            usage.outputTokens += output.usage.outputTokens ?? 0;
          }
          text = output.text || text;

          if (!output.toolCalls?.length) break;

          messages.push({
            role: "assistant",
            content: output.text,
            toolCalls: output.toolCalls,
          });

          for (const call of output.toolCalls) {
            const record: ToolCallRecord = {
              id: call.id,
              name: call.name,
              input: call.arguments,
              status: "running",
            };
            toolCalls.push(record);
            const startedTool = Date.now();
            await options.audit?.log({
              agentId: options.name,
              sessionId,
              type: "tool_called",
              action: call.name,
              input: call.arguments,
              status: "pending",
            });

            const tool = byName.get(call.name);
            if (!tool) {
              record.status = "error";
              record.error = { code: "NOT_FOUND", message: `Unknown tool: ${call.name}` };
              messages.push({
                role: "tool",
                toolCallId: call.id,
                name: call.name,
                content: JSON.stringify({ ok: false, error: record.error }),
              });
              continue;
            }

            // Safety layer: gate side-effecting actions behind approval.
            if (options.approval && options.approval.evaluate(call.name) === "required") {
              await options.audit?.log({
                agentId: options.name,
                sessionId,
                type: "approval_requested",
                action: call.name,
                input: call.arguments,
                status: "pending",
              });
              const decision = await options.approval.request({
                action: call.name,
                description: `Run tool ${call.name}`,
                payload: call.arguments,
              });
              await options.audit?.log({
                agentId: options.name,
                sessionId,
                type: "approval_completed",
                action: call.name,
                status: decision.approved ? "success" : "denied",
                output: decision,
              });
              if (!decision.approved) {
                record.status = "denied";
                record.error = {
                  code: "APPROVAL_DENIED",
                  message: decision.reason ?? "Action denied by reviewer.",
                };
                messages.push({
                  role: "tool",
                  toolCallId: call.id,
                  name: call.name,
                  content: JSON.stringify({ ok: false, error: record.error }),
                });
                continue;
              }
            }

            const toolCtx: ToolContext = {
              userId: ctx.userId,
              sessionId,
              state: ctx.state ?? {},
              ...(options.memory ? { memory: options.memory } : {}),
              ...(options.audit ? { audit: options.audit } : {}),
              ...(options.approval ? { approval: options.approval } : {}),
              ...ctx.metadata,
            };

            const outcome = await runTool(tool, call.arguments, toolCtx);
            record.durationMs = Date.now() - startedTool;
            record.output = outcome.ok ? outcome.value : undefined;
            if (outcome.ok) {
              record.status = "success";
            } else {
              record.status = "error";
              record.error = outcome.error;
            }

            await options.audit?.log({
              agentId: options.name,
              sessionId,
              type: "tool_completed",
              action: call.name,
              input: call.arguments,
              output: record.output,
              status: outcome.ok ? "success" : "error",
              durationMs: record.durationMs,
              ...(outcome.ok ? {} : { error: outcome.error }),
            });

            messages.push({
              role: "tool",
              toolCallId: call.id,
              name: call.name,
              content: JSON.stringify(outcome),
            });
          }
        }

        if (options.memory) {
          await options.memory.session.append(sessionId, { role: "user", text: input });
          if (text) await options.memory.session.append(sessionId, { role: "assistant", text });
        }

        await options.audit?.log({
          agentId: options.name,
          sessionId,
          type: "run_completed",
          status: "success",
          output: { text },
          durationMs: Date.now() - startedAt,
        });

        return {
          text,
          toolCalls,
          usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
        };
      } catch (err) {
        const message = (err as Error)?.message ?? "Agent run failed.";
        await options.audit?.log({
          agentId: options.name,
          sessionId,
          type: "run_failed",
          status: "error",
          error: { message },
          durationMs: Date.now() - startedAt,
        });
        return {
          text: "",
          toolCalls,
          usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
        };
      }
    },
  };
}

/**
 * The killer helper: everything collapses into one call.
 *
 *   const agent = defineAgent({
 *     name: "Ops Agent",
 *     instructions: `You are an operations assistant...`,
 *     tools: [searchWeb, db.search, db.update, email.send, approval],
 *     memory,
 *     audit,
 *   });
 */
export function defineAgent(options: AgentOptions): Agent {
  return createAgent(options);
}

/** Test helper: an agent backed by scripted MockModel outputs and mock tools. */
export function createTestAgent(
  options: Omit<AgentOptions, "model"> & { script?: Parameters<MockModel["enqueue"]>[0][] }
): Agent & { model: MockModel } {
  const model = new MockModel(options.script ?? []);
  const agent = createAgent({ ...options, model });
  return Object.assign(agent, { model });
}