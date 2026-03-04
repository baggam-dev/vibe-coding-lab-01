require("dotenv").config();

const http = require("http");
const { OpenAI } = require("openai");
const { URL } = require("url");
const crypto = require("crypto");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// =========================
// Config
// =========================
// Render 프론트 URL을 명시적으로 허용하는 것을 추천합니다.
// 예: ALLOWED_ORIGINS="http://localhost:5173,https://vibe-coding-lab-01-web.onrender.com"
const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

// 디버그 중이면 true 추천 (Render 로그에서 보기 좋음)
const DEBUG = (process.env.DEBUG || "true").toLowerCase() === "true";

// =========================
// Helpers
// =========================
function nowMs() {
  return Date.now();
}

function reqId() {
  return crypto.randomBytes(6).toString("hex"); // 12 chars
}

function log(...args) {
  if (DEBUG) console.log(...args);
}

function setNoStore(res) {
  // 304/캐시로 인한 이상 동작 방지
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate",
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

function setCors(req, res) {
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Cache-Control, Pragma",
  );
}

function sendJson(req, res, status, data) {
  setCors(req, res);
  setNoStore(res);

  const body = JSON.stringify(data);

  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body, "utf8"),
  });
  res.end(body);
}

function sendText(req, res, status, text) {
  setCors(req, res);
  setNoStore(res);

  const body = String(text ?? "");
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(body, "utf8"),
  });
  res.end(body);
}

// ✅ JSON body 읽기 (Node http 기본)
function readJsonBody(req, limitBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    let data = "";

    req.on("data", (chunk) => {
      data += chunk;
      if (Buffer.byteLength(data, "utf8") > limitBytes) {
        reject(new Error("PayloadTooLarge"));
        req.destroy();
      }
    });

    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("InvalidJson"));
      }
    });

    req.on("error", reject);
  });
}

async function generateWithOpenAI(prompt) {
  // 프론트에서 “5줄” 프롬프트를 이미 강제하므로,
  // 여기서는 prompt 그대로 전달하는 게 가장 직관적입니다.
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      // system은 최소로 유지(프롬프트를 덮어쓰지 않게)
      { role: "system", content: "당신은 한국어 동화 작가입니다." },
      { role: "user", content: prompt },
    ],
    temperature: 0.9,
  });

  const text = completion.choices?.[0]?.message?.content ?? "";
  return text;
}

// =========================
// Handlers
// =========================
async function handleHealth(req, res, _url, rid) {
  return sendJson(req, res, 200, { ok: true, message: "server running", rid });
}

async function handleGenerateGet(req, res, url, rid) {
  const prompt = (url.searchParams.get("prompt") || "").trim();
  if (!prompt) {
    return sendJson(req, res, 400, {
      ok: false,
      rid,
      error: "Missing prompt. Use /generate?prompt=...",
    });
  }

  const text = await generateWithOpenAI(prompt);

  return sendJson(req, res, 200, {
    ok: true,
    rid,
    prompt,
    text,
    // 프론트가 기대하는 키도 같이 제공 (호환성)
    story: text,
  });
}

async function handleGeneratePost(req, res, _url, rid) {
  const ct = (req.headers["content-type"] || "").toLowerCase();
  if (!ct.includes("application/json")) {
    return sendJson(req, res, 415, {
      ok: false,
      rid,
      error: "Content-Type must be application/json",
    });
  }

  const body = await readJsonBody(req);
  const prompt = (body.prompt || "").toString().trim();

  if (!prompt) {
    return sendJson(req, res, 400, {
      ok: false,
      rid,
      error: 'Missing prompt in JSON body. Example: {"prompt":"..."}',
    });
  }

  const text = await generateWithOpenAI(prompt);

  // ✅ 반드시 story 키 포함 (프론트가 안정적으로 표시)
  return sendJson(req, res, 200, { ok: true, rid, text, story: text });
}

// =========================
// Server
// =========================
const server = http.createServer(async (req, res) => {
  const start = nowMs();
  const rid = reqId();

  // 요청/응답 추적용: status, bytes 로깅
  let bytesWritten = 0;
  const _end = res.end.bind(res);
  res.end = (chunk, encoding, cb) => {
    if (chunk) {
      bytesWritten += Buffer.isBuffer(chunk)
        ? chunk.length
        : Buffer.byteLength(String(chunk), encoding || "utf8");
    }
    return _end(chunk, encoding, cb);
  };

  try {
    // 공통 헤더
    setCors(req, res);
    setNoStore(res);

    // ✅ 프리플라이트 처리 (중요)
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      log(
        `[${rid}] OPTIONS ${req.url} -> 204 (${nowMs() - start}ms) bytes=${bytesWritten}`,
      );
      return;
    }

    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    const pathname = urlObj.pathname;

    // 라우팅
    if (pathname === "/" || pathname === "/health") {
      await handleHealth(req, res, urlObj, rid);
    } else if (pathname === "/generate" && req.method === "GET") {
      await handleGenerateGet(req, res, urlObj, rid);
    } else if (pathname === "/generate" && req.method === "POST") {
      await handleGeneratePost(req, res, urlObj, rid);
    } else {
      sendJson(req, res, 404, { ok: false, rid, error: "Not found" });
    }

    log(
      `[${rid}] ${req.method} ${pathname} -> ${res.statusCode} (${nowMs() - start}ms) bytes=${bytesWritten}`,
    );
  } catch (e) {
    console.error(`[${rid}] ERROR`, e);

    const msg =
      e?.message === "InvalidJson"
        ? "Invalid JSON body"
        : e?.message === "PayloadTooLarge"
          ? "Payload too large"
          : "Server error";

    // 에러도 JSON으로, 바디 비우지 않기
    sendJson(req, res, 500, { ok: false, rid, error: msg });
    log(
      `[${rid}] ${req.method} ${req.url} -> 500 (${nowMs() - start}ms) bytes=${bytesWritten}`,
    );
  }
});

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`Server running on ${port}`));
