import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTransactions, useCategories, useProfile } from "@/hooks/useProfile";
import { formatMoney, formatDate } from "@/lib/format";
import { Search, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ManualEntryDialog } from "@/components/ManualEntryDialog";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog";

export default function Transactions() {
  const { data: profile } = useProfile();
  const { data: txns = [] } = useTransactions();
  const { data: cats = [] } = useCategories();
  const qc = useQueryClient();
  const currency = profile?.base_currency || "USD";

  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("all");
  const [catId, setCatId] = useState("all");
  const [editing, setEditing] = useState<any>(null);
  const [deleting, setDeleting] = useState<any>(null);

  const filtered = useMemo(() => {
    return txns.filter((t: any) => {
      if (kind !== "all" && t.kind !== kind) return false;
      if (catId !== "all" && t.category_id !== catId) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!(t.merchant ?? "").toLowerCase().includes(q) &&
            !(t.description ?? "").toLowerCase().includes(q) &&
            !(t.categories?.name ?? "").toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [txns, search, kind, catId]);

  async function confirmDelete() {
    if (!deleting) return;
    try {
      const { error } = await supabase.from("transactions").delete().eq("id", deleting.id);
      if (error) throw error;
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["transactions"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="text-2xl md:text-3xl font-bold">Transactions</h1>

      <Card className="shadow-soft">
        <CardContent className="p-4 grid sm:grid-cols-3 gap-3">
          <div className="relative sm:col-span-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All kinds</SelectItem>
              <SelectItem value="expense">Expenses</SelectItem>
              <SelectItem value="income">Income</SelectItem>
            </SelectContent>
          </Select>
          <Select value={catId} onValueChange={setCatId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {cats.map((c: any) => (
                <SelectItem key={c.id} value={c.id}>{c.emoji} {c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card className="shadow-card">
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">No transactions match.</div>
          ) : (
            <ul className="divide-y divide-border">
              {filtered.map((t: any) => (
                <li key={t.id} className="group flex items-center gap-3 px-4 py-3 hover:bg-secondary/50 transition-smooth">
                  <div className="h-10 w-10 rounded-lg bg-secondary flex items-center justify-center text-lg shrink-0">
                    {t.categories?.emoji ?? "💸"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{t.merchant ?? t.description ?? "Transaction"}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2">
                      <span>{t.categories?.name ?? "Uncategorized"}</span>
                      <span>·</span>
                      <span>{formatDate(t.occurred_at)}</span>
                    </div>
                  </div>
                  <div className={cn("font-mono-num font-semibold text-sm", t.kind === "income" ? "text-success" : "text-foreground")}>
                    {t.kind === "income" ? "+" : "-"}{formatMoney(Number(t.amount), currency)}
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-smooth">
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditing(t)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setDeleting(t)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <ManualEntryDialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)} initial={editing} />
      <AlertDialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete transaction?</AlertDialogTitle>
            <AlertDialogDescription>This can't be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}