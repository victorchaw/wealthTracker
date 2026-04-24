import { useState, useEffect } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Wallet, Sparkles } from "lucide-react";

export default function Auth() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user, loading } = useAuth();
  const initialMode = (params.get("mode") ?? "login") as "login" | "signup" | "reset";
  const [mode, setMode] = useState<"login" | "signup" | "reset">(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) navigate("/", { replace: true });
  }, [user, loading, navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/`,
            data: { display_name: name || email.split("@")[0] },
          },
        });
        if (error) throw error;
        toast.success("Welcome to Lazy Money!", { description: "You're all set." });
      } else if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Welcome back");
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        toast.success("Check your email", { description: "We sent you a reset link." });
        setMode("login");
      }
    } catch (err: any) {
      toast.error(err.message ?? "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 gradient-hero">
      <div className="w-full max-w-md animate-fade-in">
        <div className="flex flex-col items-center mb-8">
          <div className="h-14 w-14 rounded-2xl gradient-primary flex items-center justify-center shadow-glow mb-4">
            <Wallet className="h-7 w-7 text-primary-foreground" />
          </div>
          <h1 className="text-3xl font-bold">Lazy Money</h1>
          <p className="text-muted-foreground text-sm mt-1 flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5" />
            Snap a receipt. We do the rest.
          </p>
        </div>

        <Card className="shadow-card border-border/60">
          <CardContent className="pt-6">
            <form onSubmit={onSubmit} className="space-y-4">
              {mode === "signup" && (
                <div className="space-y-1.5">
                  <Label htmlFor="name">Name</Label>
                  <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>
              {mode !== "reset" && (
                <div className="space-y-1.5">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                </div>
              )}
              <Button type="submit" className="w-full gradient-primary text-primary-foreground hover:opacity-90 shadow-soft" disabled={busy}>
                {busy ? "Please wait…" : mode === "signup" ? "Create account" : mode === "login" ? "Sign in" : "Send reset link"}
              </Button>
            </form>

            <div className="mt-6 text-center text-sm text-muted-foreground space-y-2">
              {mode === "login" && (
                <>
                  <button className="text-primary hover:underline" onClick={() => setMode("signup")}>
                    Don't have an account? Sign up
                  </button>
                  <div>
                    <button className="text-muted-foreground hover:text-foreground" onClick={() => setMode("reset")}>
                      Forgot password?
                    </button>
                  </div>
                </>
              )}
              {mode === "signup" && (
                <button className="text-primary hover:underline" onClick={() => setMode("login")}>
                  Already have an account? Sign in
                </button>
              )}
              {mode === "reset" && (
                <button className="text-primary hover:underline" onClick={() => setMode("login")}>
                  Back to sign in
                </button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}