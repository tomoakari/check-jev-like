// 画面の動き。フレームワークなしの素の JavaScript。
import { MODEL_NOTES, PRESETS } from "./presets.js";

const MAX_MODELS = 6;
const MAX_QUESTIONS = 5;
const STATE_MAX = 6000;
const LIMITS = { choice: [2, 8], score: [2, 7] };
const TYPE_LABEL = { noul: "はい／いいえ", choice: "選択", score: "段階評価" };

const $ = (sel) => document.querySelector(sel);

/** 小さな DOM ビルダー。文字列は必ずテキストとして入るので、外部の文章をそのまま表示しても安全 */
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "style") el.style.cssText = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c);
  return el;
}

// ---------------------------------------------------------------- 状態

const app = {
  presetId: null,
  questions: [], // 編集用の形: { type, text, noul: {yes, no}, choice: [{label, desc}], score: [string] }
  models: [],
  defaults: [],
  selected: new Set(),
  running: false,
  // 1ドルあたりの円。/api/rate で最新値に置きかわる
  rate: { rate: 157, date: null, source: "fixed" },
};

/** API 形式の質問 → 編集用の形 */
function toEditable(q) {
  const e = { type: q.type, text: q.instructions, noul: { yes: "", no: "" }, choice: [], score: [] };
  if (q.type === "noul") e.noul = { yes: q.criteria.true, no: q.criteria.false };
  if (q.type === "choice") e.choice = Object.entries(q.criteria).map(([label, desc]) => ({ label, desc }));
  if (q.type === "score") e.score = [...q.criteria];
  return e;
}

/** 編集用の形 → API 形式。入力に問題があればエラーメッセージを投げる */
function toApi(e, n) {
  const name = `質問${n}`;
  const text = e.text.trim();
  if (!text) throw new Error(`${name}の「質問文」を入れてください。`);
  if (e.type === "noul") {
    const [yes, no] = [e.noul.yes.trim(), e.noul.no.trim()];
    if (!yes || !no) throw new Error(`${name}の「はい」「いいえ」の基準を両方入れてください。`);
    return { type: "noul", instructions: text, criteria: { true: yes, false: no } };
  }
  if (e.type === "choice") {
    const rows = e.choice.filter((c) => c.label.trim());
    if (rows.length < LIMITS.choice[0]) throw new Error(`${name}の選択肢を${LIMITS.choice[0]}つ以上入れてください。`);
    const criteria = {};
    for (const r of rows) {
      const label = r.label.trim();
      if (label in criteria) throw new Error(`${name}の選択肢「${label}」が重複しています。`);
      criteria[label] = r.desc.trim();
    }
    return { type: "choice", instructions: text, criteria };
  }
  const levels = e.score.map((s) => s.trim()).filter(Boolean);
  if (levels.length < LIMITS.score[0]) throw new Error(`${name}の段階を${LIMITS.score[0]}つ以上入れてください。`);
  return { type: "score", instructions: text, criteria: levels };
}

// ---------------------------------------------------------------- STEP 1: お題

function renderPresets() {
  const box = $("#presets");
  box.replaceChildren(
    ...PRESETS.map((p) =>
      h(
        "button",
        {
          type: "button",
          class: "preset" + (app.presetId === p.id ? " active" : ""),
          role: "radio",
          "aria-checked": String(app.presetId === p.id),
          onclick: () => applyPreset(p),
        },
        h("span", { class: "preset-icon", "aria-hidden": "true" }, p.icon),
        h("b", {}, p.title),
        h("small", {}, p.desc),
      ),
    ),
  );
}

function applyPreset(p) {
  app.presetId = p.id;
  $("#state").value = p.state;
  updateCounter();
  app.questions = Object.values(p.questions).map(toEditable);
  renderPresets();
  renderQuestions();
}

// ---------------------------------------------------------------- STEP 2: 文章

function updateCounter() {
  const n = $("#state").value.length;
  $("#stateCount").textContent = n.toLocaleString();
  $("#stateCount").parentElement.classList.toggle("over", n > STATE_MAX);
}

// ---------------------------------------------------------------- STEP 3: 質問

function newQuestion() {
  return { type: "noul", text: "", noul: { yes: "", no: "" }, choice: [], score: [] };
}

function setType(q, type) {
  q.type = type;
  if (type === "choice" && q.choice.length === 0) q.choice = [{ label: "", desc: "" }, { label: "", desc: "" }];
  if (type === "score" && q.score.length === 0) q.score = ["", "", ""];
  renderQuestions();
}

const field = (label, input, hint) =>
  h("label", { class: "field" }, h("span", {}, label), input, hint && h("small", { class: "hint" }, hint));

const textInput = (value, placeholder, oninput, max = 300) =>
  h("input", { type: "text", value, placeholder, maxlength: String(max), oninput: (ev) => oninput(ev.target.value) });

function criteriaEditor(q) {
  if (q.type === "noul") {
    return h(
      "div",
      { class: "crit" },
      h("p", { class: "crit-help" }, "「はい」「いいえ」それぞれ、どんなときにそう判断してほしいかを書きます。"),
      field("✅「はい」になるのはどんなとき？", textInput(q.noul.yes, "例）製品が壊れている・想定外の動きをしていると説明している", (v) => (q.noul.yes = v))),
      field("❌「いいえ」になるのはどんなとき？", textInput(q.noul.no, "例）使い方の質問や機能の要望をしている", (v) => (q.noul.no = v))),
    );
  }

  if (q.type === "choice") {
    const [min, max] = LIMITS.choice;
    return h(
      "div",
      { class: "crit" },
      h("p", { class: "crit-help" }, `AIに選ばせたい選択肢を${min}〜${max}個並べます。右側に「どんなときにそれを選ぶか」を書くと精度が上がります。`),
      h(
        "div",
        { class: "rows" },
        q.choice.map((c, i) =>
          h(
            "div",
            { class: "row" },
            h("input", { type: "text", class: "row-label", value: c.label, placeholder: `選択肢${i + 1}の名前`, maxlength: "40", "aria-label": `選択肢${i + 1}の名前`, oninput: (ev) => (c.label = ev.target.value) }),
            h("input", { type: "text", value: c.desc, placeholder: "どんなときにこれを選ぶ？（任意）", maxlength: "300", "aria-label": `選択肢${i + 1}の説明`, oninput: (ev) => (c.desc = ev.target.value) }),
            h("button", { type: "button", class: "btn icon", "aria-label": `選択肢${i + 1}を削除`, disabled: q.choice.length <= min, onclick: () => { q.choice.splice(i, 1); renderQuestions(); } }, "✕"),
          ),
        ),
      ),
      q.choice.length < max &&
        h("button", { type: "button", class: "btn ghost small", onclick: () => { q.choice.push({ label: "", desc: "" }); renderQuestions(); } }, "＋ 選択肢を追加"),
    );
  }

  const [min, max] = LIMITS.score;
  return h(
    "div",
    { class: "crit" },
    h("p", { class: "crit-help" }, `段階を${min}〜${max}個、上から「低い → 高い」の順に並べます。`),
    h(
      "div",
      { class: "rows" },
      q.score.map((s, i) =>
        h(
          "div",
          { class: "row" },
          h("span", { class: "level-num", title: "段階の番号（0がいちばん低い）" }, String(i)),
          h("input", { type: "text", value: s, placeholder: i === 0 ? "例）低い" : i === q.score.length - 1 ? "例）高い" : "例）ふつう", maxlength: "300", "aria-label": `段階${i}`, oninput: (ev) => (q.score[i] = ev.target.value) }),
          h("button", { type: "button", class: "btn icon", "aria-label": `段階${i}を削除`, disabled: q.score.length <= min, onclick: () => { q.score.splice(i, 1); renderQuestions(); } }, "✕"),
        ),
      ),
    ),
    q.score.length < max &&
      h("button", { type: "button", class: "btn ghost small", onclick: () => { q.score.push(""); renderQuestions(); } }, "＋ 段階を追加"),
  );
}

function renderQuestions() {
  const tpl = $("#tpl-question");
  const nodes = app.questions.map((q, i) => {
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.querySelector(".q-label").textContent = `質問${i + 1}`;

    const remove = node.querySelector(".remove");
    remove.disabled = app.questions.length <= 1;
    remove.addEventListener("click", () => { app.questions.splice(i, 1); renderQuestions(); });

    for (const b of node.querySelectorAll(".q-types button")) {
      const on = b.dataset.type === q.type;
      b.classList.toggle("active", on);
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(on));
      b.addEventListener("click", () => setType(q, b.dataset.type));
    }

    const input = node.querySelector(".q-text");
    input.value = q.text;
    input.addEventListener("input", () => (q.text = input.value));

    node.querySelector(".q-criteria").replaceChildren(criteriaEditor(q));
    return node;
  });
  $("#questions").replaceChildren(...nodes);
  $("#addQuestion").hidden = app.questions.length >= MAX_QUESTIONS;
}

// ---------------------------------------------------------------- STEP 4: モデル

const maker = (m) => (m.name.includes(":") ? m.name.split(":")[0].trim() : m.id.split("/")[0]);
const shortName = (m) => (m.name.includes(":") ? m.name.split(":").slice(1).join(":").trim() : m.name);

function priceLabel(m) {
  if (m.inputPricePerMillion == null) return "料金不明";
  if (m.inputPricePerMillion === 0) return "無料";
  return `${yen(m.inputPricePerMillion)} / 100万トークン`;
}

function modelCard(m) {
  const checked = app.selected.has(m.id);
  const full = !checked && app.selected.size >= MAX_MODELS;
  const note = MODEL_NOTES[m.id] ?? m.description.replace(/\s+/g, " ").slice(0, 120) + (m.description.length > 120 ? "…" : "");
  return h(
    "label",
    { class: "model" + (checked ? " checked" : "") + (full ? " disabled" : "") },
    h("input", { type: "checkbox", checked, disabled: full, onchange: (ev) => toggleModel(m.id, ev.target.checked) }),
    h(
      "div",
      { class: "model-body" },
      h("div", { class: "model-head" },
        h("b", {}, shortName(m)),
        app.defaults.includes(m.id) && h("span", { class: "chip accent" }, "注目"),
      ),
      h("small", { class: "maker" }, `${maker(m)} ・ ${m.id}`),
      h("p", { class: "model-note" }, note),
      h("div", { class: "chips" },
        h("span", { class: "chip", title: "入力した文章の量に応じてかかる料金（出力は無料）" }, "💰 " + priceLabel(m)),
        m.contextLength > 0 && h("span", { class: "chip", title: "一度に読める文章の長さ" }, `📏 ${(m.contextLength / 10000).toFixed(1)}万トークンまで`),
        m.supportsImage && h("span", { class: "chip", title: "画像の判定もできるモデル（このページでは文章のみ試せます）" }, "🖼️ 画像にも対応"),
      ),
    ),
  );
}

function toggleModel(id, on) {
  on ? app.selected.add(id) : app.selected.delete(id);
  renderModels();
}

function renderModels() {
  const featured = app.models.filter((m) => app.defaults.includes(m.id));
  const others = app.models.filter((m) => !app.defaults.includes(m.id));
  $("#models").replaceChildren(...(featured.length ? featured : others).map(modelCard));
  const box = $("#moreModelsBox");
  box.hidden = !featured.length || !others.length;
  $("#moreModels").replaceChildren(...others.map(modelCard));
  box.querySelector("summary").textContent = `ほかの判断AIも見る（${others.length}個）`;
}

async function loadRate() {
  try {
    const body = await (await fetch("/api/rate")).json();
    if (body.ok && body.rate > 0) app.rate = { rate: body.rate, date: body.date, source: body.source };
  } catch {
    // 取得できなければ初期値（固定レート）のまま
  }
  $("#rateNote").textContent = rateNote();
  if (app.models.length) renderModels();
}

async function loadModels() {
  try {
    const res = await fetch("/api/models");
    const body = await res.json();
    if (!body.ok) throw new Error(body.error);
    app.models = body.models;
    app.defaults = body.defaults;
    for (const id of body.defaults) if (body.models.some((m) => m.id === id)) app.selected.add(id);
    renderModels();
  } catch (e) {
    $("#models").replaceChildren(h("p", { class: "error-text" }, `😢 ${e.message || "AIの一覧を読み込めませんでした。"} ページを再読み込みしてみてください。`));
  }
}

// ---------------------------------------------------------------- 実行

function hint(msg, isError = false) {
  const el = $("#runHint");
  el.textContent = msg;
  el.classList.toggle("error-text", isError);
}

async function run() {
  if (app.running) return;
  const state = $("#state").value.trim();
  let questions;
  try {
    if (!state) throw new Error("STEP 2 の「判定したい文章」を入れてください。");
    if (state.length > STATE_MAX) throw new Error(`文章は${STATE_MAX}文字以内にしてください。`);
    questions = Object.fromEntries(app.questions.map((q, i) => [`q${i + 1}`, toApi(q, i + 1)]));
    if (app.selected.size === 0) throw new Error("STEP 4 で比べるAIを1つ以上選んでください。");
  } catch (e) {
    hint("✋ " + e.message, true);
    return;
  }

  const models = app.models.filter((m) => app.selected.has(m.id));
  const job = { questions, models, results: Object.fromEntries(models.map((m) => [m.id, { status: "loading" }])) };

  app.running = true;
  $("#run").disabled = true;
  hint(`${models.length}つのAIに問い合わせ中…`);
  $("#results").hidden = false;
  renderResults(job);
  $("#results").scrollIntoView({ behavior: "smooth", block: "start" });

  await Promise.all(
    models.map(async (m) => {
      try {
        const res = await fetch("/api/decide", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: m.id, state, questions }),
        });
        const body = await res.json().catch(() => ({ ok: false, error: `通信エラー（HTTP ${res.status}）` }));
        job.results[m.id] = body.ok
          ? { status: "ok", latencyMs: body.latencyMs, data: body.result }
          : { status: "error", error: body.error || "エラーが起きました。" };
      } catch {
        job.results[m.id] = { status: "error", error: "サーバーにつながりませんでした。" };
      }
      renderResults(job);
    }),
  );

  app.running = false;
  $("#run").disabled = false;
  const okCount = Object.values(job.results).filter((r) => r.status === "ok").length;
  hint(okCount === models.length ? "✨ ぜんぶ答えが返ってきました！下の結果を見てみてください。" : `${okCount} / ${models.length} のAIから答えが返ってきました。`);
}

// ---------------------------------------------------------------- 結果の表示

const pct = (p) => (p > 0 && p < 0.005 ? "<1%" : `${Math.round(p * 100)}%`);

/** ドル建ての金額を円で表示する。1円未満はとても小さいので有効数字2桁で見せる */
function yen(usd) {
  if (usd == null) return "—";
  if (usd === 0) return "0円（無料）";
  const v = usd * app.rate.rate;
  const opts = v < 1 ? { maximumSignificantDigits: 2 } : v < 100 ? { maximumFractionDigits: 1 } : { maximumFractionDigits: 0 };
  return `約${v.toLocaleString("ja-JP", opts)}円`;
}

function rateNote() {
  const { rate, date, source } = app.rate;
  return source === "ecb"
    ? `※ 料金はドル建てです。1ドル＝${rate}円（${date} 時点の欧州中央銀行の参考レート）で円に換算しています。`
    : `※ 料金はドル建てです。1ドル＝${rate}円（固定レート）で円に換算しています。`;
}

function bar(label, p, { winner = false } = {}) {
  return h(
    "div",
    { class: "bar" + (winner ? " winner" : "") },
    h("span", { class: "bar-label", title: label }, label),
    h("span", { class: "bar-track" }, h("i", { style: `--p:${Math.max(0, Math.min(1, p)) * 100}%` })),
    h("b", { class: "bar-value" }, pct(p)),
  );
}

/** 各質問の答えを、比べやすい「結論」にそろえる（意見の一致チェック用） */
function verdictOf(q, a) {
  if (!a) return null;
  if (q.type === "noul") return a.noul >= 0.5 ? "はい" : "いいえ";
  if (q.type === "choice") return a.choice;
  const i = Math.max(0, Math.min(q.criteria.length - 1, Math.round(a.score)));
  return q.criteria[i];
}

function answerCell(q, a) {
  if (!a) return h("p", { class: "error-text" }, "この質問への答えがありませんでした。");

  if (q.type === "noul") {
    const yes = a.noul;
    return h(
      "div",
      {},
      h("p", { class: "verdict " + (yes >= 0.5 ? "yes" : "no") }, yes >= 0.5 ? "はい" : "いいえ", h("small", {}, `（はいの確率 ${pct(yes)}）`)),
      bar("はい", yes, { winner: yes >= 0.5 }),
      bar("いいえ", 1 - yes, { winner: yes < 0.5 }),
    );
  }

  if (q.type === "choice") {
    const probs = a.probabilities ?? {};
    return h(
      "div",
      {},
      h("p", { class: "verdict" }, a.choice),
      Object.keys(q.criteria).map((k) => bar(k, probs[k] ?? 0, { winner: k === a.choice })),
      a.confidence != null && h("p", { class: "meta" }, `信頼度 ${pct(a.confidence)}`),
    );
  }

  const n = q.criteria.length;
  const probs = a.probabilities ?? {};
  const pos = n > 1 ? Math.max(0, Math.min(1, a.score / (n - 1))) : 0;
  return h(
    "div",
    {},
    h("p", { class: "verdict" }, verdictOf(q, a)),
    h("div", { class: "scale", title: `スコア ${a.score.toFixed(2)}` },
      h("span", { class: "scale-track" }, h("i", { class: "scale-dot", style: `--pos:${pos * 100}%` })),
      h("span", { class: "scale-ends" }, h("small", {}, q.criteria[0]), h("small", {}, q.criteria[n - 1])),
    ),
    q.criteria.map((label, i) => bar(`${i}. ${label}`, probs[String(i)] ?? 0, { winner: i === Math.round(a.score) })),
    h("p", { class: "meta" }, `スコア ${a.score.toFixed(2)}（0〜${n - 1}）` + (a.confidence != null ? ` ・ 信頼度 ${pct(a.confidence)}` : "")),
  );
}

function renderSummary(run) {
  return [renderSummaryCards(run), h("p", { class: "meta rate-note" }, rateNote())];
}

function renderSummaryCards(run) {
  const ok = run.models.filter((m) => run.results[m.id].status === "ok");
  const allDone = run.models.every((m) => run.results[m.id].status !== "loading");
  const fastest = allDone && ok.length > 1 ? ok.reduce((a, b) => (run.results[a.id].latencyMs <= run.results[b.id].latencyMs ? a : b)).id : null;
  const costOf = (m) => run.results[m.id].data?.usage?.cost ?? Infinity;
  const cheapest = allDone && ok.length > 1 ? ok.reduce((a, b) => (costOf(a) <= costOf(b) ? a : b)).id : null;

  return h(
    "div",
    { class: "summary" },
    run.models.map((m) => {
      const r = run.results[m.id];
      const usage = r.data?.usage;
      return h(
        "div",
        { class: `sum-card ${r.status}` },
        h("div", { class: "model-head" },
          h("b", {}, shortName(m)),
          m.id === fastest && h("span", { class: "chip good" }, "🏃 最速"),
          m.id === cheapest && h("span", { class: "chip good" }, "💰 最安"),
        ),
        h("small", { class: "maker" }, maker(m)),
        r.status === "loading" && h("p", { class: "thinking" }, h("span", { class: "spinner", "aria-hidden": "true" }), "考え中…"),
        r.status === "error" && h("p", { class: "error-text" }, "😢 " + r.error),
        r.status === "ok" &&
          h("dl", { class: "stats" },
            h("dt", {}, "⏱ 応答時間"), h("dd", {}, `${(r.latencyMs / 1000).toFixed(2)} 秒`),
            h("dt", {}, "💰 今回の費用"), h("dd", {}, yen(usage?.cost)),
            h("dt", {}, "🔁 1万回なら"), h("dd", {}, usage?.cost != null ? yen(usage.cost * 10000) : "—"),
            h("dt", {}, "📖 読んだ量"), h("dd", {}, usage ? `${usage.input_tokens.toLocaleString()} トークン` : "—"),
          ),
      );
    }),
  );
}

function renderAnswers(run) {
  return Object.entries(run.questions).map(([id, q], i) => {
    const verdicts = run.models
      .filter((m) => run.results[m.id].status === "ok")
      .map((m) => verdictOf(q, run.results[m.id].data?.answers?.[id]))
      .filter((v) => v != null);
    const agree = verdicts.length >= 2 ? verdicts.every((v) => v === verdicts[0]) : null;

    return h(
      "section",
      { class: "card answer" },
      h("div", { class: "answer-head" },
        h("span", { class: "q-label" }, `質問${i + 1}`),
        h("span", { class: `type-badge t-${q.type}` }, TYPE_LABEL[q.type]),
        agree === true && h("span", { class: "chip good" }, "✅ 意見が一致"),
        agree === false && h("span", { class: "chip warn" }, "⚠️ 意見が分かれました"),
      ),
      h("h3", {}, q.instructions),
      h(
        "div",
        { class: "answer-grid" },
        run.models.map((m) => {
          const r = run.results[m.id];
          return h(
            "div",
            { class: "cell" },
            h("p", { class: "cell-model" }, shortName(m)),
            r.status === "loading" && h("div", { class: "skeleton" }, h("i"), h("i"), h("i")),
            r.status === "error" && h("p", { class: "error-text small" }, "答えを取得できませんでした"),
            r.status === "ok" && answerCell(q, r.data?.answers?.[id]),
          );
        }),
      ),
    );
  });
}

function renderRaw(run) {
  const raw = Object.fromEntries(run.models.map((m) => [m.id, run.results[m.id].data ?? run.results[m.id]]));
  return h(
    "details",
    { class: "card raw" },
    h("summary", {}, "🔧 開発者向け：生のデータ（JSON）を見る"),
    h("pre", {}, JSON.stringify({ questions: run.questions, responses: raw }, null, 2)),
  );
}

function renderResults(run) {
  $("#summary").replaceChildren(...renderSummary(run));
  $("#answers").replaceChildren(...renderAnswers(run), renderRaw(run));
}

// ---------------------------------------------------------------- 起動

$("#stateMax").textContent = STATE_MAX.toLocaleString();
$("#maxModels").textContent = String(MAX_MODELS);
$("#state").addEventListener("input", updateCounter);
$("#addQuestion").addEventListener("click", () => {
  app.questions.push(newQuestion());
  renderQuestions();
});
$("#run").addEventListener("click", run);

applyPreset(PRESETS[0]);
loadModels();
loadRate();
