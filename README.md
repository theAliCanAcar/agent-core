# Agent Core

Shared agent interface: createAgent/defineAgent, Model adapter (OpenAI + Mock), tool loop, memory/audit/approval wiring.

TypeScript package `agent-core`.

## Install

```sh
npm install github:theAliCanAcar/agent-core#main
```

## How to use

```ts
import { defineAgent, MockModel, createMemory, createAudit, createApproval, tool } from 'agent-core';
import { z } from 'zod';

const ping = tool({
  name: 'ping',
  description: 'Return pong',
  schema: z.object({}),
  execute: async () => 'pong',
});

const agent = defineAgent({
  name: 'Demo',
  instructions: 'Answer briefly. Use ping if needed.',
  tools: [ping],
  model: new MockModel(),
  memory: createMemory({}),
  audit: createAudit({ agentId: 'demo' }),
  approval: createApproval({ policy: { autoApprove: ['*'] }, prompt: async () => ({ approved: true }) }),
});

console.log(await agent.run('Ping once.'));
```

## Use cases

### 1. Stand up an agent in one file

- **Scenario:** You have tools and instructions but no orchestration yet.
- **Outcome:** defineAgent/createAgent wires model, tools, memory, audit, and approval into a run() loop.

### 2. Swap models for local tests

- **Scenario:** CI cannot call a live provider.
- **Outcome:** Use MockModel locally and OpenAIModel (or your transport) in production.

## Dependencies

- `agent-approval`: `github:theAliCanAcar/agent-approval#main`
- `agent-audit`: `github:theAliCanAcar/agent-audit#main`
- `agent-memory`: `github:theAliCanAcar/agent-memory#main`
- `agent-tools`: `github:theAliCanAcar/agent-tools#main`
- `zod`: `^3.23.8`

## Scripts

```sh
npm install
npm run build
```

## Notes

- Keep API keys in environment variables or a gitignored `.env`. Never commit secrets.
- Side-effecting tools should go through approval when used with `agent-approval`.
- Related packages live in separate repositories under [theAliCanAcar](https://github.com/theAliCanAcar).

## License

MIT
