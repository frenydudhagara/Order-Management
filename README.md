# Forkful — Order Management

An order management feature for a food delivery app: browse a menu, build a cart,
check out, and watch the order status update live.

**Stack:** FastAPI + SQLAlchemy (backend) · React + Vite + TypeScript + Tailwind (frontend)
· WebSockets for live status · SQLite for development and tests, Postgres in production
· pytest + Vitest/RTL for tests.

**Tests:** 191 backend (97% coverage) · 254 frontend. All passing.

---

## Table of contents

- [Quick start](#quick-start)
- [What it does](#what-it-does)
- [Architecture](#architecture)
- [Design decisions](#design-decisions)
- [API reference](#api-reference)
- [Testing](#testing)
- [Deployment](#deployment)
- [Where I used AI, and where I didn't](#where-i-used-ai-and-where-i-didnt)
- [Known limitations](#known-limitations)

---

## Quick start

Two terminals. Backend first.

### Backend (port 8000)

```bash
cd backend && python -m venv .venv && .venv/Scripts/activate && pip install -r requirements-dev.txt && python run.py
```

On macOS/Linux use `source .venv/bin/activate` instead of `.venv/Scripts/activate`.

The database is created and the menu seeded automatically on first boot. No migration step.
Interactive API docs: <http://localhost:8000/docs>

### Frontend (port 5173)

```bash
cd frontend && npm install && npm run dev
```

Open <http://localhost:5173>. The Vite dev server proxies `/api` to the backend, so no
environment variables are needed for local development.

### Docker alternative

```bash
docker compose up --build
```

Runs the API on port 8000; the frontend still uses `npm run dev`.

---

## What it does

| Requirement | How it is met |
| --- | --- |
| **Menu display** | `GET /api/menu` returns 16 seeded dishes across 6 categories, each with name, description, price and image. Client-side search and category filters. |
| **Order placement** | Cart with per-item quantity steppers, persisted to `localStorage`. Checkout collects name, phone and address with validation on both sides. |
| **Order status** | `Order Received → Preparing → Out for Delivery → Delivered`, plus `Cancelled`. Rendered as a timeline with per-stage timestamps. |
| **Real-time updates** | WebSocket push from a backend task that advances orders on a timer. Falls back to polling automatically, and says which mode it is in. |
| **Back-end** | REST API for menu retrieval, order placement and status updates, via SQLAlchemy. |
| **TDD** | 445 tests total, covering order CRUD, input validation, and status transitions on both sides. |
| **UI** | React + Vite + TypeScript, Tailwind for styling. |

### Seeing the real-time behaviour

Place an order and you land on the tracking page. The status advances by itself every
`STATUS_STEP_SECONDS` (default 12) and each change is pushed over the WebSocket — the
badge in the corner reads **Live** while the socket is connected. The **Demo controls**
panel at the bottom drives the same public endpoints manually if you would rather not
wait, and it is also the quickest way to see the invalid-transition guard reject a
disallowed jump.

---

## Architecture

```
┌─────────────────────────────┐         ┌──────────────────────────────────────┐
│  React (Vite, TypeScript)   │  REST   │  FastAPI                             │
│                             │ ──────► │                                      │
│  pages/     views           │         │  api/routes/   HTTP + WS endpoints   │
│  components/ presentational │  WS     │  services/     business rules        │
│  cart/      reducer+context │ ◄────── │  repositories/ data access           │
│  hooks/     data fetching   │         │  models/       SQLAlchemy ORM        │
│  api/       typed client    │         │  schemas/      Pydantic validation   │
│  lib/       pure helpers    │         │                                      │
└─────────────────────────────┘         │  realtime/     WebSocket fan-out     │
                                        │  middleware/   CORS, headers, limits │
                                        └───────────────┬──────────────────────┘
                                                        │
                                                  ┌─────▼─────┐
                                                  │  SQLite   │
                                                  └───────────┘
```

### Backend layering

Requests flow **route → service → repository → database**, and each layer has one job:

- **`api/routes/`** — HTTP concerns only: status codes, path/query validation, response models.
- **`services/`** — the business rules. Prices come from the menu, status changes obey the
  state machine, every change is recorded and announced. No SQL, no HTTP.
- **`repositories/`** — the only code that writes SQLAlchemy queries.
- **`schemas/`** — Pydantic models. All input validation lives here, so nothing downstream
  has to re-check whether a phone number is plausible.

The payoff is that the interesting logic is testable without a web server, and swapping
SQLite for Postgres touches one layer.

### Frontend layering

- **`api/client.ts`** — the only place that calls `fetch`. Translates the backend's error
  envelope into a typed `ApiError` carrying per-field messages.
- **`cart/cartReducer.ts`** — pure reducer holding the cart rules. Tested directly, with no
  React in the way.
- **`hooks/`** — data fetching, subscription lifecycle, cleanup.
- **`components/`** — presentational, driven by props.
- **`lib/`** — pure functions (formatting, validation, pricing).

---

## Design decisions

These are the choices worth explaining, and the reasoning behind each.

### Money is stored as integer cents

`price_cents: int`, never a float. `0.1 + 0.2 != 0.3` in binary floating point, and that
rounding error accumulates across order lines into totals that are off by a cent — the kind
of bug that only shows up in production accounting. Every calculation is integer arithmetic
and formatting to a currency string happens once, at the edge.

### The client never sends prices

Checkout posts only `menu_item_id` and `quantity`. The server looks up the price, computes
the line totals, the delivery fee and the total. A client that tries to send its own
`unit_price_cents` gets a 422, because the request schema uses `extra="forbid"` — rejecting
outright rather than silently ignoring, so a mistaken client learns it was wrong.

### Order lines snapshot the name and price

`OrderItem` copies the dish name and unit price at purchase time instead of joining to the
menu on read. If the kitchen renames a dish or raises a price, past orders and their totals
must not silently change — an order is business history. There is a test for exactly this.

### Orders are addressed by an unguessable UUID

The feature has no login, so an order's URL is its only access control. Sequential integer
ids would let anyone walk `/orders/1`, `/orders/2`, … and read other customers' names,
addresses and phone numbers. Each order carries a random `public_id`, and that is the only
identifier the API exposes; the integer primary key stays internal.

### Status changes go through an explicit state machine

`ALLOWED_TRANSITIONS` declares every legal move. An order cannot skip from *Received*
straight to *Delivered*, cannot move backwards, and cannot leave a terminal state — those
all return `409`. Re-applying the status an order already has is treated as a no-op rather
than an error, which makes a retried request safe. A test asserts the table covers every
member of the enum, so adding a status without wiring up its transitions fails the suite.

### Cancellation is a soft delete

`DELETE /api/orders/{id}` moves the order to `Cancelled` and keeps the row. An order the
kitchen may already have acted on is history worth keeping, and only orders that have not
yet been dispatched can be cancelled at all.

### Status progression polls the database rather than scheduling timers

The simulator wakes on a tick and looks for orders whose current status has been held longer
than `STATUS_STEP_SECONDS`, comparing against `updated_at`. A timer per order would be
simpler to write but would lose every pending transition on restart. Because the state lives
in the database, a redeploy picks up exactly where it left off — and a manual status change
naturally resets the clock, so a staff action is not immediately followed by an automatic one.

### Sync route handlers, with a thread-safe bridge for pushes

SQLAlchemy's session blocks, so route handlers are declared `def` rather than `async def`
and FastAPI runs them in a worker thread — the event loop stays free to service WebSocket
traffic. But sending on a socket is a coroutine, which a worker thread cannot await. The
`ConnectionManager` therefore exposes `publish()`, which hands the broadcast back to the
loop via `run_coroutine_threadsafe`. The service layer depends on a small `OrderEventPublisher`
protocol rather than on the manager itself, so tests inject a recording double.

### WebSocket messages carry the whole order

Every push contains the complete order, not just the new status. The client can render
straight from the message and never needs a follow-up request to stay consistent. The server
also sends a `snapshot` immediately on connect, so a client that connects late — or
reconnects after a dropped network — is instantly correct.

### The frontend degrades to polling, and says so

WebSockets are not universally reachable: corporate proxies strip upgrade requests, and some
hosts do not support them. Rather than leave the page frozen on a stale status, a failed or
dropped socket falls back to polling every four seconds, retrying the socket with exponential
backoff (capped, and capped in attempts). The indicator in the corner shows **Live** or
**Auto-refreshing**, because a customer watching a progress bar deserves to know updates are
now lagging by a few seconds rather than wonder if the page is broken.

### Validation is duplicated on purpose

The same rules exist in Pydantic and in `lib/validation.ts`. The client copy gives instant
feedback instead of a round trip per typo; the server copy is the enforcement point and is
never skipped. The form also renders whatever field errors the API returns, through the same
display path as local ones, so a rule the client does not know about still lands on the right
input. Both suites assert the same boundaries, which is what keeps them from drifting.

### Timestamps are forced back to UTC on the way out

SQLite has no timestamp type: SQLAlchemy formats datetimes into strings and drops the UTC
offset, so values read back are naive. Serialised without a `Z`, the browser would parse them
as *local* time and every "placed 2 minutes ago" label would be wrong by the client's offset.
`UtcDatetime` re-attaches UTC during serialisation. I verified the round-trip behaviour
directly rather than assuming it, and there is a test asserting the API emits `Z`.

### Cart state is Context + reducer, not a state library

The cart is the only shared client state in the app. Redux or Zustand would be ceremony
without payoff at this size. The reducer is a separate pure module, which is what makes the
cart rules — merging repeat additions, clamping quantities, dropping a line at zero —
testable without rendering anything.

### Persisted state is validated when read

A cart in `localStorage` outlives deploys, so its shape cannot be trusted. Lines missing a
`price_cents` are discarded on load; without that, one stale entry from an older build turns
the total into `NaN`. Reads are also wrapped in `try/catch` because storage can be
unavailable entirely — Safari private browsing throws on write.

### Security measures

- **CORS** is an explicit allowlist from the environment, never `*`.
- **Rate limiting** on write endpoints, per client, returning `429` with `Retry-After`.
  Deliberately in-process and dependency-free; in production this belongs at the edge, and
  the code says so.
- **Body size cap** rejects oversized payloads on `Content-Length` before they are buffered.
- **Security headers** — `nosniff`, `DENY` framing, a restrictive CSP (the API returns JSON
  only, so nothing needs to load).
- **Parameterised queries** throughout via the ORM; a test fires SQL metacharacters at the
  menu search and asserts the table survives.
- **Bounded input** — max items per order, max quantity per item, length limits on every
  string field.

---

## API reference

Base path `/api`. Full interactive docs at `/docs`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness, including whether the database is reachable |
| `GET` | `/menu` | List available dishes (`?category=`, `?search=`) |
| `GET` | `/menu/categories` | Distinct categories |
| `POST` | `/orders` | Place an order → `201` with the created order |
| `GET` | `/orders` | Order summaries (`?ids=` to hydrate the browser's stored ids) |
| `GET` | `/orders/{id}` | One order in full |
| `PATCH` | `/orders/{id}/status` | Change status (state machine enforced) |
| `DELETE` | `/orders/{id}` | Cancel — a soft delete |
| `GET` | `/orders/meta/statuses` | The status vocabulary |
| `WS` | `/ws/orders/{id}` | Live updates for one order |

### Error shape

Every failure returns the same envelope, so the frontend has one thing to parse:

```json
{
  "error": {
    "code": "invalid_status_transition",
    "message": "Cannot change order status from 'Preparing' to 'Delivered'",
    "details": { "current_status": "Preparing", "target_status": "Delivered" }
  }
}
```

Validation failures put a `fields` map in `details`, keyed by field name, which is what lets
the checkout form attach each message to the right input.

### WebSocket protocol

```
→ connect /api/ws/orders/{id}
← {"type": "snapshot",             "order_id": "…", "data": { …order… }}
← {"type": "order.status_changed", "order_id": "…", "data": { …order… }}
→ "ping"
← {"type": "pong",                 "order_id": "…", "data": {}}
```

An unknown order is closed with code `4404` — a distinct code so the client can tell "no such
order" from "server unreachable" and stop retrying. Mutations always go through REST; the
socket is a one-way transport for pushes, so there is no command surface on it to secure.

---

## Testing

```bash
# Backend: 191 tests
cd backend && python -m pytest --cov=app --cov-report=term-missing

# Frontend: 254 tests
cd frontend && npm test
```

### Backend

| File | Covers |
| --- | --- |
| `test_menu_api.py` | Retrieval, filtering, search, SQL-injection-shaped input |
| `test_orders_api.py` | Full CRUD, price authority, snapshotting, pagination |
| `test_order_validation.py` | Every field rule and boundary, oversized bodies, unknown fields |
| `test_order_status.py` | The state machine — legal paths and every illegal one |
| `test_status_simulator.py` | Timed progression, driven deterministically |
| `test_websocket.py` | Real push path, addressing, reconnect codes, cleanup |
| `test_pricing.py` | Fee thresholds and boundaries |
| `test_rate_limit.py` | Window behaviour with an injected clock |
| `test_time_utils.py` | UTC normalisation |
| `test_config.py` | Database URL rewriting and CORS parsing — both deploy-only failure modes |
| `test_database_config.py` | Postgres pooling, Supabase pooler detection, and schema compatibility — compiled without a server |

Two things worth pointing out. Each test gets a fresh in-memory SQLite database with a
`StaticPool`, so every part of the app — request handlers, the WebSocket handler, the
simulator — shares one isolated database rather than each opening its own empty one. And
nothing waits on wall-clock time: the simulator is driven by calling `tick()` with
back-dated rows, and the rate limiter takes an injected clock.

### Frontend

| File | Covers |
| --- | --- |
| `cartReducer.test.ts` | Cart rules, clamping, immutability |
| `CartContext.test.tsx` | Persistence and recovery from malformed stored data |
| `MenuItemCard.test.tsx` | Add/stepper states, image fallback, a11y labelling |
| `CheckoutForm.test.tsx` | Validation timing, focus management, server error display |
| `OrderStatusTracker.test.tsx` | Stage states, cancellation, live-region announcements |
| `client.test.ts` | Request shape, error translation, abort handling |
| `useOrderTracking.test.ts` | WebSocket push, fallback to polling, backoff, cleanup |
| `MenuPage.test.tsx` | Browse → filter → add to cart, integrated |
| `CheckoutPage.test.tsx` | Placing an order and every failure mode |
| `OrderTrackingPage.test.tsx` | A pushed status moving the timeline on screen |
| `OrdersPage.test.tsx` | Per-browser history |

Tests query by role and accessible name rather than by CSS class, so they assert what a user
can actually perceive and survive restyling. A controllable `FakeWebSocket` stands in for the
real one, which is what makes the transport behaviour — snapshot, push, drop, backoff,
give up and poll — testable at all.

---

## Deployment

The brief suggests Vercel or Netlify. That works for the frontend but not for this backend:
Vercel's Python runtime is serverless, which rules out both a long-lived WebSocket and the
background task that advances order status. So the two halves are hosted separately.

### Database: managed Postgres, not SQLite

SQLite is right for local development and tests — zero setup, and the suite runs against an
in-memory database. It is the wrong choice for the deployed API. Free hosting tiers restart
an idle instance and rebuild the container on every deploy, and the container filesystem does
not survive either. A reviewer who places an order, closes the tab and comes back would find
an empty "My orders" list and a 404 on their order URL — the feature failing at exactly the
thing it is meant to demonstrate. (A persistent disk would fix it, but that needs a paid plan
and pins the service to one instance.)

**Supabase** is the chosen provider. Two of its specifics are worth knowing before deploying,
because both fail in ways that do not point at their cause:

- **Use the session pooler string, not the direct connection.** Supabase's direct host
  (`db.<ref>.supabase.co`) is IPv6-only, and Render's free tier is IPv4-only, so it simply
  fails to resolve. The session pooler (`aws-0-<region>.pooler.supabase.com:5432`) is
  IPv4-reachable, and session mode holds one backend per connection — which is what a
  long-running server with its own connection pool wants.
- **The free tier pauses a project after about a week of inactivity**, and resuming it is a
  manual click in the dashboard. For a submission that may sit unopened for a fortnight, that
  means a reviewer could arrive to a dead API. See [Keeping it awake](#keeping-it-awake) below
  — a free uptime pinger solves it, and solves the same problem on the Render side at once.

The transaction pooler on port 6543 also works: the app detects that port and disables psycopg's
automatic prepared statements, which would otherwise break when a later execution lands on a
different backend. Session mode is still the better fit here, so prepared statements stay on.

Switching is one environment variable, because the layering was built for it:

| Already in place | Why it mattered here |
| --- | --- |
| Repositories own every query | No SQL scattered through the services to find and port |
| `Enum(native_enum=False)` | `status` compiles to `VARCHAR(32)`, so there is no Postgres `ENUM` type to create or migrate |
| `DateTime(timezone=True)` + `ensure_utc` | Postgres returns *aware* datetimes where SQLite returns naive ones; the helper already handles both |
| `pool_pre_ping` gated on non-SQLite | Correct pooling was already wired for the Postgres path |

`tests/test_database_config.py` compiles the schema against the Postgres dialect and asserts
these properties, so the deployment path stays covered even though CI runs on SQLite.

One detail worth knowing: Supabase hands out URLs beginning `postgres://`, and SQLAlchemy 2.0
rejects that prefix, while a bare `postgresql://` selects psycopg2, which this project does
not install. `normalise_database_url` rewrites both to `postgresql+psycopg://`, so the
connection string can be pasted verbatim from the dashboard.

### Database → Supabase

1. Create a project. Note the database password — it is shown once.
2. Open **Connect** and copy the **Session pooler** string, not the direct connection. It
   looks like:
   `postgres://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`
3. Substitute your password into it, **without** the surrounding `[ ]` — those are the
   dashboard's placeholder markers, and they are reserved characters in a URL. Percent-encode
   any special characters in the password itself (`@` → `%40`, `#` → `%23`).

Then verify the string locally before deploying with it. Put it in `backend/.env` — which is
gitignored, and is the only file it should ever live in — as `DATABASE_URL=...`, then run:

```bash
cd backend && python check_db.py
```

It connects, creates the schema, seeds the menu and reports what it found. It also flags the
mistakes that are easy to make — brackets left around the password, an unsubstituted
placeholder, the IPv6-only direct host, the wrong pooler port — each with its specific fix,
and redacts the password in everything it prints. Checking here takes seconds; finding the
same fault on a hosting platform costs a container build per attempt.

Tables are created and the menu seeded on first boot, so there is nothing else to set up.

### Backend → Render / Railway / Fly.io

`render.yaml` and `backend/Dockerfile` are committed — a slim image running as a non-root user.

1. Deploy the blueprint, setting `DATABASE_URL` to the Supabase session pooler string.
2. Leave `CORS_ORIGINS` unset for now; it needs the frontend's origin.
3. Check `/api/health` returns `{"status": "ok", "database": "ok"}`. If `database` is
   `unreachable`, the connection string is wrong — most often the direct host instead of the
   pooler, or an unescaped character in the password.

Tables are created and the menu seeded on first boot, so there is no migration step. That is
`Base.metadata.create_all`, which is fine for a feature this size but is not a substitute for
real migrations: it creates missing tables and will not alter existing ones, so the first
schema change to a live database needs Alembic.

### Frontend → Vercel

`frontend/vercel.json` is committed with the SPA rewrite (needed so refreshing `/orders/<id>`
does not 404) and asset caching headers.

1. Root directory `frontend`, build `npm run build`, output `dist`.
2. Set `VITE_API_BASE_URL` to the API origin — no trailing slash. It is read at **build**
   time, so changing it later needs a redeploy, not just a restart.
3. Go back and set `CORS_ORIGINS` on the API to the Vercel origin, then redeploy the API.

The frontend derives its WebSocket URL from the API origin, mapping `https` to `wss`
automatically, so there is nothing extra to configure and no chance of the two disagreeing.

### Keeping it awake

Two free-tier sleep behaviours stack up badly for a take-home that gets reviewed on someone
else's schedule: Render spins down a web service after ~15 minutes idle, and Supabase pauses a
project after about a week, which needs a manual click to undo.

Point a free uptime monitor (UptimeRobot, cron-job.org) at `https://<api-host>/api/health`
every 10 minutes. That single request fixes both: it keeps the Render instance warm, and
because the health check runs `SELECT 1`, it counts as database activity and keeps the Supabase
project from pausing. Set this up when you deploy, not when you send the link.

### If something is wrong after deploying

| Symptom | Cause |
| --- | --- |
| `/api/health` reports `"database": "unreachable"` | Wrong connection string — usually the IPv6-only direct host instead of the session pooler, or an unescaped character in the password |
| Menu never loads, CORS error in the console | `CORS_ORIGINS` does not match the frontend origin exactly — scheme included, no trailing slash |
| Worked yesterday, everything 500s today | The Supabase project paused after a week idle. Resume it in the dashboard, then add the uptime pinger above |
| Intermittent "prepared statement does not exist" | The transaction pooler is in use but the port is not 6543, so the app could not detect it. Switch to the session pooler string |
| Everything works but the badge says *Auto-refreshing* | The WebSocket could not connect; the app is polling instead. Check the host actually supports WebSockets |
| First request after a quiet period is slow | Free instances and paused databases have a cold start. Subsequent requests are normal |
| Status stops advancing overnight | The instance spun down, so the background task stopped with it. It catches up within a few ticks of the next request |

---

## Where I used AI, and where I didn't

I used Claude (in Claude Code) throughout, and the useful distinction was between work where
it is genuinely fast and work where I had to make the call myself.

**Where it did the heavy lifting**

- Scaffolding the layered structure and generating the seed data.
- Writing the bulk of the tests once I had decided *what* to assert. Enumerating boundary
  cases — every illegal status transition, phone formats that should and should not pass — is
  exactly the kind of breadth it produces quickly and reliably.
- Tailwind markup and the accessibility scaffolding (label wiring, `aria-describedby`,
  live regions).

**Where I had to drive**

- The architectural choices in [Design decisions](#design-decisions) — integer cents, opaque
  order ids, snapshotting order lines, polling-based progression. These are judgement calls
  about failure modes, and the first draft of several of them was the simpler wrong answer.
- The sync-handler/thread-safe-publish bridge. Getting `run_coroutine_threadsafe` right
  needed reasoning about which thread owns the event loop, not pattern matching.
- **Verifying assumptions instead of trusting them.** Two examples: I did not trust that
  SQLAlchemy round-trips a timezone-aware datetime through SQLite intact — I wrote a throwaway
  script to check, found the offset is silently dropped, and added `UtcDatetime` to fix a
  timezone bug that would only have shown up for users outside UTC. Similarly, I ran the real
  stack and drove a real WebSocket handshake by hand to confirm live pushes actually arrive,
  rather than concluding it worked because unit tests passed.
- **A bug found by writing the test, not by running the app.** Preparing for deployment, I
  added a test asserting `CORS_ORIGINS` could be set as a comma-separated string — the form my
  own `.env.example` documents. It failed. pydantic-settings JSON-decodes complex-typed
  environment values *before* field validators run, so that value raises a `SettingsError` at
  import and the process dies before it can log anything useful. It is invisible locally,
  where the default is a Python list, and would have appeared as a boot loop on Render with a
  message that does not point at the cause. Fixed with `NoDecode`, which hands the raw string
  to the validator; the config now accepts both a comma-separated string and a JSON array.
- **Debugging its output.** Eight of my first frontend tests failed, and the causes were
  instructive: a shared `Response` object cannot be read twice, so polling tests broke on the
  second call; Testing Library's `waitFor` cannot pump Vitest's fake timers, so frozen-clock
  tests hung; and passing `undefined` to a parameter with a default silently uses the default.
  Each needed diagnosis, not a retry.

The honest summary: AI compressed the mechanical work — boilerplate, test breadth, markup —
by a large factor, and was of little help on the decisions that actually determine whether
the code is correct under load, across timezones, or a year from now.

---

## Known limitations

Stated plainly, with what I would do about each.

- **WebSocket fan-out is single-process.** Behind multiple workers each process would only
  reach its own subscribers. The fix is Redis pub/sub behind the existing `publish()`
  interface — the seam is already there. The polling fallback means the UI stays correct
  either way.
- **Rate limiting is in-process.** Per-worker counters, and the client key comes from the peer
  address, which a proxy can rewrite. Belongs at the edge in production.
- **No authentication.** Not in the brief. Orders are protected only by an unguessable id,
  which is why they use random UUIDs. Real deployment needs accounts, and `GET /api/orders`
  without an `ids` filter — currently a kitchen-side view — would need to be restricted.
- **Schema creation is `create_all`, not migrations.** It creates missing tables but will not
  alter existing ones, so the first schema change against a live database needs Alembic.
  Acceptable for a feature of this size; not for an evolving product.
- **The status simulator stops when the instance sleeps.** On a free tier that spins down when
  idle, orders freeze mid-flow until the next request wakes the service — at which point the
  simulator finds them overdue and catches up a step per tick. Correct, but not the same as a
  worker that always runs.
- **Status progression is simulated,** as the brief specifies. A real system would take these
  transitions from restaurant and driver apps; the `PATCH` endpoint is already the seam they
  would call.
- **No payment step.** Out of scope, and the checkout page says so.
