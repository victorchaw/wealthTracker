# Lazy Money — receipt-to-insight tracker

A minimal, violet-themed personal finance app for people who'd rather snap a photo than type. Users scan receipts, AI handles the rest, and a clean dashboard shows where money goes.

## Core experience

**Onboarding (first run after signup)**

- Pick base currency, set monthly overall budget (optional), seed default categories with emoji (🛒 Groceries, 🍔 Food, 🚗 Transport, 🏠 Rent, 💡 Utilities, 🎬 Entertainment, 🏥 Health, 🛍️ Shopping, ✈️ Travel, 💼 Income — Salary, 💰 Income — Other).

**Capture flow (the hero feature)**

- Big violet "+ Scan receipt" floating button on every screen.
- Opens camera / file picker → uploads photo → AI extracts: amount, merchant, date, suggested category + emoji, short description.
- **Auto-saves immediately** as a transaction. A toast appears: "Saved $24.50 · Groceries 🛒 · Tap to edit".
- Manual entry option: small "Add manually" link for cash, income, or quick logs.

**Dashboard (home)**

- This-month summary cards: Spent, Income, Net, vs. last month.
- Donut chart: spending by category.
- Line/area chart: spending trend (last 30 / 90 days, toggle).
- Top 3 categories with progress bars showing % of their threshold used (color shifts: violet → amber at 80% → red at 100%).
- Recent transactions list (last 5) with quick-edit.

**Transactions page**

- Searchable, filterable list (date, category, type income/expense).
- Each row: emoji, merchant, category chip, amount, date. Tap to edit/delete. Swipe-friendly on mobile.
- Receipt thumbnail visible if attached; tap to view full image.

**Categories & budgets page**

- List of categories with emoji, name, color, monthly threshold (soft warning %) and hard limit.
- Add / edit / delete categories. Reorder. When spending crosses the warning %, a non-blocking toast + a banner on the dashboard appears; crossing the hard limit shows a red alert.

**Settings**

- Base currency, name, theme accent (locked to violet but user can pick light/dark), sign out, delete account.

## Look & feel

- Minimal, lots of whitespace, soft cards with subtle shadows — same vibe as visitors.now.
- Violet primary (`hsl(258 90% 66%)` family), near-white background in light mode, deep slate-violet in dark mode.
- Rounded-xl cards, generous padding, monospaced numbers for amounts, gradient hero accents on key surfaces.
- Inter for body, slightly tighter tracking on headlines.
- Smooth micro-animations on chart draw, save toast, threshold warnings.

## Tech approach

- **Lovable Cloud** for auth (email + password), database, file storage (receipt images), and the OCR edge function.
- **Lovable AI Gateway** with `gemini-3-flash-preview` for receipt vision + structured extraction (returns amount, merchant, date, suggested category, emoji, description via tool calling). Auto-matches to existing user categories; creates a sensible default if none fit.
- Recharts for the donut + trend charts.
- Realtime threshold checks server-side after each insert to compute warning state.

## Data model (high level)

- `profiles` — display name, base currency.
- `categories` — user-scoped: name, emoji, color, kind (expense/income), warning_threshold, hard_limit, sort order.
- `transactions` — user-scoped: amount, kind, category, merchant, description, occurred_at, receipt_url, source (scan/manual), raw_ocr.
- `receipts` storage bucket — private, RLS-locked to owner.

## Out of scope (v1)

- Multi-currency, recurring transactions, shared/family budgets, bank sync, exports. Easy to add later.

## What you'll see when implementation starts

1. Auth (signup / login / reset password) + protected routes.
2. Dashboard, Transactions, Categories, Settings shells with the violet design system.
3. Receipt capture + AI extraction edge function wired end-to-end.
4. Charts, threshold warnings, and edit flows.