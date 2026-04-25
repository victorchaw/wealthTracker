import { useRef, useState } from "react";
import { Camera, Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { formatMoney } from "@/lib/format";
import { useProfile } from "@/hooks/useProfile";
import { ManualEntryDialog } from "@/components/ManualEntryDialog";
import { ExtractionReviewDialog } from "@/components/ExtractionReviewDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type ScanExtraction = {
  vendor: string | null;
  date: string | null;
  line_items: Array<{ date: string | null; description: string; amount: number; confidence?: number }>;
  tax_total: number;
  grand_total: number;
  computed_total?: number;
  validation_error?: boolean;
  field_confidence?: {
    vendor?: number;
    date?: number;
    tax_total?: number;
    grand_total?: number;
  };
};

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

async function extractEdgeFunctionError(err: unknown): Promise<string> {
  if (err && typeof err === "object") {
    const anyErr = err as { message?: string; context?: Response };
    const context = anyErr.context;
    if (context && typeof context === "object" && "text" in context) {
      try {
        const raw = await context.text();
        const parsed = raw ? JSON.parse(raw) : null;
        if (parsed?.error && typeof parsed.error === "string") return parsed.error;
        if (raw) return raw;
      } catch {
        // fall through to generic message
      }
    }
    if (anyErr.message) return anyErr.message;
  }
  return "Failed to scan receipt";
}

export function ScanReceiptButton() {
  const inputRef = useRef<HTMLInputElement>(null);
  const { user } = useAuth();
  const { data: profile } = useProfile();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewImageUrl, setReviewImageUrl] = useState<string>("");
  const [reviewExtraction, setReviewExtraction] = useState<ScanExtraction | null>(null);

  async function handleFile(file: File) {
    if (!user) return;

    if (file.size > MAX_FILE_SIZE_BYTES) {
      toast.error("Image too large. Please upload a file up to 20MB.");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    setBusy(true);
    try {
      // Upload to receipts bucket
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${user.id}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("receipts").upload(path, file, { upsert: false });
      if (upErr) throw upErr;

      const { data: signed, error: signedErr } = await supabase.storage.from("receipts").createSignedUrl(path, 60 * 10);
      if (signedErr || !signed?.signedUrl) throw new Error("Could not generate signed URL for uploaded image");

      const { data, error } = await supabase.functions.invoke("scan-receipt", {
        body: {
          image: signed.signedUrl,
          image_url: signed.signedUrl,
          storage_path: path,
        },
      });
      if (error) throw error;

      const txn = data?.transaction;
      const extraction = data?.extraction as ScanExtraction | undefined;

      if (!txn) {
        throw new Error(data?.error || "Scan completed but no transaction was saved");
      }

      if (extraction) {
        setReviewImageUrl(signed.signedUrl);
        setReviewExtraction(extraction);
        setReviewOpen(true);

        if (extraction.validation_error) {
          toast.warning("Validation mismatch detected", {
            description: "Line items + taxes do not match grand total.",
          });
        }
      }

      toast.success(
        `Saved ${formatMoney(Number(txn.amount), profile?.base_currency || "USD")} · ${txn.category_emoji ?? ""} ${txn.category_name ?? ""}`,
        { description: "Tap Transactions to edit." }
      );
      qc.invalidateQueries({ queryKey: ["transactions"] });
    } catch (err: any) {
      console.error(err);
      const message = await extractEdgeFunctionError(err);
      toast.error(message);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="lg"
            disabled={busy}
            className="fixed bottom-6 right-6 z-50 h-14 rounded-full shadow-glow gradient-primary text-primary-foreground hover:opacity-95 px-6 gap-2 md:bottom-8 md:right-8"
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
            <span className="font-semibold">{busy ? "Reading…" : "Scan receipt"}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onSelect={() => inputRef.current?.click()} className="gap-2">
            <Camera className="h-4 w-4" /> Scan a receipt
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setManualOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" /> Add manually
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ManualEntryDialog open={manualOpen} onOpenChange={setManualOpen} />
      <ExtractionReviewDialog
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        imageUrl={reviewImageUrl}
        extraction={reviewExtraction}
        currency={profile?.base_currency || "USD"}
      />
    </>
  );
}
