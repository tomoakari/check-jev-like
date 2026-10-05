import { describe, expect, it } from "vitest";
import { LIMITS, parseDecideInput } from "../src/validate";

const valid = () => ({
  model: "typesafe/jev-1.13",
  state: "  決済画面が真っ白になります  ",
  questions: {
    q1: { type: "noul", instructions: "不具合ですか？", criteria: { true: "壊れている", false: "質問している" } },
    q2: { type: "choice", instructions: "担当は？", criteria: { 決済: "支払い", 画面: "" } },
    q3: { type: "score", instructions: "緊急度は？", criteria: ["低", "中", "高"] },
  },
});

describe("parseDecideInput", () => {
  it("正しい入力を Decisions API の形に整える", () => {
    const r = parseDecideInput(valid());
    expect(r).toEqual({
      ok: true,
      value: {
        model: "typesafe/jev-1.13",
        state: "決済画面が真っ白になります",
        questions: valid().questions,
      },
    });
  });

  it("想定外のフィールドは捨てる", () => {
    const body = valid() as Record<string, unknown>;
    body.provider = { order: ["x"] };
    (body.questions as Record<string, Record<string, unknown>>).q1.extra = "x";
    const r = parseDecideInput(body);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).not.toHaveProperty("provider");
    expect(r.value.questions.q1).not.toHaveProperty("extra");
  });

  it.each([
    ["本文が空", (b: any) => (b.state = "   "), "空っぽ"],
    ["本文が長すぎる", (b: any) => (b.state = "あ".repeat(LIMITS.stateChars + 1)), "以内"],
    ["モデルなし", (b: any) => delete b.model, "モデル"],
    ["質問ゼロ", (b: any) => (b.questions = {}), "1つ以上"],
    ["質問IDが不正", (b: any) => (b.questions = { "Q-1": b.questions.q1 }), "質問ID"],
    ["種類が不明", (b: any) => (b.questions.q1.type = "bool"), "種類"],
    ["はい／いいえの基準が欠けている", (b: any) => delete b.questions.q1.criteria.false, "いいえ"],
    ["選択肢が1つ", (b: any) => (b.questions.q2.criteria = { a: "" }), "選択肢は"],
    ["段階が多すぎる", (b: any) => (b.questions.q3.criteria = Array(8).fill("x")), "段階評価"],
    ["段階が空文字", (b: any) => (b.questions.q3.criteria = ["低", " "]), "空っぽ"],
  ])("%s ならエラー", (_name, mutate, message) => {
    const body = valid();
    mutate(body);
    const r = parseDecideInput(body);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain(message);
  });

  it("質問は上限個数まで", () => {
    const q = valid().questions.q1;
    const questions = Object.fromEntries(Array.from({ length: LIMITS.questions + 1 }, (_, i) => [`q${i + 1}`, q]));
    expect(parseDecideInput({ ...valid(), questions }).ok).toBe(false);
  });
});
