import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CURRENCY_OPTIONS } from "@/lib/format";
import { useProfile } from "@/hooks/useProfile";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut, Moon, Sun } from "lucide-react";

export default function Settings() {
  const { user, signOut } = useAuth();
  const { data: profile } = useProfile();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [budget, setBudget] = useState("");
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));

  useEffect(() => {
    if (profile) {
      setName(profile.display_name ?? "");
      setCurrency(profile.base_currency ?? "USD");
      setBudget(profile.monthly_budget?.toString() ?? "");
    }
  }, [profile]);

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          display_name: name,
          base_currency: currency,
          monthly_budget: budget ? Number(budget) : null,
        })
        .eq("user_id", user.id);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["profile"] });
      toast.success("Saved");
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      <h1 className="text-2xl md:text-3xl font-bold">Settings</h1>

      <Card className="shadow-card">
        <CardContent className="p-5">
          <form onSubmit={save} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input value={user?.email ?? ""} disabled />
            </div>
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
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
                <Label>Monthly budget</Label>
                <Input type="number" step="0.01" value={budget} onChange={(e) => setBudget(e.target.value)} />
              </div>
            </div>
            <div className="flex justify-end">
              <Button type="submit" className="gradient-primary text-primary-foreground">Save changes</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="shadow-card">
        <CardContent className="p-5 flex items-center justify-between">
          <div>
            <div className="font-semibold">Appearance</div>
            <div className="text-sm text-muted-foreground">Switch between light and dark.</div>
          </div>
          <Button variant="outline" onClick={toggleTheme} className="gap-2">
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            {dark ? "Light" : "Dark"}
          </Button>
        </CardContent>
      </Card>

      <Card className="shadow-card">
        <CardContent className="p-5 flex items-center justify-between">
          <div>
            <div className="font-semibold">Sign out</div>
            <div className="text-sm text-muted-foreground">You'll need to sign back in.</div>
          </div>
          <Button variant="outline" onClick={signOut} className="gap-2">
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}