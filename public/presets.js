// お題のサンプル。questions は OpenRouter Decisions API の形式そのまま。

export const PRESETS = [
  {
    id: "support",
    icon: "🛠️",
    title: "問い合わせの振り分け",
    desc: "お客さまの問い合わせを、どのチームが担当するか・急ぎかどうか判断",
    state:
      "お世話になっております。昨日から、決済画面で「支払う」ボタンを押すと画面が真っ白になってしまいます。" +
      "Chrome と Safari の両方で試しましたが同じでした。本日中に支払いを済ませたいので、至急対応をお願いします。",
    questions: {
      q1: {
        type: "noul",
        instructions: "お客さまはシステムの不具合を報告していますか？",
        criteria: {
          true: "製品やサービスが壊れている・想定外の動きをしていると説明している",
          false: "使い方の質問や、機能の要望をしている",
        },
      },
      q2: {
        type: "choice",
        instructions: "どのチームがこの問い合わせを担当すべきですか？",
        criteria: {
          決済チーム: "支払い・請求・決済処理に関する問題",
          画面チーム: "画面表示・レイアウト・ブラウザ対応に関する問題",
          アカウントチーム: "ログイン・権限・プロフィールに関する問題",
        },
      },
      q3: {
        type: "score",
        instructions: "この問い合わせの緊急度はどれくらいですか？",
        criteria: ["次のリリースまで待てる", "今週中に対応すべき", "いますぐ売上に影響している"],
      },
    },
  },
  {
    id: "review",
    icon: "⭐",
    title: "口コミの評価",
    desc: "商品レビューが好意的か、どのくらい満足しているかを判断",
    state:
      "デザインはすごく可愛くて気に入っています！ただ、届くまでに10日もかかったのと、" +
      "説明書が英語だけだったのは少し残念でした。使い心地は今のところ問題ありません。",
    questions: {
      q1: {
        type: "choice",
        instructions: "このレビュー全体の印象はどれですか？",
        criteria: {
          好意的: "全体として満足している・おすすめしている",
          否定的: "全体として不満がある・おすすめしない",
          賛否両論: "良い点と悪い点が同じくらい書かれている",
        },
      },
      q2: {
        type: "score",
        instructions: "購入者の満足度はどれくらいですか？",
        criteria: ["とても不満", "やや不満", "ふつう", "やや満足", "とても満足"],
      },
      q3: {
        type: "noul",
        instructions: "配送についての不満が書かれていますか？",
        criteria: {
          true: "配送の遅さ・梱包・配達員など、配送に関する不満がある",
          false: "配送に関する不満は書かれていない",
        },
      },
    },
  },
  {
    id: "spam",
    icon: "🚨",
    title: "あやしいメールの検出",
    desc: "受信したメールが詐欺・迷惑メールかどうかを判断",
    state:
      "【重要】お客様のアカウントで不正なログインが検出されました。24時間以内に下記URLから本人確認を行わない場合、" +
      "アカウントは永久に停止されます。 http://secure-login-verify.example.com/account",
    questions: {
      q1: {
        type: "noul",
        instructions: "このメールは詐欺（フィッシング）メールですか？",
        criteria: {
          true: "偽のサイトに誘導し、パスワードや個人情報を盗もうとしている",
          false: "正規の企業や知人からの、ふつうの連絡である",
        },
      },
      q2: {
        type: "choice",
        instructions: "このメールの種類はどれですか？",
        criteria: {
          フィッシング: "本人確認などを装って情報を盗もうとする",
          広告: "商品やサービスの宣伝",
          業務連絡: "仕事上のふつうのやりとり",
          個人的な連絡: "家族や友人からの連絡",
        },
      },
      q3: {
        type: "score",
        instructions: "受け取った人にとっての危険度はどれくらいですか？",
        criteria: ["安全", "少し注意", "かなり危険", "非常に危険"],
      },
    },
  },
  {
    id: "blank",
    icon: "✍️",
    title: "自分でつくる",
    desc: "文章も質問もゼロから自由に試す",
    state: "",
    questions: {
      q1: {
        type: "noul",
        instructions: "",
        criteria: { true: "", false: "" },
      },
    },
  },
];

// 注目モデルの日本語紹介（それ以外は OpenRouter の説明文を表示）
export const MODEL_NOTES = {
  "typesafe/jev-1.13": "TypeSafe社の判断AI「System One」シリーズ第1弾。料金がとても安いのが魅力。",
  "~typesafe/jev-latest": "Jev の最新版を自動で使う別名。中身は Jev と同じ系列です。",
  "cloudflare/clef": "Cloudflare社のオープンな判断AI（27B）。Jev と同じ形式で使え、画像も読める精度重視タイプ。",
  "cloudflare/clef-flash": "Clef の軽量版（9B）。精度より速さを重視したタイプ。",
};
