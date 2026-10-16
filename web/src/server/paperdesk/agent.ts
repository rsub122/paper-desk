import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { TICKERS } from "./engine";

export const MODEL = process.env.PAPERDESK_MODEL ?? "claude-sonnet-5-5";
// Reads ANTHROPIC_API_KEY. Org-level keys also need a workspace id.
const WS = process.env.ANTHROPIC_WORKSPACE_ID;
const client = () => new Anthropic(WS ? { defaultHeaders: { "anthropic-workspace-id": WS } } : {});

const CONTRACT = `Write a Python function with this exact signature:

import pandas as pd
def strategy(df: pd.DataFrame) -> pd.Series

df has a DatetimeIndex and columns open, high, low, close, volume (daily, split-adjusted).
Return a Series of target positions indexed like df: 1.0 = long, 0.0 = flat.
position[t] is decided at the close of day t and held on day t+1, so it must only use rows up to t.
Use only pandas and numpy. No I/O, no network, no prints.`;

const TOOL = {
  name: "submit_strategy",
  description: "Submit the strategy",
  input_schema: {
    type: "object" as const,
    properties: {
      ticker: { type: "string", description: `Stock the user named, one of: ${TICKERS.join(", ")}. Default COST.` },
      title: { type: "string", description: "Short plain-English name, max 8 words" },
      code: { type: "string", description: "Full Python source" },
    },
    required: ["ticker", "title", "code"],
  },
};

type Strategy = { ticker: string; title: string; code: string };

async function ask(prompt: string, n: number): Promise<Strategy[]> {
  const res = await client().messages.create({
    model: MODEL,
    max_tokens: 4000 * n,
    tools: [{ ...TOOL, name: "submit", input_schema: { type: "object", properties: { strategies: { type: "array", items: TOOL.input_schema } }, required: ["strategies"] } }],
    // Newer models reject forced tool_choice, so ask for the call in the system prompt instead.
    tool_choice: { type: "auto" },
    system: "Always answer by calling the submit tool exactly once. Never reply with plain text.",
    messages: [{ role: "user", content: prompt }],
  });
  const block = res.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") throw new Error("model returned no strategy");
  const out = (block.input as { strategies: Strategy[] }).strategies;
  return out.map((s) => ({ ...s, ticker: TICKERS.includes(s.ticker?.toUpperCase()) ? s.ticker.toUpperCase() : "COST" }));
}

export async function planToStrategy(plan: string) {
  const [s] = await ask(`${CONTRACT}\n\nTurn this trading plan into exactly one strategy:\n"""${plan}"""`, 1);
  return s;
}

export async function honestVariants(plan: string, n = 4) {
  return ask(
    `${CONTRACT}\n\nThe plan below was tested. Write ${n} honest, meaningfully different variants of it (different thresholds, a trend filter, a stop loss, etc). Never look ahead.\n"""${plan}"""`,
    n,
  );
}

/** Answer "why?" from the run record only. The caller checks the answer against the record. */
export async function explain(record: unknown, question: string) {
  const res = await client().messages.create({
    model: MODEL,
    max_tokens: 2000,
    system:
      "You explain a trading-strategy verdict to a non-expert in 3-5 short sentences. Use ONLY facts and numbers present in the JSON record. Quote numbers exactly as they appear in the record (as percentages with one decimal where the record gives a pct field). Never give investment advice.",
    messages: [{ role: "user", content: `Record:\n${JSON.stringify(record)}\n\nQuestion: ${question}` }],
  });
  return res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
}

/** Planted lookahead for the demo. Disclosed on stage; proves the detector is real. */
export function injectBug(code: string) {
  return `${code.trimEnd()}

import pandas as pd
_honest_strategy = strategy
def strategy(df):
    pos = pd.Series(_honest_strategy(df), index=df.index)
    pos = pos.where(df["close"].shift(-1) > df["close"], 0)  # planted bug (inject toggle)
    return pos
`;
}
