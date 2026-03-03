require("dotenv").config();
const http = require("http");
const { OpenAI } = require("openai");
const url = require("url");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  try {
    const parsed = url.parse(req.url, true);

    // 1) 헬스체크
    if (parsed.pathname === "/" || parsed.pathname === "/health") {
      return sendJson(res, 200, { ok: true, message: "server running" });
    }

    // 2) 동적 생성: GET /generate?prompt=...
    if (parsed.pathname === "/generate" && req.method === "GET") {
      const prompt = (parsed.query.prompt || "").toString().trim();

      if (!prompt) {
        return sendJson(res, 400, {
          ok: false,
          error: "Missing prompt. Use /generate?prompt=...",
        });
      }

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "당신은 한국어 인터랙티브 스토리 작가입니다. 6~10문장 내로 장면을 쓰고, 마지막에 선택지 3개를 A/B/C로 제시하세요.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.9,
      });

      const text = completion.choices?.[0]?.message?.content ?? "";
      return sendJson(res, 200, { ok: true, prompt, text });
    }

    return sendJson(res, 404, { ok: false, error: "Not found" });
  } catch (e) {
    console.error(e);
    return sendJson(res, 500, { ok: false, error: "Server error" });
  }
});

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`Server running on ${port}`));