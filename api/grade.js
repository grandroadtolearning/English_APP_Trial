// Vercel Serverless Function — Gemini 評估（Stage 3 用自己的話解釋）
// 讀環境變數 GEMINI_API_KEY，前端用同源 fetch('/api/grade') 呼叫，金鑰不進瀏覽器。

const MODEL = "gemini-2.5-flash"; // 如需改模型，改這行
const ENDPOINT = (key) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;

function buildPrompt(payload) {
  const { word, answers } = payload;
  const a = answers || {};
  return `你是一位親切、鼓勵導向的英文老師，學生是台灣「國三升高一」的學生。
請用「繁體中文」回饋，語氣溫暖。避免「學測、指考」等高三詞彙，可用「段考、升高中」。

學生剛學完單字「${word}」，現在要「用自己的話解釋學到的內容」。以下是學生用語音說出來的回答
（語音轉文字，可能有辨識誤差，請容忍小錯）：

1. 易混淆詞（這個字和相似字 empty 的差異）：「${a.compare || "（未作答）"}」
2. 搭配詞（記得的搭配詞和意思）：「${a.collocations || "（未作答）"}」
3. 詞性變化（不同詞性的變化形式）：「${a.forms || "（未作答）"}」

請逐項評估學生答得好不好，給具體又簡短的回饋。只回傳 JSON，格式如下，不要任何多餘文字：
{
  "items": [
    {"key":"compare","ok":true 或 false,"comment":"針對易混淆詞的回饋（繁體中文，1-2句）"},
    {"key":"collocations","ok":true 或 false,"comment":"針對搭配詞的回饋"},
    {"key":"forms","ok":true 或 false,"comment":"針對詞性變化的回饋"}
  ],
  "overall":"一句總結 + 鼓勵（繁體中文）"
}`;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    res.status(500).json({ error: "Server missing GEMINI_API_KEY" });
    return;
  }
  try {
    const body =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const { word, answers } = body;

    const hasAny =
      answers && (answers.compare || answers.collocations || answers.forms);
    if (!hasAny) {
      res.status(400).json({ error: "還沒有作答內容" });
      return;
    }

    const prompt = buildPrompt({ word: word || "hollow", answers });

    const geminiResp = await fetch(ENDPOINT(key), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
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
