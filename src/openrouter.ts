// OpenRouter とのやりとりだけを受け持つモジュール。

import type { DecideInput } from "./validate";

const BASE = "https://openrouter.ai/api";
const APP_HEADERS = {
  "HTTP-Referer": "https://github.com/tomoakari/check-jev-like",
  "X-Title": "check-jev-like",
};

export type DecisionModel = {
  id: string;
  name: string;
  description: string;
  contextLength: number;
  /** 入力 100万トークンあたりの米ドル */
  inputPricePerMillion: number | null;
  supportsImage: boolean;
};

type RawModel = {
  id: string;
  name?: string;
  description?: string;
  context_length?: number;
  pricing?: { prompt?: string };
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
};

function toDecisionModel(m: RawModel): DecisionModel {
  const price = Number(m.pricing?.prompt);
  return {
    id: m.id,
    name: m.name ?? m.id,
    description: m.description ?? "",
    contextLength: m.context_length ?? 0,
    inputPricePerMillion: Number.isFinite(price) && price >= 0 ? price * 1_000_000 : null,
    supportsImage: m.architecture?.input_modalities?.includes("image") ?? false,
  };
}

// isolate が生きている間はモデル一覧を使い回す（毎回 OpenRouter に聞きに行かない）
const CACHE_MS = 10 * 60 * 1000;
let cached: { at: number; models: DecisionModel[] } | null = null;

/** 「判断（decisions）」を出力するモデルの一覧。Jev / Clef の仲間たち */
export async function listDecisionModels(): Promise<DecisionModel[]> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.models;

  const res = await fetch(`${BASE}/v1/models?output_modalities=decisions`, { headers: APP_HEADERS });
  if (!res.ok) throw new Error(`models: HTTP ${res.status}`);
  const body = (await res.json()) as { data?: RawModel[] };

  const models = (body.data ?? [])
    .filter((m) => m.architecture?.output_modalities?.includes("decisions"))
    .map(toDecisionModel);
  cached = { at: Date.now(), models };
  return models;
}

export type DecideOutcome =
  | { ok: true; latencyMs: number; result: unknown }
  | { ok: false; latencyMs: number; status: number; error: string };

const FRIENDLY_ERRORS: Record<number, string> = {
  400: "リクエストの内容をモデルが受け付けませんでした。質問や選択肢を見直してみてください。",
  401: "サーバーの OpenRouter API キーが正しく設定されていないようです。",
  402: "OpenRouter のクレジット（残高）が足りません。",
  403: "このモデルを使う権限がありません。",
  404: "このモデルが見つかりませんでした。提供が終わった可能性があります。",
  408: "時間がかかりすぎたので打ち切りました。",
  413: "入力が長すぎます。",
  429: "混み合っています。少し時間をおいてもう一度試してください。",
};

function friendly(status: number, upstream?: string): string {
  const base = FRIENDLY_ERRORS[status] ?? "モデル側でエラーが起きました。少し時間をおいて試してください。";
  return upstream ? `${base}（詳細: ${upstream}）` : base;
}

/** 1つのモデルに Decisions API で問い合わせ、かかった時間も一緒に返す */
export async function decide(apiKey: string, input: DecideInput, timeoutMs = 30_000): Promise<DecideOutcome> {
  const started = Date.now();
  try {
    const res = await fetch(`${BASE}/alpha/decisions`, {
      method: "POST",
      headers: { ...APP_HEADERS, Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = Date.now() - started;
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;

    if (!res.ok) return { ok: false, latencyMs, status: res.status, error: friendly(res.status, body?.error?.message) };
    if (!body) return { ok: false, latencyMs, status: 502, error: friendly(502, "応答が JSON ではありません") };
    return { ok: true, latencyMs, result: body };
  } catch (e) {
    const latencyMs = Date.now() - started;
    const timedOut = e instanceof DOMException && e.name === "TimeoutError";
    return { ok: false, latencyMs, status: timedOut ? 408 : 502, error: friendly(timedOut ? 408 : 502) };
  }
}
