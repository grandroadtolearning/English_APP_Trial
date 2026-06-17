// Vercel Serverless Function — Gemini 評估
// 讀環境變數 GEMINI_API_KEY，前端用同源 fetch('/api/grade') 呼叫，金鑰不進瀏覽器。
// 兩種模式：
//   mode 'recall'   → Stage 2 主動回想：接收「一段連續錄音」(base64)，Gemini 原生音訊「轉錄＋評估」
//   mode 'sentence' → Stage 3 靈魂連結：造句批改（文字，可深度解析）

const MODEL = "gemini-2.5-flash"; // 如需改模型，改這行
const ENDPOINT = (key) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;

const COMMON = `你是一位親切、鼓勵導向的英文老師，學生是台灣「國三升高一」的學生。
請用「繁體中文」回饋，語氣溫暖。避免「學測、指考」等高三詞彙，可用「段考、會考、升高中」。`;

function recallPrompt(word) {
  return `${COMMON}

學生剛學完單字「${word}」，用「一段連續錄音」依序回答了三個面向（可能有些沒答到）：
1) compare：這個字和相似字 empty 的差異
2) collocations：記得的搭配詞和意思（例如 hollow out、a hollow victory）
3) forms：不同詞性的變化（hollow adj./n./v.、hollowness n.）

請先「完整轉錄」這段英文/中文錄音，再就三個面向各自評估答得好不好。
只回傳 JSON，不要多餘文字：
{
  "transcript":"整段錄音的逐字轉錄",
  "items":[
    {"key":"compare","ok":true 或 false,"comment":"回饋（繁中,1-2句）；若沒答到就說明還沒提到"},
    {"key":"collocations","ok":true 或 false,"comment":"回饋"},
    {"key":"forms","ok":true 或 false,"comment":"回饋"}
  ],
  "overall":"一句總結 + 鼓勵（繁中）"
}`;
}

function sentencePrompt({ word, sentence, deep }) {
  return `${COMMON}

學生要用單字「${word}」造一個跟自己有關的句子。學生寫的是：「${sentence}」。

請批改這個句子。${deep ? "請做「深度解析」，包含文法、句構、用字。" : "給簡潔回饋即可。"}
只回傳 JSON，不要多餘文字：
{
  "corrected_sentence":"修正後最自然的英文句子",
  "error_category":"3-6字標出主要問題類型（時態/介係詞/用字/語意…），幾乎沒錯就寫「很棒」",
  "quick_tip":"一句最重要的修改重點（繁中）",
  "diagnosis":${deep ? '"深入說明為什麼這樣改：文法、句構、用字（繁中,2-3句）"' : "null"},
  "closing":"一句溫暖鼓勵（繁中）"
}`;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  // 同時相容大小寫的變數名稱（GEMINI_API_KEY / gemini_api_key）
  const key = process.env.GEMINI_API_KEY || process.env.gemini_api_key;
  if (!key) { res.status(500).json({ error: "Server missing GEMINI_API_KEY" }); return; }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const word = body.word || "hollow";
    const mode = body.mode || (body.audio ? "recall" : "sentence");

    let parts;
    if (mode === "recall") {
      const audio = body.audio;
      if (!audio) { res.status(400).json({ error: "沒有收到錄音" }); return; }
      parts = [
        { text: recallPrompt(word) },
        { inlineData: { mimeType: body.mime || "audio/webm", data: audio } },
      ];
    } else {
      const sentence = (body.sentence || "").trim();
      if (sentence.length < 2) { res.status(400).json({ error: "還沒有句子內容" }); return; }
      parts = [{ text: sentencePrompt({ word, sentence, deep: body.deep !== false }) }];
    }

    const geminiResp = await fetch(ENDPOINT(key), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { temperature: 0.4, responseMimeType: "application/json" },
      }),
    });

    if (!geminiResp.ok) {
      const errText = await geminiResp.text();
      console.error("Gemini error:", geminiResp.status, errText);
      res.status(502).json({ error: "AI 暫時無法回應，請再試一次" });
      return;
    }

    const data = await geminiResp.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
    res.status(200).json(parsed);
  } catch (err) {
    console.error("grade.js error:", err);
    res.status(500).json({ error: "伺服器發生錯誤，請再試一次" });
  }
};
