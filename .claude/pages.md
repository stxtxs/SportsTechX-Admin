# Pages Index

Every admin route, what it does, and what backend endpoints it touches. Use this as a "where do I edit X" lookup.

All routes live under `app/(admin)/` so they're auth-gated by [components/admin-shell.tsx](../components/admin-shell.tsx). URL paths drop the `(admin)` group.

| Route | File | What it does | Backend |
|---|---|---|---|
| `/dashboard` | [(admin)/dashboard/page.tsx](<../app/(admin)/dashboard/page.tsx>) | Operations overview — counts for pending claims, open DCRs, pipeline, plus warehouse-size strip. Landing page after login. | `GET /api/admin/{claims, data-change-requests, users, startups-pipeline}`, `/api/{companies, deals, investors, acquisitions}` (with `limit: 1`) |
| `/claims` | [(admin)/claims/page.tsx](<../app/(admin)/claims/page.tsx>) | Claim review queue with pending / picked-up / verified tabs. Per-row pickup / verify / reject. Verifying grants no tier access (the old 30-day trial on verify was removed 23 Nov 2026). | `GET /api/admin/claims`, `POST /:id/{pickup, verify, reject}` |
| `/users` | [(admin)/users/page.tsx](<../app/(admin)/users/page.tsx>) | User search + per-row **Manage** panel with: permanent tier change · time-bounded grant-access · per-feature grants. Click row → expands inline panel. | `GET /api/admin/users`, `PATCH /:id`, `POST /:id/promote\|demote`, `POST /api/admin/billing/grant-access`, `GET\|POST\|DELETE /api/admin/users/:id/feature-grants` |
| `/companies` | [(admin)/companies/page.tsx](<../app/(admin)/companies/page.tsx>) | Companies & deals CRUD — add company form, search, per-row delete. | `GET /api/companies`, `POST\|DELETE /api/admin/companies` |
| `/ecosystem` | [(admin)/ecosystem/page.tsx](<../app/(admin)/ecosystem/page.tsx>) | Programs + events CRUD with type chips (program / event). | `GET /api/ecosystem-entities`, `POST\|DELETE /api/admin/ecosystem-entities` |
| `/reports` | [(admin)/reports/page.tsx](<../app/(admin)/reports/page.tsx>) | Publish a report — title, short title, drive link, pages, description. Per-row delete. | `GET /api/reports`, `POST\|DELETE /api/admin/reports` |
| `/startups-pipeline` | [(admin)/startups-pipeline/page.tsx](<../app/(admin)/startups-pipeline/page.tsx>) | New / reviewing / added / rejected tabs for candidate companies. Submit + status transitions. | `GET /api/admin/startups-pipeline`, `POST`, `PATCH /:id` |
| `/sales` | [(admin)/sales/page.tsx](<../app/(admin)/sales/page.tsx>) | Recent billing-events table joined with profiles. Active Pro / Growth counts, cancellations. **Read-only.** | `GET /api/admin/sales` |
| `/billing` | [(admin)/billing/page.tsx](<../app/(admin)/billing/page.tsx>) | Three tools: grant single trial · bulk credit grant · **bulk-grant-access** (time-bounded tier promotion without Stripe). | `POST /api/admin/billing/{grant-trial, bulk-credit-grant, bulk-grant-access}` |
| `/jobs` | [(admin)/jobs/page.tsx](<../app/(admin)/jobs/page.tsx>) | Manual triggers for Apollo / Attio / Embeddings / Recommendations background jobs. | `POST /api/admin/integrations/{apollo, attio}/*`, `POST /api/admin/jobs/{embeddings, recommendations}/*` |
| `/data-requests` | [(admin)/data-requests/page.tsx](<../app/(admin)/data-requests/page.tsx>) | Data-change-request triage (open / picked-up / resolved / rejected). | `GET /api/admin/data-change-requests`, `POST /:id/status` |
| `/performance` | [(admin)/performance/page.tsx](<../app/(admin)/performance/page.tsx>) | Job queue + HTTP-request stats per time range. Polls every 30s. | `GET /api/admin/performance?range=...` |
| `/analytics` | [(admin)/analytics/page.tsx](<../app/(admin)/analytics/page.tsx>) | Platform-wide entity counts. Placeholder until Wave 4 wires real activity-events analytics. | `GET /api/{companies, deals, investors, acquisitions, ecosystem-entities, admin/users, admin/claims}` (with `limit: 1`) |

## Public routes (no `<AdminShell>`)

| Route | File | Purpose |
|---|---|---|
| `/login` | [login/page.tsx](../app/login/page.tsx) | Supabase magic-link / password sign-in. Edge proxy lets signed-in users skip back to `/dashboard`. |
| `/forbidden` | [forbidden/page.tsx](../app/forbidden/page.tsx) | Lands here when a signed-in non-admin tries to access an admin page. Has a sign-out button. |

## How to add a new page

1. Decide route name. Multi-word → kebab-case.
2. `mkdir app/(admin)/<name>/`, create `page.tsx` starting with `'use client';`.
3. Standard skeleton:

```tsx
'use client';
import { useState } from 'react';
import useSWR from 'swr';
import { PageHeader, Empty } from '@/components/atoms';

interface FooResponse { data: Foo[]; total: number }

export default function FooAdminPage() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useSWR<FooResponse>(['/api/admin/foo', { page, limit: 30 }]);
  const rows = data?.data ?? [];

  return (
    <div>
      <PageHeader kicker="Internal" title="Foo" subtitle="Manage foos." />
      {isLoading ? <Empty msg="Loading…" /> : (
        <div className="card">
          <table className="data-table"> {/* ... */} </table>
        </div>
      )}
    </div>
  );
}
```

4. Add a nav entry in [components/admin-shell.tsx](../components/admin-shell.tsx)'s `NAV` array with the right `lucide-react` icon.
5. If the page has mutations, add the inline-state pattern (see [data-fetching.md](data-fetching.md#writes)).
