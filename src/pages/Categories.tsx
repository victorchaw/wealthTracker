import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useCategories, useProfile } from "@/hooks/useProfile";
import { formatMoney } from "@/lib/format";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog";

const PRESET_COLORS = [
  "hsl(258 90% 66%)", "hsl(20 90% 60%)", "hsl(200 85% 55%)", "hsl(280 60% 55%)",
  "hsl(45 90% 55%)", "hsl(330 80% 60%)", "hsl(0 75% 60%)", "hsl(180 65% 50%)",
  "hsl(160 70% 45%)", "hsl(140 60% 45%)", "hsl(100 60% 50%)", "hsl(220 70% 60%)",
];

export default function Categories() {
  const { user } = useAuth();
  const { data: profile } = useProfile();
  const { data: cats = [] } = useCategories();
  const qc = useQueryClient();
  const currency = profile?.base_currency || "USD";

  const [editing, setEditing] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<any>(null);

  function newCategory() {
    setEditing({ name: "", emoji: "🏷️", color: PRESET_COLORS[0], kind: "expense", warning_threshold: "", hard_limit: "" });
    setOpen(true);
  }

  function editCategory(c: any) {
    setEditing({ ...c, warning_threshold: c.warning_threshold ?? "", hard_limit: c.hard_limit ?? "" });
    setOpen(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !editing) return;
    try {
      const payload: any = {
        user_id: user.id,
        name: editing.name,
        emoji: editing.emoji,
        color: editing.color,
        kind: editing.kind,
        warning_threshold: editing.warning_threshold ? Number(editing.warning_threshold) : null,
        hard_limit: editing.hard_limit ? Number(editing.hard_limit) : null,
      };
      if (editing.id) {
        const { error } = await supabase.from("categories").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        payload.sort_order = cats.length + 1;
        const { error } = await supabase.from("categories").insert(payload);
        if (error) throw error;
      }
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["categories"] });
      setOpen(false);
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    try {
      const { error } = await supabase.from("categories").delete().eq("id", deleting.id);
      if (error) throw error;
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["categories"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setDeleting(null);
    }
  }

  const expenses = cats.filter((c: any) => c.kind === "expense");
  const income = cats.filter((c: any) => c.kind === "income");

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Categories</h1>
          <p className="text-muted-foreground text-sm mt-1">Set thresholds to get warned when spending climbs.</p>
        </div>
        <Button onClick={newCategory} className="gradient-primary text-primary-foreground gap-2">
          <Plus className="h-4 w-4" /> New
        </Button>
      </div>

      <CategoryGroup title="Expenses" items={expenses} currency={currency} onEdit={editCategory} onDelete={setDeleting} />
      <CategoryGroup title="Income" items={income} currency={currency} onEdit={editCategory} onDelete={setDeleting} />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit category" : "New category"}</DialogTitle>
          </DialogHeader>
          {editing && (
            <form onSubmit={save} className="space-y-4">
              <div className="grid grid-cols-[80px_1fr] gap-3">
                <div className="space-y-1.5">
                  <Label>Emoji</Label>
                  <Input value={editing.emoji} onChange={(e) => setEditing({ ...editing, emoji: e.target.value })} className="text-center text-xl" />
                </div>
                <div className="space-y-1.5">
                  <Label>Name</Label>
                  <Input required value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                </div>
              </div>

              <Tabs value={editing.kind} onValueChange={(v) => setEditing({ ...editing, kind: v })}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="expense">Expense</TabsTrigger>
                  <TabsTrigger value="income">Income</TabsTrigger>
                </TabsList>
              </Tabs>

              <div className="space-y-1.5">
                <Label>Color</Label>
                <div className="grid grid-cols-6 gap-2">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setEditing({ ...editing, color: c })}
                      className="h-8 rounded-md border-2 transition-smooth"
                      style={{ background: c, borderColor: editing.color === c ? "hsl(var(--foreground))" : "transparent" }}
                    />
                  ))}
                </div>
              </div>

              {editing.kind === "expense" && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Warning at</Label>
                    <Input type="number" step="0.01" placeholder="e.g. 200" value={editing.warning_threshold} onChange={(e) => setEditing({ ...editing, warning_threshold: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Hard limit</Label>
                    <Input type="number" step="0.01" placeholder="e.g. 300" value={editing.hard_limit} onChange={(e) => setEditing({ ...editing, hard_limit: e.target.value })} />
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" className="gradient-primary text-primary-foreground">Save</Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete category?</AlertDialogTitle>
            <AlertDialogDescription>Existing transactions will become uncategorized.</AlertDialogDescription>
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

function CategoryGroup({ title, items, currency, onEdit, onDelete }: any) {
  if (items.length === 0) return null;
  return (
    <Card className="shadow-card">
      <CardContent className="p-0">
        <div className="px-5 pt-4 pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</div>
        <ul className="divide-y divide-border">
          {items.map((c: any) => (
            <li key={c.id} className="group flex items-center gap-3 px-5 py-3 hover:bg-secondary/50 transition-smooth">
              <div className="h-10 w-10 rounded-lg flex items-center justify-center text-lg shrink-0" style={{ background: `${c.color}1A` }}>
                {c.emoji}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{c.name}</div>
                {c.kind === "expense" && (c.warning_threshold || c.hard_limit) && (
                  <div className="text-xs text-muted-foreground font-mono-num">
                    {c.warning_threshold && <>warn at {formatMoney(Number(c.warning_threshold), currency)}</>}
                    {c.warning_threshold && c.hard_limit && " · "}
                    {c.hard_limit && <>limit {formatMoney(Number(c.hard_limit), currency)}</>}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-smooth">
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => onEdit(c)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => onDelete(c)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}