// ドル → 円の為替レートを取ってくるだけのモジュール。
// Frankfurter（欧州中央銀行の参考レート、APIキー不要）を使い、取れないときは固定レートで代用する。

const SOURCE = "https://api.frankfurter.dev/v1/latest?base=USD&symbols=JPY";

export type UsdJpy = {
  rate: number;
  /** レートの基準日（YYYY-MM-DD）。固定レートのときは null */
  date: string | null;
  source: "ecb" | "fixed";
};

// ECB のレートは1日1回更新なので、isolate が生きている間は6時間使い回す
const CACHE_MS = 6 * 60 * 60 * 1000;
let cached: { at: number; value: UsdJpy } | null = null;

export function parseFrankfurter(body: unknown): { rate: number; date: string } | null {
  const b = body as { date?: unknown; rates?: { JPY?: unknown } } | null;
  const rate = b?.rates?.JPY;
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) return null;
  return { rate, date: typeof b?.date === "string" ? b.date : "" };
}

export async function getUsdJpy(fallback: number): Promise<UsdJpy> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  try {
    const res = await fetch(SOURCE, { signal: AbortSignal.timeout(5_000) });
    const parsed = res.ok ? parseFrankfurter(await res.json()) : null;
    if (parsed) {
      const value: UsdJpy = { rate: parsed.rate, date: parsed.date || null, source: "ecb" };
      cached = { at: Date.now(), value };
      return value;
    }
  } catch {
    // 下の固定レートにフォールバック
  }
  return { rate: fallback, date: null, source: "fixed" };
}
