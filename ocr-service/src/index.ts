#!/usr/bin/env node
/**
 * OCR Service — Receipt Parsing Microservice
 *
 * Exposes POST /scan endpoint that accepts images (multipart/form-data or JSON base64)
 * and returns structured receipt data using LlamaParse OCR.
 *
 * Architecture:
 *   - Express.js HTTP server
 *   - Multer for multipart form-data parsing
 *   - LlamaParse API for OCR
 *   - Custom markdown parser for receipt extraction
 *   - Vendor-to-category inference
 *
 * Endpoints:
 *   POST /scan  — Parse receipt image, return structured JSON
 *   GET  /health — Health check { "ok": true }
 *
 * Configuration: See .env.example
 */

import express from "express";
import cors from "cors";
import multer from "multer";
import dotenv from "dotenv";
import FormData from "form-data";

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: "*", methods: ["POST", "OPTIONS", "GET"] }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// ─── Multer config (memory storage, max 10MB) ─────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE || "10485760") }, // 10 MB default
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/heic"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
  },
});

// ─── Utilities ────────────────────────────────────────────────────────────────
function formatMoney(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(amount);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryWithBackoff<T>(fn: () => Promise<T>, maxAttempts = 3, baseDelay = 800): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isLastAttempt = attempt === maxAttempts - 1;
      if (isLastAttempt) break;
      const delay = baseDelay * 2 ** attempt;
      await sleep(delay);
    }
  }
  throw lastError;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function parseNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.-]/g, "");
    const parsed = Number(cleaned);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function toIsoOrNow(value: string | null): string {
  if (!value) return new Date().toISOString();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
}

function inferExtensionFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  if (!ext) return "jpg";
  if (["jpg", "jpeg", "png", "webp", "heic", "pdf"].includes(ext)) return ext === "jpeg" ? "jpg" : ext;
  return "jpg";
}

function inferFileExtension(mimeType: string): string {
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("heic")) return "heic";
  if (mimeType.includes("pdf")) return "pdf";
  return "jpg";
}

// ─── LlamaParse Integration ───────────────────────────────────────────────────
const LLAMAPARSE_API_KEY = process.env.LLAMAPARSE_API_KEY;
const LLAMA_UPLOAD_BASES = [
  "https://api.cloud.llamaindex.ai/api/v1/parsing",
  "https://api.cloud.llamaindex.ai/api/parsing",
];

type ParsedLineItem = {
  date: string | null;
  description: string;
  amount: number;
  confidence?: number;
};

type ParsedStatement = {
  vendor: string | null;
  date: string | null;
  line_items: ParsedLineItem[];
  tax_total: number;
  grand_total: number;
  field_confidence?: {
    vendor?: number;
    date?: number;
    tax_total?: number;
    grand_total?: number;
  };
};

function extractLastMoneyValue(text: string): number | null {
  const matches = text.match(/-?\$?\s*\d{1,3}(?:,\d{3})*(?:\.\d{2})?/g);
  if (!matches || matches.length === 0) return null;
  return round2(Math.abs(parseNumber(matches[matches.length - 1])));
}

function extractDateValue(text: string): string | null {
  const matched = text.match(/\b(?:\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})\b/);
  return matched?.[0] ?? null;
}

function parseLlamaMarkdown(markdown: string): ParsedStatement {
  const lines = markdown
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const candidateVendor =
    lines.find((line) => line.startsWith("# "))?.replace(/^#\s+/, "") ??
    lines.find((line) => /hotel|inn|resort|receipt|folio/i.test(line) && !line.includes("|")) ??
    null;

  const markdownRows = lines
    .filter((line) => line.includes("|"))
    .filter((line) => !/^\|?\s*:?-{2,}/.test(line))
    .map((line) => line.split("|").map((cell) => cell.trim()).filter(Boolean));

  const tableHeaderIdx = markdownRows.findIndex((cells) => {
    const joined = cells.join(" ").toLowerCase();
    return joined.includes("date") && joined.includes("description") && (joined.includes("charge") || joined.includes("credit"));
  });

  const header = tableHeaderIdx >= 0 ? markdownRows[tableHeaderIdx].map((c) => c.toLowerCase()) : [];
  const dateIdx = header.findIndex((h) => h.includes("date"));
  const descriptionIdx = header.findIndex((h) => h.includes("description"));
  const addlIdx = header.findIndex((h) => h.includes("additional"));
  const chargesIdx = header.findIndex((h) => h.includes("charge") || h.includes("debit"));
  const creditsIdx = header.findIndex((h) => h.includes("credit") || h.includes("payment"));

  const lineItems: ParsedLineItem[] = [];

  for (let i = tableHeaderIdx + 1; i < markdownRows.length; i += 1) {
    const cells = markdownRows[i];
    if (!cells.length) continue;

    const descriptionParts: string[] = [];
    if (descriptionIdx >= 0 && cells[descriptionIdx]) descriptionParts.push(cells[descriptionIdx]);
    if (addlIdx >= 0 && cells[addlIdx]) descriptionParts.push(cells[addlIdx]);
    if (!descriptionParts.length) {
      for (let c = 0; c < cells.length; c += 1) {
        if (c === chargesIdx || c === creditsIdx) continue;
        if (cells[c]) descriptionParts.push(cells[c]);
      }
    }

    const description = descriptionParts.join(" ").replace(/\s+/g, " ").trim();
    if (!description) continue;

    const descLower = description.toLowerCase();
    const chargeValue = chargesIdx >= 0 ? round2(Math.abs(parseNumber(cells[chargesIdx] ?? ""))) : 0;
    const creditValue = creditsIdx >= 0 ? round2(Math.abs(parseNumber(cells[creditsIdx] ?? ""))) : 0;

    if (/total charges/i.test(descLower)) continue;
    if (/total credits|balance due|balance/i.test(descLower)) continue;

    const isPaymentLike = /mastercard|visa|amex|payment|credit card|debit card|card ending/i.test(descLower) || creditValue > 0;
    if (isPaymentLike) continue;

    const isTaxSummaryLine = /gst summary|tax summary|vat summary/i.test(descLower);
    if (isTaxSummaryLine) continue;

    const amountCandidate = chargeValue || round2(Math.abs(extractLastMoneyValue(cells.join(" ")) ?? 0));
    if (!Number.isFinite(amountCandidate) || amountCandidate <= 0) continue;

    lineItems.push({
      date: dateIdx >= 0 ? extractDateValue(cells[dateIdx] ?? "") : extractDateValue(cells[0] ?? ""),
      description,
      amount: amountCandidate,
      confidence: 0.84,
    });
  }

  const taxFromLines = round2(
    lineItems
      .filter((item) => /\btax\b|\bgst\b|\bvat\b/i.test(item.description.toLowerCase()))
      .reduce((sum, item) => sum + item.amount, 0)
  );
  const taxTotal = taxFromLines;

  const totalChargesLine = lines.find((line) => /total charges/i.test(line));
  const grandLine =
    totalChargesLine ??
    lines.find((line) => /grand total|amount due|total due|balance due/i.test(line)) ??
    [...lines].reverse().find((line) => /\btotal\b/i.test(line));
  const grandFromLine = extractLastMoneyValue(grandLine ?? "");

  const lineItemsTotal = round2(lineItems.reduce((sum, item) => sum + item.amount, 0));
  const computedTotal = round2(lineItemsTotal + taxTotal);
  const grandTotal = round2(Math.abs(grandFromLine ?? lineItemsTotal));

  const firstDate = lineItems.find((item) => item.date)?.date ?? extractDateValue(markdown);

  return {
    vendor: candidateVendor,
    date: firstDate,
    line_items: lineItems,
    tax_total: taxTotal,
    grand_total: grandTotal,
    field_confidence: {
      vendor: candidateVendor ? 0.72 : 0.45,
      date: firstDate ? 0.78 : 0.4,
      tax_total: taxTotal > 0 ? 0.8 : 0.55,
      grand_total: grandFromLine ? 0.86 : 0.62,
    },
  };
}

function selectCategoryFromVendor(vendor: string | null): Category | null {
  const name = (vendor || "").toLowerCase();
  if (name.includes("hotel") || name.includes("inn") || name.includes("resort")) return "Travel";
  if (name.includes("uber") || name.includes("lyft") || name.includes("airline") || name.includes("taxi")) return "Transport";
  if (name.includes("restaurant") || name.includes("cafe") || name.includes("bar") || name.includes("coffee") || name.includes("food")) return "Food";
  if (name.includes("amazon") || name.includes("shop") || name.includes("store") || name.includes("mart") || name.includes("market")) return "Shopping";
  if (name.includes("netflix") || name.includes("spotify") || name.includes("movie") || name.includes("theatre") || name.includes("game")) return "Entertainment";
  if (name.includes("utility") || name.includes("phone") || name.includes("internet") || name.includes("bill") || name.includes("electric") || name.includes("water")) return "Bills";
  if (name.includes("pharmacy") || name.includes("hospital") || name.includes("clinic") || name.includes("doctor")) return "Health";
  if (name.includes("salary") || name.includes("payroll")) return "Salary";
  if (name.includes("freelance") || name.includes("contract") || name.includes("invoice")) return "Freelance";
  if (name.includes("investment") || name.includes("stock") || name.includes("dividend")) return "Investment";
  return null;
}

interface LlamaParseUploadResponse {
  id?: string;
  job_id?: string;
  jobId?: string;
  parsing_job_id?: string;
  data?: { id?: string; job_id?: string };
}

const VALID_CATEGORIES = [
  "Food",
  "Transport",
  "Shopping",
  "Entertainment",
  "Bills",
  "Health",
  "Travel",
  "Salary",
  "Freelance",
  "Investment",
  "Other",
] as const;

type Category = (typeof VALID_CATEGORIES)[number];

async function imagePayloadToBlob(payload: string): Promise<{ blob: Buffer; mimeType: string; extension: string }> {
  if (payload.startsWith("data:")) {
    const match = payload.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) throw new Error("Invalid data URL image payload");

    const mimeType = match[1] || "image/jpeg";
    const base64 = match[2] || "";
    const binary = Buffer.from(base64, "base64");

    return {
      blob: binary,
      mimeType,
      extension: inferFileExtension(mimeType),
    };
  }

  throw new Error("Remote URL fetching from client not supported in standalone mode; please upload image as multipart/form-data or base64 JSON");
}

async function fetchLlamaParseMarkdown(base: string, jobId: string, apiKey: string): Promise<string> {
  const endpoint = `${base}/job/${jobId}/result/markdown`;

  const attemptFetch = async (): Promise<string> => {
    const response = await fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (response.ok) {
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const json = await response.json();
        const markdown =
          json?.markdown ??
          json?.content ??
          json?.result?.markdown ??
          json?.result?.content ??
          json?.data?.markdown;
        if (!markdown || typeof markdown !== "string") {
          throw new Error("LlamaParse returned an empty markdown result");
        }
        return markdown;
      }

      const markdownText = await response.text();
      if (!markdownText.trim()) throw new Error("LlamaParse returned empty markdown text");
      return markdownText;
    }

    if ([202, 404, 409, 425, 429, 500, 502, 503, 504].includes(response.status)) {
      const body = await response.text();
      throw new Error(`Retryable error (${response.status}): ${body}`);
    }

    const body = await response.text();
    throw new Error(`LlamaParse result fetch failed (${response.status}): ${body}`);
  };

  try {
    return await retryWithBackoff(attemptFetch, 6, 1500);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("401") || msg.includes("403") || msg.includes("Invalid API key")) {
      throw new Error("LlamaParse authentication failed. Check your API key.");
    }
    throw err;
  }
}

async function parseWithLlamaParse(imageInput: string, apiKey: string): Promise<string> {
  const { blob, extension } = await imagePayloadToBlob(imageInput);
  let lastError: unknown;
  for (const base of LLAMA_UPLOAD_BASES) {
    try {
      const jobId = await uploadToLlamaParse(blob, extension, apiKey, base);
      return await fetchLlamaParseMarkdown(base, jobId, apiKey);
    } catch (err) {
      lastError = err;
      // Continue to next base if available
    }
  }
  throw lastError;
}

async function uploadToLlamaParse(blob: Buffer, extension: string, apiKey: string, base: string): Promise<string> {
  const tryUpload = async (): Promise<string> => {
    const formData = new FormData();
    formData.append("file", blob, { filename: `receipt.${extension}` });
    formData.append("result_type", "markdown");
    formData.append("parse_mode", "parse_document_with_agent");
    formData.append("extract_charts", "false");

    // Get form-data headers (includes Content-Type with boundary)
    const formHeaders = formData.getHeaders ? formData.getHeaders() : {};

    const response = await fetch(base + "/upload", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...formHeaders,
      },
      body: formData as any,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Upload failed (${response.status}): ${body}`);
    }

    const uploadJson: LlamaParseUploadResponse = await response.json();
    const jobId =
      uploadJson?.id ??
      uploadJson?.job_id ??
      uploadJson?.jobId ??
      uploadJson?.parsing_job_id ??
      uploadJson?.data?.id ??
      uploadJson?.data?.job_id;

    if (!jobId) throw new Error("LlamaParse upload succeeded but no job id returned");

    return String(jobId);
  };

  return await retryWithBackoff(tryUpload);
}

// ─── Main scanning logic ───────────────────────────────────────────────────────
interface ScanResult {
  amount: number;
  merchant?: string;
  date?: string;
  category?: Category;
  note?: string;
  currency?: string;
  confidence?: number;
}

async function processReceipt(imageBuffer: Buffer, mimeType: string): Promise<ScanResult> {
  if (!LLAMAPARSE_API_KEY) {
    throw new Error("LLAMAPARSE_API_KEY not configured");
  }

  const startTime = Date.now();
  const imageSize = imageBuffer.length;

  try {
    // Convert image to base64 data URL for LlamaParse
    const base64 = imageBuffer.toString("base64");
    const dataUrl = `data:${mimeType};base64,${base64}`;

    const markdown = await parseWithLlamaParse(dataUrl, LLAMAPARSE_API_KEY);

    // ── Parse markdown to structured data ──────────────────────────────────
    const parsed = parseLlamaMarkdown(markdown);
    const lineItemsTotal = round2(parsed.line_items.reduce((sum, item) => sum + Math.abs(parseNumber(item.amount)), 0));
    const taxTotal = round2(Math.abs(parseNumber(parsed.tax_total)));
    const grandTotal = round2(Math.abs(parseNumber(parsed.grand_total)));
    const totalFromLines = round2(lineItemsTotal + taxTotal);
    const finalAmount = grandTotal || totalFromLines || lineItemsTotal;
    const confidence = parsed.field_confidence
      ? Object.values(parsed.field_confidence).reduce((a, b) => a + b, 0) / Object.values(parsed.field_confidence).length
      : 0.6;

    // Build note: vendor + up to 3 line items
    const noteParts: string[] = [];
    if (parsed.vendor) noteParts.push(parsed.vendor);
    if (parsed.line_items.length > 0) {
      const topItems = parsed.line_items.slice(0, 3);
      topItems.forEach((item) => {
        noteParts.push(`${item.description} — ${formatMoney(item.amount)}`);
      });
    }
    const note = noteParts.length > 0 ? noteParts.join("; ") : undefined;

    const result: ScanResult = {
      amount: finalAmount,
      merchant: parsed.vendor || undefined,
      confidence: Math.min(Math.max(confidence, 0), 1),
    };

    if (parsed.date) {
      const isoDate = toIsoOrNow(parsed.date);
      if (isoDate) result.date = isoDate;
    }

    const category = selectCategoryFromVendor(parsed.vendor);
    if (category) result.category = category;

    if (note) result.note = note;
    result.currency = "USD";

    const durationMs = Date.now() - startTime;
    console.log(
      `[ocr] ${new Date().toISOString()} | size=${imageSize}B duration=${durationMs}ms amount=${finalAmount} confidence=${confidence.toFixed(2)}`
    );

    return result;
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[ocr] ${new Date().toISOString()} | size=${imageSize}B duration=${durationMs}ms ERROR=${errMsg}`);
    throw err;
  }
}

// ─── Routes ────────────────────────────────────────────────────────────────────
app.post("/scan", upload.single("image"), async (req, res) => {
  try {
    const start = Date.now();

    // ── Input validation ───────────────────────────────────────────────
    let imageBuffer: Buffer | undefined;
    let mimeType: string;

    if (!req.file) {
      // Try JSON body with base64 image
      const { image: base64Data } = req.body;
      if (!base64Data || typeof base64Data !== "string") {
        return res.status(400).json({ error: "Missing image. Send multipart/form-data field 'image' OR JSON { 'image': '<base64>' }" });
      }
      try {
        const base64 = base64Data.replace(/^data:image\/\w+;base64,/, "");
        imageBuffer = Buffer.from(base64, "base64");
        mimeType = "image/jpeg"; // Assume JPEG for base64 payloads
      } catch {
        return res.status(400).json({ error: "Invalid base64 image data" });
      }
    } else {
      imageBuffer = req.file.buffer;
      mimeType = req.file.mimetype;
    }

    if (!imageBuffer || imageBuffer.length === 0) {
      return res.status(400).json({ error: "Empty image file" });
    }

    if (imageBuffer.length > parseInt(process.env.MAX_FILE_SIZE || "10485760")) {
      return res.status(413).json({ error: "Image too large. Max 10MB." });
    }

    // ── OCR pipeline ──────────────────────────────────────────────────
    const result = await processReceipt(imageBuffer, mimeType);

    res.status(200).json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[scan] ERROR: ${msg}`);
    if (msg.includes("401") || msg.includes("403") || msg.includes("API key")) {
      return res.status(500).json({ error: "OCR provider authentication failed" });
    }
    if (msg.includes("rate limit") || msg.includes("429")) {
      return res.status(429).json({ error: "OCR provider rate limited. Please retry shortly." });
    }
    res.status(500).json({ error: msg });
  }
});

// OPTIONS preflight for CORS
app.options("/scan", (req, res) => {
  res.set({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.sendStatus(204);
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// ─── Start server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[ocr] OCR Service listening on http://localhost:${PORT}`);
  console.log(`[ocr] Endpoints:`);
  console.log(`[ocr]   POST /scan  — Receipt OCR (multipart/form-data or JSON base64)`);
  console.log(`[ocr]   GET  /health — Health check`);
  if (!LLAMAPARSE_API_KEY) {
    console.warn(`[ocr] WARNING: LLAMAPARSE_API_KEY not set — /scan will fail!`);
  }
});
