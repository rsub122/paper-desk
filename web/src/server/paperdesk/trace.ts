import "server-only";

import { context, type Span, SpanStatusCode, trace } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-node";

// Arize AX (app.arize.com). OTLP/HTTP needs the hyphenated arize-* headers.
const SPACE = process.env.ARIZE_SPACE_ID;
const KEY = process.env.ARIZE_API_KEY;
const ENABLED = !!(SPACE && KEY);
const PROJECT = process.env.ARIZE_PROJECT_NAME ?? "paper-desk";

const g = globalThis as unknown as { __pdProvider?: NodeTracerProvider };
const provider = (g.__pdProvider ??= new NodeTracerProvider({
  resource: resourceFromAttributes({ "service.name": "paper-desk", "openinference.project.name": PROJECT }),
  spanProcessors: ENABLED
    ? [new SimpleSpanProcessor(new OTLPTraceExporter({ url: "https://otlp.arize.com/v1/traces", headers: { "arize-space-id": SPACE!, "arize-api-key": KEY! } }))]
    : [],
}));
const tracer = provider.getTracer("paper-desk");

export type Step = { name: string; kind: string; ms: number; attrs: Record<string, unknown> };

/** One run = one trace. Every step lands in Arize AND in a local record that the "why" answer is built from. */
export function startTrace(name: string, input: unknown) {
  const root = tracer.startSpan(name, {
    attributes: { "openinference.span.kind": "CHAIN", "input.value": JSON.stringify(input) },
  });
  const steps: Step[] = [];
  const ctx = trace.setSpan(context.active(), root);

  async function step<T>(stepName: string, kind: "LLM" | "TOOL" | "CHAIN" | "EVALUATOR", attrs: Record<string, unknown>, fn: (span: Span) => Promise<T>, summarize?: (r: T) => Record<string, unknown>) {
    const span = tracer.startSpan(stepName, { attributes: { "openinference.span.kind": kind, "input.value": JSON.stringify(attrs) } }, ctx);
    const t0 = Date.now();
    try {
      const r = await fn(span);
      const out = summarize ? summarize(r) : {};
      span.setAttribute("output.value", JSON.stringify(out));
      steps.push({ name: stepName, kind, ms: Date.now() - t0, attrs: { ...attrs, ...out } });
      return r;
    } catch (e) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(e) });
      steps.push({ name: stepName, kind, ms: Date.now() - t0, attrs: { ...attrs, error: String(e) } });
      throw e;
    } finally {
      span.end();
    }
  }

  return {
    traceId: root.spanContext().traceId,
    rootSpanId: root.spanContext().spanId,
    steps,
    step,
    end(output: unknown, extra: Record<string, string | number> = {}) {
      root.setAttributes({ "output.value": JSON.stringify(output), ...extra });
      root.end();
    },
  };
}

/** Custom check as an Arize eval: eval.<name>.label/score/explanation on the span it judges. */
export function evalAttrs(name: string, label: string, score: number, explanation: string) {
  return { [`eval.${name}.label`]: label, [`eval.${name}.score`]: score, [`eval.${name}.explanation`]: explanation };
}

export const arizeUrl = ENABLED ? "https://app.arize.com" : null;
