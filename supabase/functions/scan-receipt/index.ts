import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

const processEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;

const LLAMAPARSE_API_KEY = Deno.env.get("LLAMAPARSE_API_KEY") ?? processEnv?.LLAMAPARSE_API_KEY;

const LLAMA_UPLOAD_BASES = [
  "https://api.cloud.llamaindex.ai/api/v1/parsing",
  "https://api.cloud.llamaindex.ai/api/parsing",
];

const TAX_DEFAULT = 0;
const CONFIDENCE_THRESHOLD = 0.75;

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryWithBackoff<T>(fn: () => Promise<T>, maxAttempts = 4, baseDelay = 1000): Promise<T> {
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

function round2(value: number) {
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

function toIsoOrNow(value: string | null) {
  if (!value) return new Date().toISOString();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
}

function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function stripCodeFences(text: string) {
  return text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
}

function inferFileExtension(mimeType: string) {
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("heic")) return "heic";
  if (mimeType.includes("pdf")) return "pdf";
  return "jpg";
}

function inferExtensionFromPath(path: string) {
  const ext = path.split(".").pop()?.toLowerCase();
  if (!ext) return "jpg";
  if (["jpg", "jpeg", "png", "webp", "heic", "pdf"].includes(ext)) return ext === "jpeg" ? "jpg" : ext;
  return "jpg";
}

async function imagePayloadToBlob(payload: string): Promise<{ blob: Blob; mimeType: string; extension: string }> {
  if (payload.startsWith("data:")) {
    const match = payload.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) throw new Error("Invalid data URL image payload");

    const mimeType = match[1] || "image/jpeg";
    const base64 = match[2] || "";
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

    return {
      blob: new Blob([bytes], { type: mimeType }),
      mimeType,
      extension: inferFileExtension(mimeType),
    };
  }

  const remote = await fetch(payload);
  if (!remote.ok) throw new Error("Failed to fetch image payload");

  const mimeType = remote.headers.get("content-type") || "image/jpeg";
  const bytes = await remote.arrayBuffer();
  return {
    blob: new Blob([bytes], { type: mimeType }),
    mimeType,
    extension: inferFileExtension(mimeType),
  };
}

async function uploadToLlamaParse(blob: Blob, extension: string, apiKey: string) {
  let lastError = "Unknown upload failure";

  const tryUpload = async (base: string): Promise<{ base: string, jobId: string }> => {
    const formData = new FormData();
    formData.append("file", blob, `statement.${extension}`);
    formData.append("result_type", "markdown");
    formData.append("parse_mode", "parse_document_with_agent");
    formData.append("extract_charts", "false");

    const response = await fetch(`${base}/upload`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Upload failed (${response.status}): ${body}`);
    }

    const uploadJson = await response.json();
    const jobId =
      uploadJson?.id ??
      uploadJson?.job_id ??
      uploadJson?.jobId ??
      uploadJson?.parsing_job_id ??
      uploadJson?.data?.id ??
      uploadJson?.data?.job_id;

    if (!jobId) throw new Error("LlamaParse upload succeeded but no job id returned");

    return { base, jobId: String(jobId) };
  };

  // Try each endpoint with retry, but fail fast on fatal errors
  for (const base of LLAMA_UPLOAD_BASES) {
    try {
      const result = await retryWithBackoff(() => tryUpload(base));
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Don't retry on auth/invalid key errors
      if (msg.includes("401") || msg.includes("403") || msg.includes("Invalid API key")) {
        throw err;
      }
      lastError = msg;
    }
  }

  throw new Error(`LlamaParse upload failed after retries: ${lastError}`);
}

async function fetchLlamaParseMarkdown(base: string, jobId: string, apiKey: string) {
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

    // Retry on these statuses, throw on others
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

async function parseWithLlamaParse(imagePayload: string, apiKey: string) {
  const { blob, extension } = await imagePayloadToBlob(imagePayload);
  const { base, jobId } = await uploadToLlamaParse(blob, extension, apiKey);
  return fetchLlamaParseMarkdown(base, jobId, apiKey);
}

async function parseBlobWithLlamaParse(blob: Blob, extension: string, apiKey: string) {
  const { base, jobId } = await uploadToLlamaParse(blob, extension, apiKey);
  return fetchLlamaParseMarkdown(base, jobId, apiKey);
}

function normalizeExtraction(raw: any): ParsedStatement {
  const lineItems = Array.isArray(raw?.line_items)
    ? raw.line_items.map((item: any) => ({
        date: item?.date ? String(item.date) : null,
        description: item?.description ? String(item.description) : "Unknown line item",
        amount: round2(parseNumber(item?.amount)),
        confidence: typeof item?.confidence === "number" ? Math.max(0, Math.min(1, item.confidence)) : undefined,
      }))
    : [];

  return {
    vendor: raw?.vendor ? String(raw.vendor) : null,
    date: raw?.date ? String(raw.date) : null,
    line_items: lineItems,
    tax_total: round2(parseNumber(raw?.tax_total ?? TAX_DEFAULT)),
    grand_total: round2(parseNumber(raw?.grand_total)),
    field_confidence: {
      vendor: typeof raw?.field_confidence?.vendor === "number" ? raw.field_confidence.vendor : undefined,
      date: typeof raw?.field_confidence?.date === "number" ? raw.field_confidence.date : undefined,
      tax_total: typeof raw?.field_confidence?.tax_total === "number" ? raw.field_confidence.tax_total : undefined,
      grand_total: typeof raw?.field_confidence?.grand_total === "number" ? raw.field_confidence.grand_total : undefined,
    },
  };
}

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

  const lineItems: ParsedLineItem[] = [];
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

  let inferredTaxTotal: number | null = null;
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
    if (isTaxSummaryLine) {
      inferredTaxTotal = round2(Math.abs(extractLastMoneyValue(cells.join(" ")) ?? 0));
      continue;
    }

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
  const taxTotal = round2(inferredTaxTotal ?? taxFromLines ?? TAX_DEFAULT);

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

  return normalizeExtraction({
    vendor: candidateVendor,
    date: firstDate,
    line_items: lineItems,
    tax_total: taxTotal,
    grand_total: grandTotal,
    field_confidence: {
      vendor: candidateVendor ? 0.72 : 0.45,
      date: firstDate ? 0.78 : 0.4,
      tax_total: inferredTaxTotal !== null || taxFromLines > 0 ? 0.8 : 0.55,
      grand_total: grandFromLine ? 0.86 : 0.62,
    },
  });
}

function selectCategoryFromVendor(vendor: string | null) {
  const name = (vendor || "").toLowerCase();
  if (name.includes("hotel") || name.includes("inn") || name.includes("resort")) {
    return { name: "Travel", emoji: "🧳" };
  }
  if (name.includes("uber") || name.includes("lyft") || name.includes("airline") || name.includes("taxi")) {
    return { name: "Transport", emoji: "🚕" };
  }
  if (name.includes("restaurant") || name.includes("cafe") || name.includes("bar")) {
    return { name: "Food", emoji: "🍽️" };
  }
  return { name: "Other", emoji: "🏷️" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (!LLAMAPARSE_API_KEY) throw new Error("LLAMAPARSE_API_KEY not configured");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

    const auth = req.headers.get("Authorization") ?? "";
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: auth } },
    });

    // Verify user
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();

    if (userErr || !user) return jsonResponse({ error: "Unauthorized" }, 401);

    const { image, image_url, storage_path } = await req.json();
    const imageInput = typeof image_url === "string" && image_url ? image_url : image;
    if (!imageInput || typeof imageInput !== "string") {
      return jsonResponse({ error: "Missing image payload" }, 400);
    }

    let markdown: string;
    try {
      markdown = await parseWithLlamaParse(imageInput, LLAMAPARSE_API_KEY);
     } catch (err) {
       const errMsg = err instanceof Error ? err.message : String(err);
       // If the signed URL fetch failed, try to download from storage
       if ((errMsg.includes("Failed to fetch image payload") || errMsg.includes("fetch failed")) && storage_path) {
         const result = await retryWithBackoff(
           async () => {
             const res = await supabase.storage.from("receipts").download(storage_path);
             return { data: res.data, error: res.error };
           },
           2,
           500
         );
         const { data: fileBlob, error: downloadErr } = result;
         if (downloadErr || !fileBlob) {
           throw new Error(`Failed to fetch image payload and storage download fallback failed: ${downloadErr?.message ?? "unknown"}`);
         }
         const fallbackExt = inferExtensionFromPath(storage_path);
         markdown = await parseBlobWithLlamaParse(fileBlob, fallbackExt, LLAMAPARSE_API_KEY);
       } else {
         throw err;
       }
     }

    const extracted = parseLlamaMarkdown(markdown);

    const lineItemsTotal = round2(extracted.line_items.reduce((sum, item) => sum + Math.abs(parseNumber(item.amount)), 0));
    const taxTotal = round2(Math.abs(parseNumber(extracted.tax_total)));
    const grandTotal = round2(Math.abs(parseNumber(extracted.grand_total)));
    const computedTotal = round2(lineItemsTotal + taxTotal);
    const validationError = Math.abs(computedTotal - grandTotal) > 0.01;

    const { data: categories } = await supabase
      .from("categories")
      .select("id, name, emoji, kind")
      .eq("user_id", user.id)
      .eq("kind", "expense");

    const inferred = selectCategoryFromVendor(extracted.vendor);

    let categoryId: string | null = null;
    let categoryEmoji = inferred.emoji;
    let categoryName = inferred.name;

    // Try to find existing category with retry, then upsert if not found
    let categoriesResult: any[] | null = null;
    try {
      categoriesResult = await retryWithBackoff(
        async () => (await supabase.from("categories")
          .select("id, name, emoji, kind")
          .eq("user_id", user.id)
          .eq("kind", "expense")).data,
        2,
        500
      );
    } catch (e) {
      console.warn("Failed to fetch categories:", e);
    }

    const lc = (s: string) => s.toLowerCase().trim();
    const matched = categoriesResult?.find((c) => lc(c.name) === lc(inferred.name));

    if (matched) {
      categoryId = matched.id;
      categoryEmoji = matched.emoji;
      categoryName = matched.name;
    } else {
      // Attempt to create the category; on conflict (duplicate race), fetch the existing one
      try {
        const { data: createdCategory } = await supabase
          .from("categories")
          .insert({
            user_id: user.id,
            name: inferred.name,
            emoji: inferred.emoji,
            kind: "expense",
            color: "hsl(258 90% 66%)",
            sort_order: 99,
          })
          .select()
          .single();

        if (createdCategory) {
          categoryId = createdCategory.id;
          categoryEmoji = createdCategory.emoji;
          categoryName = createdCategory.name;
        }
      } catch (insertErr: any) {
        // Unique constraint violation: another concurrent insert created it
        const msg = insertErr?.message ?? "";
        if (msg.includes("unique") || msg.includes("duplicate") || (insertErr as any)?.code === "23505") {
          const existing = await supabase
            .from("categories")
            .select("id, name, emoji")
            .eq("user_id", user.id)
            .eq("kind", "expense")
            .eq("name", inferred.name)
            .maybeSingle();
          if (existing.data) {
            categoryId = existing.data.id;
            categoryEmoji = existing.data.emoji;
            categoryName = existing.data.name;
          } else {
            throw insertErr; // re-raise if we still can't find it
          }
        } else {
          throw insertErr; // re-raise non-unique errors
        }
      }
    }

    let receiptUrl: string | null = null;
    if (storage_path) {
      const { data: signed } = await retryWithBackoff(
        () => supabase.storage.from("receipts").createSignedUrl(storage_path, 60 * 60 * 24 * 365),
        2,
        500
      );
      receiptUrl = signed?.signedUrl ?? null;
    }

    const occurredAt = toIsoOrNow(extracted.date);
    const finalAmount = grandTotal || computedTotal || lineItemsTotal;

    const lowConfidenceFields = {
      vendor: (extracted.field_confidence?.vendor ?? 1) < CONFIDENCE_THRESHOLD,
      date: (extracted.field_confidence?.date ?? 1) < CONFIDENCE_THRESHOLD,
      tax_total: (extracted.field_confidence?.tax_total ?? 1) < CONFIDENCE_THRESHOLD,
      grand_total: (extracted.field_confidence?.grand_total ?? 1) < CONFIDENCE_THRESHOLD,
    };

    const extractionPayload = {
      ...extracted,
      line_items: extracted.line_items,
      line_items_total: lineItemsTotal,
      computed_total: computedTotal,
      validation_error: validationError,
      low_confidence_fields: lowConfidenceFields,
      parser: "llamaparse-agentic",
      auditor_model: "none-llamaparse-only",
      markdown,
    };

    // Fetch categories and insert transaction with retry for transient failures
    const categoryPromise = retryWithBackoff(
      async () => (await supabase.from("categories")
        .select("id, name, emoji, kind")
        .eq("user_id", user.id)
        .eq("kind", "expense")).data,
      2,
      500
    );

    const txnPromise = retryWithBackoff(
      async () => await supabase
        .from("transactions")
        .insert({
          user_id: user.id,
          amount: finalAmount,
          kind: "expense",
          merchant: extracted.vendor,
          description:
            extracted.line_items.length > 0
              ? `${extracted.line_items.length} extracted line item${extracted.line_items.length > 1 ? "s" : ""}`
              : "Parsed statement",
          category_id: categoryId,
          occurred_at: occurredAt,
          receipt_url: receiptUrl,
          source: "scan",
          raw_ocr: extractionPayload,
        })
        .select()
        .single(),
      2,
      500
    );

    // Execute in parallel
    const [categoriesResult, { data: txn, error: txErr }] = await Promise.all([categoryPromise, txnPromise]);

    if (txErr) throw txErr;

    if (!categoryId && categoriesResult && categoriesResult.length > 0) {
      // Re-check categories after fetch (handles race with concurrent inserts from same user)
      const lc = (s: string) => s.toLowerCase().trim();
      const matchedAfter = categoriesResult.find((c) => lc(c.name) === lc(inferred.name));
      if (matchedAfter) {
        categoryId = matchedAfter.id;
        categoryEmoji = matchedAfter.emoji;
        categoryName = matchedAfter.name;
      }
    }

    return jsonResponse({
      transaction: { ...txn, category_emoji: categoryEmoji, category_name: categoryName },
      extraction: extractionPayload,
      validation_error: validationError,
    });

    return jsonResponse({
      transaction: { ...txn, category_emoji: categoryEmoji, category_name: categoryName },
      extraction: extractionPayload,
      validation_error: validationError,
    });
  } catch (e) {
    console.error("scan-receipt error:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    return jsonResponse({ error: msg }, 500);
  }
});
