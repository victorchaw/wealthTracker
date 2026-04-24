import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const auth = req.headers.get("Authorization") ?? "";
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: auth } },
    });

    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { image, storage_path } = await req.json();
    if (!image) {
      return new Response(JSON.stringify({ error: "Missing image" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch user's existing categories so the AI can match
    const { data: categories } = await supabase
      .from("categories")
      .select("id, name, emoji, kind")
      .eq("user_id", user.id);

    const catList = (categories ?? [])
      .map((c) => `${c.emoji} ${c.name} (${c.kind})`)
      .join(", ");

    const systemPrompt = `You read photos of receipts and extract a single transaction.
You MUST respond by calling the extract_receipt tool exactly once.
Pick the best-matching category name from the user's existing categories when possible.
If none fit, suggest a sensible new one with an emoji.
Available categories: ${catList || "(none yet)"}.`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: "Extract the transaction from this receipt." },
              { type: "image_url", image_url: { url: image } },
            ],
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_receipt",
              description: "Extract structured transaction data from a receipt image.",
              parameters: {
                type: "object",
                properties: {
                  amount: { type: "number", description: "Total amount paid (positive number)." },
                  merchant: { type: "string", description: "Merchant or store name." },
                  occurred_at: { type: "string", description: "ISO date of the receipt (YYYY-MM-DD)." },
                  category_name: { type: "string", description: "Best-matching category name from the list, or a new sensible name." },
                  emoji: { type: "string", description: "Single emoji representing the category." },
                  description: { type: "string", description: "Short description (max 80 chars)." },
                  kind: { type: "string", enum: ["expense", "income"], description: "Whether this is an expense or income." },
                },
                required: ["amount", "category_name", "emoji", "kind"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "extract_receipt" } },
      }),
    });

    if (!aiResp.ok) {
      if (aiResp.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit reached, please try again later." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResp.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Add funds in Workspace settings." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await aiResp.text();
      console.error("AI gateway error:", aiResp.status, t);
      return new Response(JSON.stringify({ error: "AI failed to read the receipt" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiJson = await aiResp.json();
    const toolCall = aiJson?.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      return new Response(JSON.stringify({ error: "Could not extract receipt data" }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const extracted = JSON.parse(toolCall.function.arguments);

    // Match to existing category
    let categoryId: string | null = null;
    let categoryEmoji = extracted.emoji ?? "🏷️";
    let categoryName = extracted.category_name ?? "Other";
    const lc = (s: string) => (s ?? "").toLowerCase().trim();

    const match = (categories ?? []).find(
      (c) => c.kind === extracted.kind && lc(c.name) === lc(extracted.category_name)
    );
    if (match) {
      categoryId = match.id;
      categoryEmoji = match.emoji;
      categoryName = match.name;
    } else {
      // Create a new category
      const { data: newCat, error: catErr } = await supabase
        .from("categories")
        .insert({
          user_id: user.id,
          name: extracted.category_name,
          emoji: extracted.emoji ?? "🏷️",
          kind: extracted.kind,
          color: "hsl(258 90% 66%)",
          sort_order: 99,
        })
        .select()
        .single();
      if (!catErr && newCat) {
        categoryId = newCat.id;
        categoryEmoji = newCat.emoji;
        categoryName = newCat.name;
      }
    }

    let receiptUrl: string | null = null;
    if (storage_path) {
      const { data: signed } = await supabase.storage
        .from("receipts")
        .createSignedUrl(storage_path, 60 * 60 * 24 * 365);
      receiptUrl = signed?.signedUrl ?? null;
    }

    const occurredAt = extracted.occurred_at
      ? new Date(extracted.occurred_at).toISOString()
      : new Date().toISOString();

    const { data: txn, error: txErr } = await supabase
      .from("transactions")
      .insert({
        user_id: user.id,
        amount: Math.abs(Number(extracted.amount)),
        kind: extracted.kind,
        merchant: extracted.merchant ?? null,
        description: extracted.description ?? null,
        category_id: categoryId,
        occurred_at: occurredAt,
        receipt_url: receiptUrl,
        source: "scan",
        raw_ocr: extracted,
      })
      .select()
      .single();

    if (txErr) throw txErr;

    return new Response(
      JSON.stringify({
        transaction: { ...txn, category_emoji: categoryEmoji, category_name: categoryName },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("scan-receipt error:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});