// ブラウザから届いたリクエストを検査して、OpenRouter Decisions API に渡せる形だけを取り出す。
// 公開ページなので、想定外のフィールドや巨大な入力はここで弾く。

export type NoulQuestion = {
  type: "noul";
  instructions: string;
  criteria: { true: string; false: string };
};
export type ChoiceQuestion = {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
};
export type ScoreQuestion = {
  type: "score";
  instructions: string;
  criteria: string[];
};
export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export type DecideInput = {
  model: string;
  state: string;
  questions: Record<string, Question>;
};

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export const LIMITS = {
  stateChars: 6000,
  questions: 5,
  instructionChars: 500,
  criterionChars: 300,
  optionLabelChars: 40,
  choiceOptions: { min: 2, max: 8 },
  scoreLevels: { min: 2, max: 7 },
} as const;

const QUESTION_ID = /^[a-z][a-z0-9_]{0,31}$/;

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function text(v: unknown, max: number, what: string, allowEmpty = false): Result<string> {
  if (typeof v !== "string") return fail(`${what}は文字で入力してください。`);
  const s = v.trim();
  if (!allowEmpty && s.length === 0) return fail(`${what}が空っぽです。`);
  if (s.length > max) return fail(`${what}は${max}文字以内にしてください（いま${s.length}文字）。`);
  return { ok: true, value: s };
}

function question(id: string, v: unknown): Result<Question> {
  if (!isObject(v)) return fail(`質問「${id}」の形式が正しくありません。`);
  const instructions = text(v.instructions, LIMITS.instructionChars, "質問文");
  if (!instructions.ok) return instructions;
  const c = v.criteria;

  switch (v.type) {
    case "noul": {
      if (!isObject(c)) return fail("「はい／いいえ」の判断基準が見つかりません。");
      const t = text(c.true, LIMITS.criterionChars, "「はい」の基準");
      if (!t.ok) return t;
      const f = text(c.false, LIMITS.criterionChars, "「いいえ」の基準");
      if (!f.ok) return f;
      return { ok: true, value: { type: "noul", instructions: instructions.value, criteria: { true: t.value, false: f.value } } };
    }
    case "choice": {
      if (!isObject(c)) return fail("選択肢が見つかりません。");
      const entries = Object.entries(c);
      const { min, max } = LIMITS.choiceOptions;
      if (entries.length < min || entries.length > max)
        return fail(`選択肢は${min}〜${max}個にしてください。`);
      const criteria: Record<string, string> = {};
      for (const [label, desc] of entries) {
        const l = text(label, LIMITS.optionLabelChars, "選択肢の名前");
        if (!l.ok) return l;
        if (l.value in criteria) return fail(`選択肢「${l.value}」が重複しています。`);
        const d = text(desc ?? "", LIMITS.criterionChars, `選択肢「${l.value}」の説明`, true);
        if (!d.ok) return d;
        criteria[l.value] = d.value;
      }
      return { ok: true, value: { type: "choice", instructions: instructions.value, criteria } };
    }
    case "score": {
      if (!Array.isArray(c)) return fail("段階評価のレベルが見つかりません。");
      const { min, max } = LIMITS.scoreLevels;
      if (c.length < min || c.length > max) return fail(`段階評価のレベルは${min}〜${max}個にしてください。`);
      const criteria: string[] = [];
      for (const [i, level] of c.entries()) {
        const l = text(level, LIMITS.criterionChars, `レベル${i + 1}`);
        if (!l.ok) return l;
        criteria.push(l.value);
      }
      return { ok: true, value: { type: "score", instructions: instructions.value, criteria } };
    }
    default:
      return fail(`質問「${id}」の種類が不明です。`);
  }
}

export function parseDecideInput(body: unknown): Result<DecideInput> {
  if (!isObject(body)) return fail("リクエストの形式が正しくありません。");

  if (typeof body.model !== "string" || body.model.length === 0 || body.model.length > 100)
    return fail("モデルが指定されていません。");

  const state = text(body.state, LIMITS.stateChars, "判定したい文章");
  if (!state.ok) return state;

  if (!isObject(body.questions)) return fail("質問が見つかりません。");
  const ids = Object.keys(body.questions);
  if (ids.length === 0) return fail("質問を1つ以上つくってください。");
  if (ids.length > LIMITS.questions) return fail(`質問は${LIMITS.questions}個までです。`);

  const questions: Record<string, Question> = {};
  for (const id of ids) {
    if (!QUESTION_ID.test(id)) return fail(`質問ID「${id}」は英小文字・数字・_ だけにしてください。`);
    const q = question(id, body.questions[id]);
    if (!q.ok) return q;
    questions[id] = q.value;
  }

  return { ok: true, value: { model: body.model, state: state.value, questions } };
}
