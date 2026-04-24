import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useTransactions, useCategories, useProfile } from "@/hooks/useProfile";
import { formatMoney } from "@/lib/format";
import { ArrowDownRight, ArrowUpRight, TrendingUp, Wallet, AlertTriangle } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from "recharts";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

function startOfMonth(d = new Date()) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function startOfPrevMonth(d = new Date()) { return new Date(d.getFullYear(), d.getMonth() - 1, 1); }
function endOfPrevMonth(d = new Date()) { return new Date(d.getFullYear(), d.getMonth(), 0, 23, 59, 59); }

export default function Dashboard() {
  const { data: profile } = useProfile();
  const { data: txns = [] } = useTransactions();
  const { data: cats = [] } = useCategories();
  const currency = profile?.base_currency || "USD";

  const stats = useMemo(() => {
    const monthStart = startOfMonth();
    const prevStart = startOfPrevMonth();
    const prevEnd = endOfPrevMonth();
    const ago30 = new Date(Date.now() - 30 * 86400000);

    const month = txns.filter((t: any) => new Date(t.occurred_at) >= monthStart);
    const prev = txns.filter((t: any) => {
      const d = new Date(t.occurred_at);
      return d >= prevStart && d <= prevEnd;
    });

    const sum = (arr: any[], kind: string) =>
      arr.filter((t) => t.kind === kind).reduce((s, t) => s + Number(t.amount), 0);

    const spent = sum(month, "expense");
    const income = sum(month, "income");
    const prevSpent = sum(prev, "expense");
    const prevIncome = sum(prev, "income");

    // donut: expense by category this month
    const byCat = new Map<string, { name: string; emoji: string; color: string; total: number }>();
    for (const t of month) {
      if (t.kind !== "expense") continue;
      const c = (t as any).categories;
      const key = c?.id ?? "uncat";
      const cur = byCat.get(key) ?? {
        name: c?.name ?? "Uncategorized",
        emoji: c?.emoji ?? "❓",
        color: c?.color ?? "hsl(258 20% 70%)",
        total: 0,
      };
      cur.total += Number(t.amount);
      byCat.set(key, cur);
    }
    const donut = [...byCat.values()].sort((a, b) => b.total - a.total);

    // 30-day trend
    const days: Record<string, number> = {};
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const key = d.toISOString().slice(0, 10);
      days[key] = 0;
    }
    for (const t of txns) {
      if (t.kind !== "expense") continue;
      const d = new Date(t.occurred_at);
      if (d < ago30) continue;
      const key = d.toISOString().slice(0, 10);
      if (key in days) days[key] += Number(t.amount);
    }
    const trend = Object.entries(days).map(([date, value]) => ({
      date,
      label: new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      value,
    }));

    // top 3 categories with thresholds
    const topCats = cats
      .filter((c: any) => c.kind === "expense" && (c.warning_threshold || c.hard_limit))
      .map((c: any) => {
        const total = byCat.get(c.id)?.total ?? 0;
        const limit = Number(c.hard_limit ?? c.warning_threshold ?? 0);
        const pct = limit > 0 ? Math.min(100, (total / limit) * 100) : 0;
        return { ...c, total, limit, pct };
      })
      .sort((a: any, b: any) => b.pct - a.pct)
      .slice(0, 3);

    return { spent, income, prevSpent, prevIncome, donut, trend, topCats };
  }, [txns, cats]);

  const net = stats.income - stats.spent;
  const spentDelta = stats.prevSpent ? ((stats.spent - stats.prevSpent) / stats.prevSpent) * 100 : 0;

  const recent = txns.slice(0, 5);

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Hi {profile?.display_name?.split(" ")[0] || "there"} 👋</h1>
        <p className="text-muted-foreground text-sm mt-1">Here's how this month is going.</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Card className="shadow-soft">
          <CardContent className="p-4 md:p-5">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <ArrowDownRight className="h-3.5 w-3.5" /> Spent
            </div>
            <div className="text-xl md:text-2xl font-bold font-mono-num">{formatMoney(stats.spent, currency)}</div>
            {stats.prevSpent > 0 && (
              <div className={cn("text-xs mt-1", spentDelta > 0 ? "text-destructive" : "text-success")}>
                {spentDelta > 0 ? "↑" : "↓"} {Math.abs(spentDelta).toFixed(0)}% vs last month
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-soft">
          <CardContent className="p-4 md:p-5">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <ArrowUpRight className="h-3.5 w-3.5" /> Income
            </div>
            <div className="text-xl md:text-2xl font-bold font-mono-num">{formatMoney(stats.income, currency)}</div>
          </CardContent>
        </Card>

        <Card className="shadow-soft col-span-2 md:col-span-1 gradient-soft border-primary/10">
          <CardContent className="p-4 md:p-5">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Wallet className="h-3.5 w-3.5" /> Net
            </div>
            <div className={cn("text-xl md:text-2xl font-bold font-mono-num", net < 0 && "text-destructive")}>
              {formatMoney(net, currency)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card className="shadow-card">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">By category</h3>
              <span className="text-xs text-muted-foreground">This month</span>
            </div>
            {stats.donut.length === 0 ? (
              <div className="h-56 flex items-center justify-center text-sm text-muted-foreground">
                No expenses yet — scan a receipt to get started.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 items-center">
                <div className="h-44">
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie data={stats.donut} dataKey="total" innerRadius={45} outerRadius={75} paddingAngle={2}>
                        {stats.donut.map((d, i) => <Cell key={i} fill={d.color} />)}
                      </Pie>
                      <Tooltip
                        formatter={(v: any) => formatMoney(Number(v), currency)}
                        contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12 }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-1.5 text-sm">
                  {stats.donut.slice(0, 5).map((d) => (
                    <div key={d.name} className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: d.color }} />
                      <span className="truncate flex-1">{d.emoji} {d.name}</span>
                      <span className="font-mono-num text-xs text-muted-foreground">{formatMoney(d.total, currency)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-card">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold flex items-center gap-1.5"><TrendingUp className="h-4 w-4" /> Trend</h3>
              <span className="text-xs text-muted-foreground">Last 30 days</span>
            </div>
            <div className="h-44">
              <ResponsiveContainer>
                <AreaChart data={stats.trend} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(258 90% 66%)" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="hsl(258 90% 66%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip
                    formatter={(v: any) => formatMoney(Number(v), currency)}
                    contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12 }}
                  />
                  <Area type="monotone" dataKey="value" stroke="hsl(258 90% 66%)" strokeWidth={2} fill="url(#trendGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Top categories progress */}
      {stats.topCats.length > 0 && (
        <Card className="shadow-card">
          <CardContent className="p-5 space-y-4">
            <h3 className="font-semibold">Budget watch</h3>
            {stats.topCats.map((c: any) => {
              const overWarn = c.warning_threshold && c.total >= Number(c.warning_threshold);
              const overHard = c.hard_limit && c.total >= Number(c.hard_limit);
              return (
                <div key={c.id} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">{c.emoji} {c.name}</span>
                    <span className="font-mono-num text-xs text-muted-foreground">
                      {formatMoney(c.total, currency)} / {formatMoney(c.limit, currency)}
                    </span>
                  </div>
                  <Progress
                    value={c.pct}
                    className={cn(
                      "h-2",
                      overHard ? "[&>div]:bg-destructive" : overWarn ? "[&>div]:bg-warning" : "[&>div]:bg-primary"
                    )}
                  />
                  {overHard && (
                    <div className="text-xs text-destructive flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" /> Hard limit reached
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Recent transactions */}
      <Card className="shadow-card">
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Recent</h3>
            <Link to="/transactions" className="text-xs text-primary hover:underline">See all</Link>
          </div>
          {recent.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No transactions yet. Tap "Scan receipt" to start.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {recent.map((t: any) => (
                <div key={t.id} className="flex items-center gap-3 py-2.5">
                  <div className="h-9 w-9 rounded-lg bg-secondary flex items-center justify-center text-base">
                    {t.categories?.emoji ?? "💸"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{t.merchant ?? t.description ?? "Transaction"}</div>
                    <div className="text-xs text-muted-foreground">{t.categories?.name ?? "Uncategorized"}</div>
                  </div>
                  <div className={cn("font-mono-num font-semibold text-sm", t.kind === "income" ? "text-success" : "text-foreground")}>
                    {t.kind === "income" ? "+" : "-"}{formatMoney(Number(t.amount), currency)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}