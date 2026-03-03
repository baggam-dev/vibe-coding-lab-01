require("dotenv").config();
const http = require("http");
const { OpenAI } = require("openai");
const url = require("url");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

// ✅ JSON body 읽기 (Node http 기본)
function readJsonBody(req, limitBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    let data = "";

    req.on("data", (chunk) => {
      data += chunk;
      if (Buffer.byteLength(data, "utf8") > limitBytes) {
        reject(new Error("Payload too large"));
        req.destroy();
      }
    });

    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(new Error("Invalid JSON"));
      }
    });

    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const parsed = url.parse(req.url, true);

    // 1) 헬스체크
    if (parsed.pathname === "/" || parsed.pathname === "/health") {
      return sendJson(res, 200, { ok: true, message: "server running" });
    }

    // 2) GET /generate?prompt=... (테스트용 유지)
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

    // ✅ 3) POST /generate  (실전용)
    if (parsed.pathname === "/generate" && req.method === "POST") {
      const ct = (req.headers["content-type"] || "").toLowerCase();
      if (!ct.includes("application/json")) {
        return sendJson(res, 415, {
          ok: false,
          error: "Content-Type must be application/json",
        });
      }

      const body = await readJsonBody(req);
      const prompt = (body.prompt || "").toString().trim();

      if (!prompt) {
        return sendJson(res, 400, {
          ok: false,
          error: "Missing prompt in JSON body. Example: {\"prompt\":\"...\"}",
        });
      }

      // (선택) 파라미터로 톤/난이도도 받을 수 있게 확장 가능
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
    const msg =
      e?.message === "Invalid JSON"
        ? "Invalid JSON body"
        : e?.message === "Payload too large"
        ? "Payload too large"
        : "Server error";
    return sendJson(res, 500, { ok: false, error: msg });
  }
});

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`Server running on ${port}`));