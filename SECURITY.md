# Security Checklist

Use this checklist before making the repository public.

## 1) Never commit secrets

- Keep real keys only in local `.env` (this file is ignored by git).
- Use `.env.example` for placeholders only.
- Do not paste real keys in code, README, issues, or PR comments.

## 2) Where keys should live

- Frontend (public values):
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_PUBLISHABLE_KEY`
- Server-side secrets (Supabase Edge Function Secrets):
  - `LLAMAPARSE_API_KEY`
  - `GEMINI_API_KEY` (only if used)

Important: server-side secrets must never be in git.

## 3) If a key was exposed

- Rotate/revoke the key immediately in the provider dashboard.
- Replace with a new key in Supabase Secrets or local env.
- If exposure was in git history, rewrite history and force-push.

## 4) Before publishing to GitHub

- Confirm `.env` is not tracked:
  - `git ls-files .env` should return nothing.
- Confirm history does not include `.env`:
  - `git log --all -- .env` should return nothing.
- Enable GitHub Secret Scanning and Push Protection.

## 5) Deployment and testing

- You can publish the repo without secrets.
- The app still works if runtime secrets are set in Supabase:
  - Frontend reads local `.env` during local dev.
  - Edge function reads Supabase Secrets in production.

## 6) Phone scan behavior

- Phone capture/upload works without storing private keys in git.
- Scan works only if server-side secret(s) are set in Supabase Secrets.
- If all secrets are removed everywhere, scan extraction will fail.

## 7) Minimal safe release process

1. Keep `.env` local only.
2. Configure Supabase Secrets.
3. Deploy edge function.
4. Test one real scan and one manual entry.
5. Publish repo.
