# SportsTechX Admin — Setup

Internal admin tools. Next.js 16 + React 19 + TypeScript + SWR + Supabase JS. Talks to the NestJS backend via the `/api/*` rewrite. Runs on port **3001** (so it doesn't collide with the user-facing client on 3000).

> **The comprehensive multi-repo guide (server + client + admin + git workflow + migrations) lives at [`SportsTechX-Services/SETUP.md`](https://github.com/stxtxs/SportsTechX-Services/blob/development/SETUP.md).** This file covers just the admin-specific bits.

---

## Prerequisites

- Node.js 20+ and npm 10+
- Git, with SSH access to the [`stxtxs`](https://github.com/stxtxs) repos
- The backend running locally on `http://localhost:5000` (or a remote `BACKEND_URL`)
- **An admin account on the backend.** Your `profiles.user_role` must be `'admin'`, or the app bounces you to `/forbidden`. Ask a team lead to promote you (`POST /api/admin/users/<your-id>/promote`).

## Clone

```bash
git clone git@github-work:stxtxs/SportsTechX-Admin.git admin
cd admin
```

> ⚠️ Heads-up: this repo currently only has a `main` branch. The shared `development` / `staging` flow is still being set up. Until then, branch directly off `main` and PR back to `main`. Sync with the team before merging.

## Environment variables

Create `admin/.env.local` (gitignored).

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key-from-supabase-dashboard>
BACKEND_URL=http://localhost:5000
```

That's it — admin has no analytics keys (intentional; see [`.claude/stack.md`](.claude/stack.md)).

## Install + run

```bash
npm install
npm run dev          # serves on http://localhost:3001
```

First request flow:

1. The Next.js edge proxy ([`proxy.ts`](proxy.ts)) checks for an `sb-*-auth-token` cookie. No cookie → redirect to `/login`.
2. `<AdminShell>` ([`components/admin-shell.tsx`](components/admin-shell.tsx)) mounts client-side, calls `GET /api/profiles/me`, and checks `profile.user_role === 'admin'`. Not admin → redirect to `/forbidden`.
3. Admin pages under `app/(admin)/` render only when both checks pass.

If you keep getting bounced to `/forbidden`, your account isn't an admin yet. See Prerequisites above.

## Build & verify before pushing

```bash
npx tsc --noEmit     # type-check only (fastest)
npm run lint         # eslint
npm run build        # full production build (8GB heap)
```

All three must exit 0.

## Architecture quick-links

The admin has its own `.claude/` docs ([admin/.claude/](.claude/)) covering:

- [stack.md](.claude/stack.md) — every dependency, what it's for, what's deliberately absent
- [architecture.md](.claude/architecture.md) — request lifecycle, route groups, the two-layer auth gate
- [rules.md](.claude/rules.md) — hard guardrails (incl. the `user_role` vs `user_type` distinction)
- [conventions.md](.claude/conventions.md) — file layout, naming, design-token classes
- [auth.md](.claude/auth.md) — edge proxy + AdminShell deep dive
- [data-fetching.md](.claude/data-fetching.md) — `api()` + `useSWR` patterns + invalidation
- [pages.md](.claude/pages.md) — every admin page and which backend endpoints it touches

Read [CLAUDE.md](CLAUDE.md) first — it has the routing into all of the above.

## Git workflow

See [`SportsTechX-Services/SETUP.md` § 9](https://github.com/stxtxs/SportsTechX-Services/blob/development/SETUP.md#9-git-workflow) for the full ladder.

**For now (until `development` + `staging` branches exist here):**

1. Branch off `main`:
   ```bash
   git checkout main && git pull origin main
   git checkout -b feature/<your-name>/<short-topic>
   ```
2. Commit logically:
   ```bash
   git add <files>
   git commit -m "feat: <subject>"
   ```
3. Pull `main` again before pushing, merge if anyone else moved:
   ```bash
   git fetch origin && git merge origin/main
   # resolve conflicts, rebuild locally, then push
   git push -u origin feature/<your-name>/<short-topic>
   ```
4. Open PR on GitHub: `feature/<you>/<topic>` → `main`. Request review from a team lead.

**Once `development` + `staging` branches are added** (planned), switch to the same ladder as the other repos: personal → development → staging → main.

Never force-push to `main`. Never commit directly to `main`.

## Common admin operations

| Task | Endpoint(s) | Backend file |
|---|---|---|
| Approve a claim (triggers 30-day Pro trial) | `POST /api/admin/claims/:id/verify` | `server/src/modules/admin/admin.controller.ts` |
| Bulk-promote users to growth/pro for N days | `POST /api/admin/billing/bulk-grant-access` | `server/src/modules/admin/admin-billing.controller.ts` |
| Grant a single user a per-feature override | `POST /api/admin/users/:profileId/feature-grants` | `server/src/modules/feature-grants/` |
| Re-run the recommendations job | `POST /api/admin/jobs/recommendations/score` | `server/src/processors/` |
| Drain claim queue | `/claims` page → per-row pickup/verify/reject | `app/(admin)/claims/page.tsx` |

For the full surface, see [`.claude/pages.md`](.claude/pages.md).

## Troubleshooting

| Symptom | Fix |
|---|---|
| Bounced to `/forbidden` even though I signed in | Your `user_role` isn't `'admin'`. Ask a team lead to promote you. |
| Bounced to `/login` repeatedly | Supabase session cookie isn't being set. Check `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` are correct. |
| Pages load but every API call shows 401 | Server isn't running on `BACKEND_URL`, or your session expired (sign out and back in). |
| "Cannot find module" after `git pull` | `node_modules/` is stale. Re-run `npm install`. |
| Port 3001 already in use | Another process is bound. `npx kill-port 3001` (or change the port in `package.json` dev script). |
| `npm run build` errors with TypeScript issues that work in dev | Production build is stricter. Run `npx tsc --noEmit` and fix every error before re-building. |
