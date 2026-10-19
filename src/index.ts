export * from "./types";
export * from "./models";
export * from "./agent";

// Re-exported for the simple import surface from the spec:
//   import { defineAgent, tool, memory, approval, audit } from "agent-core";
export {
  tool,
  mockTool,
  runTool,
  retry,
  timeout,
  fallback,
  ok,
  failure,
  isFailure,
  http,
  fetchJson,
  sendEmail,
  readFile,
  writeFile,
  runCommand,
  searchWeb,
  searchMemory,
  saveMemory,
  requestApproval,
  createRecord,
  updateRecord,
  deleteRecord,
} from "agent-tools";
export type {
  Tool,
  ToolContext,
  ToolOutcome,
  ToolError,
  JsonSchema,
} from "agent-tools";

export { createMemory, createInMemorySession, createInMemoryLongTerm, createSupabaseLongTerm } from "agent-memory";
export type { Memory, MemoryRecord, SessionEvent } from "agent-memory";

export { createApproval, defaultApprovalPolicy } from "agent-approval";
export type { ApprovalGate, ApprovalPolicy, ApprovalRequest, ApprovalResponse } from "agent-approval";

export { createAudit, consoleSink, memorySink } from "agent-audit";
export type { AgentEvent, AuditLogger, AuditSink } from "agent-audit";