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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function ScanReceiptButton() {
  const inputRef = useRef<HTMLInputElement>(null);
  const { user } = useAuth();
  const { data: profile } = useProfile();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);

  async function handleFile(file: File) {
    if (!user) return;
    setBusy(true);
    try {
      // Upload to receipts bucket
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${user.id}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("receipts").upload(path, file, { upsert: false });
      if (upErr) throw upErr;

      // Get a signed URL for the AI to read
      const { data: signed } = await supabase.storage.from("receipts").createSignedUrl(path, 60 * 5);
      if (!signed?.signedUrl) throw new Error("Could not generate file URL");

      // Convert to base64 data URL for the AI gateway
      const buf = await file.arrayBuffer();
      const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
      const dataUrl = `data:${file.type || "image/jpeg"};base64,${b64}`;

      const { data, error } = await supabase.functions.invoke("scan-receipt", {
        body: { image: dataUrl, storage_path: path },
      });
      if (error) throw error;

      const txn = data?.transaction;
      if (txn) {
        toast.success(
          `Saved ${formatMoney(Number(txn.amount), profile?.base_currency || "USD")} · ${txn.category_emoji ?? ""} ${txn.category_name ?? ""}`,
          { description: "Tap Transactions to edit." }
        );
      } else {
        toast.success("Receipt saved");
      }
      qc.invalidateQueries({ queryKey: ["transactions"] });
    } catch (err: any) {
      console.error(err);
      toast.error(err.message ?? "Failed to scan receipt");
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
    </>
  );
}