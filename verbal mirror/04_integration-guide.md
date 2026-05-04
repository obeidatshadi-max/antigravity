# Antigravity Ecosystem — Supabase Integration Guide
## ORBIT ↔ Verbal Mirror Shared Backend

---

## What's in This Package

| File | Purpose |
|---|---|
| `01_schema.sql` | Run once in Supabase SQL editor. Creates all tables, views, RLS, and triggers. |
| `02_supabase_client.js` | Shared module. Import into both apps. All DB operations go through this. |
| `03_verbal-mirror-supabase.js` | Drop into Verbal Mirror HTML. Auto-persists all outputs to Supabase. |
| `04_integration-guide.md` | This file. |

---

## Step 1 — Supabase Project Setup

1. Go to https://supabase.com → New project
2. Name it: `antigravity-ecosystem`
3. Choose region: Middle East (Bahrain) — closest to Jordan
4. Copy your **Project URL** and **anon public key** from Settings → API

---

## Step 2 — Run the Schema

1. Open Supabase Dashboard → SQL Editor
2. Paste the full contents of `01_schema.sql`
3. Click **Run**
4. Verify in Table Editor that these tables exist:
   - `profiles`
   - `orbit_personas`
   - `orbit_habit_entries`
   - `orbit_action_plans`
   - `vm_analyses`
   - `vm_comparisons`
   - `vm_journal_entries`
   - `vm_weekly_portraits`
   - `ecosystem_timeline`

---

## Step 3 — Add to Verbal Mirror

Add two script tags to `verbal-mirror.html` just before `</body>`:

```html
<!-- Supabase credentials — replace with your values -->
<script>
  window.__SUPABASE_URL__      = 'https://YOUR_PROJECT.supabase.co'
  window.__SUPABASE_ANON_KEY__ = 'YOUR_ANON_KEY'
</script>

<!-- Integration layer -->
<script type="module" src="./verbal-mirror-supabase.js"></script>
```

That's it. The integration layer hooks into the existing VM functions
automatically. No changes to existing code required.

---

## Step 4 — Add to ORBIT

ORBIT needs two things:

### 4a — Save persona to Supabase after assessment

```javascript
import { saveOrbitPersona, buildOrbitBridgeUrl } from './supabase_client.js'

// After calculating the user's Gravity scores:
const persona = await saveOrbitPersona(userId, {
  gravity_thinking:   scores.thinking,
  gravity_emotional:  scores.emotional,
  gravity_physical:   scores.physical,
  psychological_mass: scores.mass,
  trigger_distance:   scores.distance,
  archetype_label:    result.archetype,
  enneagram_hint:     result.enneagram,
  dominant_mask:      result.maskType,
  mask_score:         result.maskScore,
  score_creativity:       scores['4c'].creativity,
  score_collaboration:    scores['4c'].collaboration,
  score_critical_thinking: scores['4c'].criticalThinking,
  score_communication:    scores['4c'].communication,
  source:     'orbit',
  is_baseline: true,  // set on first assessment
})
```

### 4b — Build the bridge URL to Verbal Mirror

```javascript
// When user taps "Open Verbal Mirror" in ORBIT:
const vmUrl = await buildOrbitBridgeUrl(
  userId,
  'https://your-verbal-mirror.netlify.app'
)
window.location.href = vmUrl
// This URL carries the persona as query params.
// Verbal Mirror reads them on load and shows the ORBIT banner.
```

---

## Step 5 — Enable Authentication

In Supabase Dashboard → Authentication → Providers:

- Enable **Email** (already on by default)
- Optionally enable **Google** or **Apple** for mobile-friendly sign-in

For the single-file HTML app deployment, the built-in auth modal
(rendered by `03_verbal-mirror-supabase.js`) handles sign-in/up.

For the ORBIT iOS app, use Supabase's native Swift SDK:
```
https://github.com/supabase/supabase-swift
```

---

## Data Flow Summary

```
ORBIT iOS App
    │
    ├── Assessment complete
    │   └── saveOrbitPersona() → orbit_personas table
    │
    ├── Daily habit log
    │   └── logHabitEntry() → orbit_habit_entries table
    │                         → ecosystem_timeline (auto-trigger)
    │
    └── Open Verbal Mirror
        └── buildOrbitBridgeUrl() → URL params
                │
                ▼
        Verbal Mirror (Web)
            │
            ├── readOrbitBridgeParams() → shows ORBIT banner
            │                          → pre-loads persona context
            │
            ├── Solo Analysis
            │   └── saveVmAnalysis() → vm_analyses table
            │                        → ecosystem_timeline (auto-trigger)
            │
            ├── Voice Journal
            │   └── saveJournalEntry() → vm_journal_entries table
            │                          → ecosystem_timeline (auto-trigger)
            │
            └── Weekly Portrait
                └── saveWeeklyPortrait() → vm_weekly_portraits table

Coach Dashboard (future)
    └── coach_client_overview view
    └── gravity_delta_view
    └── realtime subscriptions → live client activity
```

---

## What the Coach Sees (Dashboard Queries)

```sql
-- All clients with their latest gravity scores and activity
SELECT * FROM coach_client_overview
WHERE coach_id = 'YOUR_COACH_UUID';

-- Gravity drift for a specific client vs their ORBIT baseline
SELECT * FROM gravity_delta_view
WHERE user_id = 'CLIENT_UUID';

-- Full ecosystem timeline for a client (both apps, chronological)
SELECT * FROM ecosystem_timeline
WHERE user_id = 'CLIENT_UUID'
ORDER BY occurred_at DESC
LIMIT 50;
```

---

## Security Model

| Who | Can Read | Can Write |
|---|---|---|
| Client | Own data only | Own data only |
| Coach | All assigned clients' data | None (read-only access to client data) |
| Admin | All data | All data |
| Public | `vm_analyses` where `is_public = TRUE` | None |

All enforced by PostgreSQL Row Level Security — no application-level
enforcement required.

---

## Offline / localStorage Fallback

If the user is not signed in, all data continues to be stored in
localStorage exactly as before. Nothing breaks.

When the user signs in:
- Verbal Mirror reads their cloud journal and merges it into localStorage
- Future saves go to both localStorage and Supabase
- Supabase is the source of truth; localStorage is the cache

---

## Environment Variables for Deployment

For Netlify, Vercel, or similar:
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here
```

For single-file HTML (no build step), inject directly:
```html
<script>
  window.__SUPABASE_URL__      = 'https://...'
  window.__SUPABASE_ANON_KEY__ = 'eyJ...'
</script>
```

Never expose your **service_role** key in any frontend file.
The anon key is safe to expose — RLS enforces access control.
