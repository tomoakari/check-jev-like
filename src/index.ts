// ルーティングだけを担当する入口。
//   GET  /api/models  … 比べられるモデルの一覧
//   POST /api/decide  … 1つのモデルに判断させる（ブラウザはモデルごとに並列で呼ぶ）
// それ以外は public/ の静的ファイルが返る。

import { decide, listDecisionModels } from "./openrouter";
import { parseDecideInput } from "./validate";

const MAX_BODY_CHARS = 64 * 1024;

const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

const error = (message: string, status: number) => json({ ok: false, error: message }, status);

const defaultModels = (env: Env) =>
  env.DEFAULT_MODELS.split(",").map((s) => s.trim()).filter(Boolean);

async function handleModels(env: Env): Promise<Response> {
  const defaults = defaultModels(env);
  try {
    const models = await listDecisionModels();
    // おすすめ（既定）モデルを先頭に並べる
    const rank = (id: string) => (defaults.includes(id) ? defaults.indexOf(id) : defaults.length);
    models.sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name));
    return json({ ok: true, defaults, models });
  } catch {
    return error("モデル一覧を取得できませんでした。少し時間をおいて再読み込みしてください。", 502);
  }
}

async function isAllowedModel(env: Env, model: string): Promise<boolean> {
  try {
    return (await listDecisionModels()).some((m) => m.id === model);
  } catch {
    // 一覧が取れないときは、設定済みの既定モデルだけ許可する
    return defaultModels(env).includes(model);
  }
}

async function handleDecide(request: Request, env: Env): Promise<Response> {
  if (!env.OPENROUTER_API_KEY) return error("サーバーに OPENROUTER_API_KEY が設定されていません。", 500);

  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const { success } = await env.RATE_LIMITER.limit({ key: ip });
  if (!success) return error("短い時間に実行しすぎです。1分ほど待ってからもう一度どうぞ。", 429);

  const raw = await request.text();
  if (raw.length > MAX_BODY_CHARS) return error("入力が大きすぎます。", 413);

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return error("リクエストの形式が正しくありません。", 400);
  }

  const input = parseDecideInput(body);
  if (!input.ok) return error(input.error, 400);
  if (!(await isAllowedModel(env, input.value.model)))
    return error("このページでは使えないモデルです。", 400);

  const outcome = await decide(env.OPENROUTER_API_KEY, input.value);
  return outcome.ok
    ? json({ ok: true, latencyMs: outcome.latencyMs, result: outcome.result })
    : json({ ok: false, latencyMs: outcome.latencyMs, error: outcome.error }, outcome.status);
}

export default {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === "/api/models" && request.method === "GET") return handleModels(env);
    if (pathname === "/api/decide" && request.method === "POST") return handleDecide(request, env);
    if (pathname.startsWith("/api/")) return error("見つかりません。", 404);

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
