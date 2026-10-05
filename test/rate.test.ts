import { afterEach, describe, expect, it, vi } from "vitest";
import { getUsdJpy, parseFrankfurter } from "../src/rate";

describe("parseFrankfurter", () => {
  it("JPY のレートと日付を取り出す", () => {
    expect(parseFrankfurter({ amount: 1, base: "USD", date: "2026-10-02", rates: { JPY: 157.67 } })).toEqual({
      rate: 157.67,
      date: "2026-10-02",
    });
  });

  it.each([null, {}, { rates: {} }, { rates: { JPY: "157" } }, { rates: { JPY: 0 } }, { rates: { JPY: NaN } }])(
    "おかしな応答 %j は null",
    (body) => expect(parseFrankfurter(body)).toBeNull(),
  );
});

describe("getUsdJpy", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("取得に失敗したら固定レートを返す", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    expect(await getUsdJpy(157)).toEqual({ rate: 157, date: null, source: "fixed" });
  });

  it("取得できたら ECB のレートを返す", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ date: "2026-10-02", rates: { JPY: 157.67 } })));
    expect(await getUsdJpy(157)).toEqual({ rate: 157.67, date: "2026-10-02", source: "ecb" });
  });
});
