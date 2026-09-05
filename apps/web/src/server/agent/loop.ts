/**
 * The agent tool-calling loop. SPEC §3.5.
 *
 * One user message in, one assistant reply out, with up to six tool round trips in between. The
 * loop never waits for the human: `propose_*` returns as soon as the row is written, and the
 * outcome arrives on a later turn through `get_proposal`. See docs/spikes.md entry 3.
 *
 * Two traps that cost a morning if you forget them:
 * - Tool calls go through `client.responses.create`, not chat completions. GPT-5.6 rejects
 *   function tools on /v1/chat/completions while reasoning is on.
 * - `arguments` arrives as a JSON *string*. Parse it, then validate it. Never string-match it.
 */

import type OpenAI from "openai";

import { SYSTEM_PROMPT } from "./prompt";
import {
  TOOL_DEFINITIONS,
  TOOL_SCHEMAS,
  isAgentToolName,
  type AgentToolName,
  type AgentTools,
} from "./tools";

export const MODEL = "gpt-5.6-terra";

/**
 * Reasoning effort defaults to `medium`, which is the main cost lever and more than this loop
 * needs. Spike 2 exists to confirm `low` still calls the tool reliably.
 */
export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export const DEFAULT_EFFORT: ReasoningEffort = "low";

/**
 * A model that keeps calling tools is a model that will keep spending. Six is enough for
 * get_wallet, a propose, a get_proposal and slack; past that the turn ends with what it has.
 */
export const MAX_TOOL_ROUND_TRIPS = 6;

/** Just the part of the OpenAI client this loop uses, so a test can pass a fake. */
export interface ResponsesClient {
  responses: {
    create(
      body: OpenAI.Responses.ResponseCreateParamsNonStreaming,
    ): Promise<OpenAI.Responses.Response>;
  };
}

export interface ToolInvocation {
  name: string;
  /** The parsed arguments, or the raw string when it was not valid JSON. */
  input: unknown;
  output: unknown;
  /** Set when the arguments failed validation or the handler threw. The model is told either way. */
  error?: string;
}

export interface AgentTurn {
  text: string;
  toolCalls: ToolInvocation[];
  /** Append to the caller's history so the next turn sees the tool calls and their results. */
  items: OpenAI.Responses.ResponseInputItem[];
  roundTrips: number;
  /** True when the loop stopped on the cap rather than because the model was done. */
  hitCap: boolean;
  inputTokens: number;
  outputTokens: number;
}

export interface RunAgentTurnOptions {
  client: ResponsesClient;
  tools: AgentTools;
  /** Prior turns' items, oldest first. The caller owns this. */
  history?: OpenAI.Responses.ResponseInputItem[];
  model?: string;
  effort?: ReasoningEffort;
  maxRoundTrips?: number;
}

/**
 * Runs one tool call. A bad input or a throwing handler comes back as an error *result* rather
 * than an exception, because the model needs to read it: "no approval device connected" is
 * something the user has to be told, and a thrown error would end the turn with silence.
 * The error is recorded on the turn as well, so the caller can see it without parsing prose.
 */
async function callTool(
  tools: AgentTools,
  name: AgentToolName,
  rawArguments: string,
): Promise<{ output: unknown; error?: string; input: unknown }> {
  let input: unknown;
  try {
    input = JSON.parse(rawArguments);
  } catch (error) {
    const message = `arguments were not valid JSON: ${(error as Error).message}`;
    return { input: rawArguments, output: { error: message }, error: message };
  }

  const parsed = TOOL_SCHEMAS[name].safeParse(input);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return { input, output: { error: message }, error: message };
  }

  try {
    // The dispatch is uniform but the handlers are not, and TypeScript cannot see that the schema
    // and the handler for a given name agree. They are declared together in tools.ts.
    const handler = tools[name] as (arg: unknown) => Promise<unknown>;
    return { input: parsed.data, output: await handler.call(tools, parsed.data) };
  } catch (error) {
    const message = (error as Error).message;
    return { input: parsed.data, output: { error: message }, error: message };
  }
}

export async function runAgentTurn(
  userMessage: string,
  options: RunAgentTurnOptions,
): Promise<AgentTurn> {
  const {
    client,
    tools,
    history = [],
    model = MODEL,
    effort = DEFAULT_EFFORT,
    maxRoundTrips = MAX_TOOL_ROUND_TRIPS,
  } = options;

  const newItems: OpenAI.Responses.ResponseInputItem[] = [
    { role: "user", content: userMessage },
  ];
  const toolCalls: ToolInvocation[] = [];
  let text = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let roundTrips = 0;
  let hitCap = false;

  for (;;) {
    const response = await client.responses.create({
      model,
      instructions: SYSTEM_PROMPT,
      input: [...history, ...newItems],
      tools: TOOL_DEFINITIONS,
      reasoning: { effort },
      max_output_tokens: 16000,
    });

    inputTokens += response.usage?.input_tokens ?? 0;
    outputTokens += response.usage?.output_tokens ?? 0;
    text = response.output_text?.trim() ?? "";

    // Reasoning items have to be carried forward too, or the next request drops the model's own
    // context for the tool call it just made.
    newItems.push(...(response.output as unknown as OpenAI.Responses.ResponseInputItem[]));

    const calls = response.output.filter(
      (item): item is OpenAI.Responses.ResponseFunctionToolCall => item.type === "function_call",
    );
    if (calls.length === 0) break;

    if (roundTrips >= maxRoundTrips) {
      hitCap = true;
      // Answer every call, or the next request is malformed: the Responses API requires an output
      // for each function_call already in the input.
      for (const call of calls) {
        const message = `Tool budget of ${maxRoundTrips} round trips is spent. Stop calling tools and answer with what you have.`;
        toolCalls.push({ name: call.name, input: call.arguments, output: { error: message }, error: message });
        newItems.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify({ error: message }) });
      }
      continue;
    }
    roundTrips++;

    for (const call of calls) {
      const result = isAgentToolName(call.name)
        ? await callTool(tools, call.name, call.arguments)
        : {
            input: call.arguments,
            output: { error: `Unknown tool ${call.name}` },
            error: `Unknown tool ${call.name}`,
          };

      toolCalls.push({ name: call.name, input: result.input, output: result.output, error: result.error });
      newItems.push({
        type: "function_call_output",
        call_id: call.call_id,
        // JSON.stringify throws on bigint, and balances are the obvious thing a handler returns.
        // Amounts cross this boundary as strings; anything else is a bug in the handler.
        output: JSON.stringify(result.output),
      });
    }
  }

  return { text, toolCalls, items: newItems, roundTrips, hitCap, inputTokens, outputTokens };
}
