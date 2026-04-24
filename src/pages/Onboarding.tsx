import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CURRENCY_OPTIONS } from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useProfile } from "@/hooks/useProfile";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";

export default function Onboarding() {
  const { user } = useAuth();
  const { data: profile } = useProfile();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [currency, setCurrency] = useState(profile?.base_currency || "USD");
  const [budget, setBudget] = useState<string>(profile?.monthly_budget?.toString() || "");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          base_currency: currency,
          monthly_budget: budget ? Number(budget) : null,
          onboarded: true,
        })
        .eq("user_id", user.id);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["profile"] });
      toast.success("You're all set!");
      navigate("/", { replace: true });
    } catch (err: any) {
      toast.error(err.message ?? "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 gradient-hero">
      <Card className="w-full max-w-md shadow-card animate-fade-in">
        <CardContent className="pt-8">
          <div className="flex items-center gap-2 text-primary mb-2">
            <Sparkles className="h-4 w-4" />
            <span className="text-xs font-semibold uppercase tracking-wider">Welcome</span>
          </div>
          <h1 className="text-2xl font-bold mb-2">Let's set things up</h1>
          <p className="text-sm text-muted-foreground mb-6">
            Pick your currency and an optional monthly budget. You can change these anytime in Settings.
          </p>

          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Base currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {CURRENCY_OPTIONS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="budget">Monthly budget (optional)</Label>
              <Input id="budget" type="number" step="0.01" placeholder="e.g. 2000" value={budget} onChange={(e) => setBudget(e.target.value)} />
            </div>

            <Button type="submit" disabled={busy} className="w-full gradient-primary text-primary-foreground">
              {busy ? "Saving…" : "Get started"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}