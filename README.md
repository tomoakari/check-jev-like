# check-jev-like（判断AIくらべ）

OpenRouter で使える **「判断AI」**（TypeSafe の **Jev**、Cloudflare の **Clef / Clef Flash** など）に、
おなじ文章・おなじ質問をまとめて送り、**答え・確率・速さ・費用** を並べて比べるサンプルページです。
Cloudflare Workers にそのままデプロイできます。

## 判断AIとは

チャットAIのように文章を書くのではなく、こちらが用意した質問に **型の決まった答え＋確率** で返すモデルです。
OpenRouter の [Decisions API](https://openrouter.ai/docs/guides/community/jev)（`POST /api/alpha/decisions`）で呼び出します。

| 質問の種類 | API の `type` | 返ってくるもの |
| - | - | - |
| はい／いいえ | `noul` | 「はい」の確率 |
| 選択 | `choice` | 選ばれた選択肢、各選択肢の確率、信頼度 |
| 段階評価 | `score` | 段階上の位置（スコア）、各段階の確率、信頼度 |

比較できるモデルは、OpenRouter のモデル一覧から **出力が `decisions` のもの** を自動で取得します。
最初にチェックが入るモデルは `wrangler.jsonc` の `DEFAULT_MODELS` で変えられます。

## しくみ

```
ブラウザ (public/)                    Cloudflare Worker (src/)                 OpenRouter
 ├ index.html / style.css            ├ index.ts      … ルーティング
 ├ app.js   … 画面の動き   ──fetch──▶ ├ validate.ts   … 入力チェック   ──────▶  /api/v1/models
 └ presets.js … お題サンプル          ├ openrouter.ts … API 呼び出し   ──────▶  /api/alpha/decisions
                                      └ rate.ts       … ドル円レート   ──────▶  Frankfurter
```

- `GET /api/models` … 比較できる判断AIの一覧（10分キャッシュ）
- `POST /api/decide` … 1つのモデルに判断させる。ブラウザはモデルごとに並列で呼ぶので、速いモデルから順に結果が出ます
- `GET /api/rate` … ドル円レート。料金はドル建てなので、画面では円に換算して表示します。
  レートは [Frankfurter](https://frankfurter.dev/)（欧州中央銀行の参考レート、APIキー不要）から取得し、6時間キャッシュします。
  取得できないときは `FALLBACK_USD_JPY`（既定 157円）を使います
- API キーは Worker の secret にだけ置き、ブラウザには出しません
- 公開ページなので、入力サイズの制限・モデルの許可リスト・IP ごとのレート制限（1分30回）をかけています

フレームワークは使わず、Worker も画面も素の TypeScript / JavaScript です。

## ローカルで動かす

Node.js 20 以上が必要です。

```bash
npm install
cp .dev.vars.example .dev.vars   # 中の OPENROUTER_API_KEY を自分のキーに書きかえる
npm run dev                      # http://localhost:8787
```

API キーは https://openrouter.ai/settings/keys で作れます（判断AIの利用にはクレジットが必要です）。

## Cloudflare Workers にデプロイ

```bash
npx wrangler login
npx wrangler secret put OPENROUTER_API_KEY   # プロンプトにキーを貼りつける
npm run deploy
```

表示された `https://check-jev-like.<あなたのサブドメイン>.workers.dev` を開けば完成です。

### ブランチごとのプレビュー（Workers Builds を使う場合）

GitHub 連携の Workers Builds では、main 以外のブランチに push すると `npx wrangler preview` でプレビューが作られます。
プレビューは本番の設定を引き継がないので、`wrangler.jsonc` の `previews` ブロックに同じ変数とレート制限を書いてあります。
API キーだけは設定ファイルに書けないので、最初に一度だけプレビュー用にも登録してください。

```bash
npx wrangler preview base-config secret put OPENROUTER_API_KEY
```

> 💡 だれでも開けるURLになり、実行するたびにあなたの OpenRouter クレジットが使われます。
> 判断AIは1回あたり約0.02円未満とかなり安いですが、気になる場合は OpenRouter 側でキーに利用上限を設定するか、
> [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) でページに認証をかけてください。

## 開発用コマンド

| コマンド | 内容 |
| - | - |
| `npm run dev` | ローカルサーバー起動 |
| `npm test` | ユニットテスト（入力チェック・為替レート） |
| `npm run typecheck` | 型チェック |
| `npm run types` | `wrangler.jsonc` を変えたあとに型定義を再生成 |
| `npm run deploy` | Cloudflare にデプロイ |

## カスタマイズ

- **お題サンプルを増やす** … `public/presets.js` の `PRESETS` に追加
- **モデルの日本語紹介** … `public/presets.js` の `MODEL_NOTES`
- **最初に選ばれるモデル** … `wrangler.jsonc` の `DEFAULT_MODELS`
- **レート制限** … `wrangler.jsonc` の `ratelimits`
- **為替レートの予備値** … `wrangler.jsonc` の `FALLBACK_USD_JPY`
