# Cellvix

B2B wholesale marketplace for replacement electronics parts — screens, batteries, cameras and
housings for repair shops, refurbishers and resellers across Canada.

It is not a normal shop. The people buying here are businesses with a wholesale account, so three things
work differently from a consumer store, and most of the architecture follows from them:

1. **Prices are private.** Nobody sees wholesale pricing until an admin has approved their business.
   That gate is enforced on the server — the price is simply absent from the API response for
   everyone else.
2. **Buying happens on credit.** An approved account has a credit limit and payment terms (Net 30
   and so on). Orders draw against the limit and are invoiced, rather than being paid for up front.
3. **Buyers know what they want.** The catalogue is ~420 parts across a deep device tree, so finding
   "the back glass for a Galaxy S23 Ultra, OEM grade" has to take seconds. Three different filter
   UIs exist for that, and they all share one state.

**Stack:** React 19 · Vite 6 · Tailwind v4 · Express 4.21 · MongoDB / Mongoose 8 · Zod.
JavaScript ESM throughout, npm workspaces.

---

## What is in it

**For a buyer**

- A catalogue filtered by device type → brand → series → model, plus part type, grade, price and
  stock — through a sidebar, a mega menu or a step-by-step wizard, whichever suits.
- Live search over part names, SKUs and models.
- A cart that survives sign-in, can be saved and reloaded, and can be filled from a **quick order
  pad** (search a part per line, or paste a column of SKUs out of a spreadsheet).
- A five-step checkout that pays by card or on account, applies store credit automatically, and
  accepts a promo code.
- An account dashboard: orders with tracking, invoices and statements, credit and balance, saved
  addresses, payment methods.

**For an admin**

`/admin` is not a settings screen bolted onto a shop — it is the business's ERP, and Cellvix is the
system of record. It runs in its own shell (dark sidebar, command palette on `Ctrl`/`⌘ K`,
notification bell, breadcrumbs) with no storefront chrome, and every route is wired:

- An approvals queue — a new business signs up, an admin sets its credit limit and terms and lets it
  in.
- **Sales:** orders, invoices, quotes, RMAs, customers and client profiles, with refunds to store
  credit, credit-limit changes and status moves with tracking numbers.
- **Purchase:** suppliers, purchase orders and expenses against a category tree.
- **Inventory:** stock, reorder points and competitor benchmarks per SKU.
- **Reports:** a dashboard of collected/invoiced/outstanding, trend and top-client charts, plus a
  business overview built to print.
- **Marketing:** offers, blog, FAQ, email, and SMS/WhatsApp/call logs.
- **Outlet, staff & roles:** outlets, staff accounts, and per-area permission roles — an admin
  bypasses the role system, a staff account without a role is told it has no access yet.
- **Settings:** business info, sale/shipping/payment/inventory defaults, taxonomy, invoice statuses
  and messages, email templates, API keys and encrypted third-party secrets, appointments and the
  scheduling board, plus an activity log and a separate security log.

Every list screen is one component — search, segmented pills, filter and export popovers, sortable
columns that fold into an expandable row rather than disappearing at narrow widths.

**Offers** are their own engine: percentage or fixed discounts, combo bundles priced as a unit,
promo codes that can be single-use or open, and offers restricted to named accounts.

---

## Quick start

```bash
npm install                 # root + both workspaces
cp .env.example .env        # then fill in MONGODB_URI and JWT_SECRET
npm run seed                # wipes and populates whichever DB MONGODB_URI names
npm run dev                 # client on :5173, API on :4000
```

Open <http://localhost:5173>. The Vite dev server proxies `/api` to `:4000`, so the app is
same-origin in development and the httpOnly session cookie travels without CORS credential
handling.

### Demo accounts

Password for all three: `Cellvix123!`

| Email | What it demonstrates |
| --- | --- |
| `buyer@cellvix.ca` | Approved business — wholesale pricing, Net 30 terms, order and invoice history |
| `pending@cellvix.ca` | Awaiting approval — can browse and hold a cart, cannot see prices or order |
| `admin@cellvix.ca` | Admin — approvals queue, product/order/customer management, editorial consoles |

Sign in as `pending@cellvix.ca` to see the price gate from the outside: the same pages, with prices
replaced by a prompt to finish approval. That is not CSS — the numbers are not in the payload.

---

## How it works

### The shop page is the homepage

There is no separate landing page and no category routes. `/` is the catalogue.

A sidebar accordion, a three-panel mega menu and a step-by-step tab wizard all read and write
**one** Zustand store (`client/src/store/filterStore.js`). Selecting a brand in the mega menu
updates the sidebar and the wizard, mirrors into the URL so the view is shareable, and re-renders
**only the product grid** over AJAX. Nothing navigates. Three UIs, one truth.

### From cart to invoice

```
add to cart ─▶ checkout quote ─▶ place order ─▶ invoice ─▶ email
     │              │                  │            │
   SKU + qty     server prices     server prices   generated from
   only          the whole cart    it again        the order
```

The client never sends a price, a subtotal or a discount — it sends SKUs and quantities. The cart
badge, the checkout total and the amount actually charged all come from **one** function,
`pricingService.priceCart()`, run against live product records. A stale price in a week-old browser
tab cannot become a cheap order.

When the order is written, an invoice is created with it and **emailed to the buyer**. The same
document is served at `GET /api/invoices/:number/document` for print-to-PDF from the dashboard.
With no `SMTP_URL` configured the mailer writes each message to `server/.mail/` and logs it —
delivery is a side effect of ordering and is never allowed to fail one.

### Two kinds of credit, deliberately kept apart

| | What it is | Who moves it |
| --- | --- | --- |
| **Line of credit** | What Cellvix *lends* the business — `creditLimit`, `balance`, `terms` | An admin sets the limit; orders on terms draw against it |
| **Store credit** | What the business *already holds* — refunds, prepaid top-ups, admin allocations | `storeCreditService.js`, always with a `CreditTransaction` behind it |

Only store credit spends itself at checkout. They were one number early on, which made a refund and
a credit limit look like the same thing on the dashboard. They are not.

### Approval, and what it gates

Signing up creates a **pending** business. A pending account can sign in (and is told it is under
review — not given a credential error), browse the catalogue and fill a cart. It cannot see prices
and cannot order. An admin approves it, sets a credit limit and terms, and everything unlocks. The
cart it was holding is still there.

---

## Repo layout

```
client/           React app (Vite)
  src/
    components/   ui/ primitives, plus filters, cart, checkout, product,
                  account, blog, layout, search, and admin/ — which carries
                  its own shell/, charts/ and list kit for the ERP console
    pages/        one file per route; account/ and admin/ are sub-consoles
    store/        Zustand: filterStore, cartStore, uiStore
    hooks/        data fetching (TanStack Query) and DOM behaviour
    lib/          api client, formatters, rich-text renderer
server/           Express API
  src/
    routes/       one router; every route names its middleware
    controllers/  request/response only — no Mongoose in here
    services/     all business logic and queries
    models/       Mongoose schemas
    seed/         deterministic catalogue and demo data
shared/           Zod schemas + business details, imported by BOTH sides
scripts/          smoke, a11y and screenshot runners
docs/             ERP integration notes, screenshots
```

`shared/` is the point of the layout: `shared/schemas/*.js` holds the Zod schema that the client
form validates against **and** the server route validates against, so the two cannot disagree about
what a valid order looks like. `shared/business.js` holds the company's own details, which both the
footer and the server-rendered invoice read.

### Server layering

```
route ─▶ controller ─▶ service ─▶ model
```

Controllers never touch Mongoose. Three services own an invariant outright:

- **`pricingService.js`** is the only place a discount is decided. Offers never stack, a product
  carries at most one offer, a promo code cannot reach inside a combo bundle, single-use codes are
  checked against order history rather than a counter, and account-restricted offers answer
  `OFFER_NOT_FOUND` to everyone else.
- **`storeCreditService.js`** is the only place a store-credit balance moves. Every change writes a
  `CreditTransaction`; no balance is ever set by hand.
- **`payment.js`** is the only gateway-aware file. It is a **mock** — swapping in Stripe or Moneris
  is a change to this one file. A PO number beginning `DECLINE` routes checkout to
  `/payment-failed`, so the failure path is reachable without touching config.

### Money

Stored as **integer cents**, everywhere, with no exceptions. Formatting to `$1,234.56` happens once,
at the edge, in `client/src/lib/format.js`.

---

## Environment

Both workspaces read one `.env` at the repo root. `server/src/config/env.js` validates it with Zod
and **exits at boot** with a named error if anything is missing or malformed — a half-configured
server is worse than none.

| Variable | Required | Notes |
| --- | --- | --- |
| `MONGODB_URI` | **yes** | No in-memory fallback. Prefer a replica set (any Atlas cluster is one) — the planned transactional order write needs one. |
| `JWT_SECRET` | **yes** | Minimum 16 characters. The server refuses to start in production if this is still the development placeholder. |
| `NODE_ENV` | no | `development`, `test` or `production` |
| `PORT` | no | Defaults to `4000` |
| `JWT_EXPIRES_IN` | no | Defaults to `7d`. "Remember me" issues 90d instead; without it the cookie is a session cookie. |
| `COOKIE_NAME` | no | Defaults to `cellvix_session` |
| `CLIENT_ORIGIN` | no | Comma-separated list of origins allowed to send credentialed requests |
| `SMTP_URL` | no | Where invoice mail goes. Unset, messages are written to `server/.mail/` instead of sent. Real delivery also needs `npm i nodemailer -w server`. |
| `MAIL_FROM` | no | Envelope sender. Defaults to `Cellvix <billing@cellvix.ca>` |
| `PUBLIC_ORIGIN` | no | Where links in an email point. Defaults to the first `CLIENT_ORIGIN` |
| `MOCK_PAYMENT_DECLINE` | no | Forces the mock gateway to refuse every charge, so `/payment-failed` can be exercised |
| `VITE_API_URL` | no | Defaults to `/api` |

`.env` is gitignored. Only `.env.example` is tracked.

---

## Scripts

```bash
npm run dev            # client + server together
npm run build          # production client bundle
npm run seed           # WIPES taxonomy, products, users, orders, invoices, then reseeds
npm run seed:demo      # the additive demo seeds in order; `-- <name>` runs one, `-- --list` names them
npm run backfill       # the one-off migrations; no args lists them, `-- <name>` runs one
npm run smoke          # 208 end-to-end API assertions
npm run a11y           # axe-core WCAG 2.1 AA audit across 39 surfaces
npm run shoot          # Playwright screenshot set -> docs/screenshots/
```

> `smoke`, `a11y` and `shoot` all **write real data** — `shoot` places an actual order, moving
> stock, invoices and credit. They run against the `cellvix` development database, which holds only
> dummy data; re-seed whenever the residue gets in the way:
>
> ```bash
> npm run seed
> npm run smoke
> ```

The seed is deterministic — a seeded PRNG produces the same taxonomy and the same 420 SKUs on every
run, so screenshots and assertions stay stable.

In production the API also serves the built client, so the whole site is one origin and one process:

```bash
npm run build
NODE_ENV=production npm start
```

---

## Security posture

- **The price gate is server-side.** For anyone who is not an approved buyer the serializer omits
  `price` from the payload entirely — not blurred, not zeroed. The client's blur is cosmetic. The
  same gate covers a combo offer's bundle price.
- **Availability leaves as a boolean.** The storefront says in stock or out of stock. On-hand counts
  and shipment dates are wholesale-operations numbers and stay in the admin payload.
- **Sessions are httpOnly JWT cookies**, `sameSite: lax`, `secure` in production. A cookie that no
  longer resolves to a user is actively cleared rather than left to expire.
- **Approval gate, not a credential error.** A pending account signs in successfully and is told it
  is still under review. Pricing and ordering are blocked separately by `requireApproved`.
- **Query values can never become Mongo operators.** Express's default `qs` parser turns
  `?brand[$ne]=x` into a nested object; `app.js` selects the `simple` parser so query values arrive
  as strings and arrays only, and every equality assignment is coerced with `String()`.
- **Every mutating route validates through a shared Zod schema** in `shared/schemas/`, used by the
  client form and the server route alike.
- **Rate limiting** on credential endpoints and the unauthenticated contact form.
- **No `dangerouslySetInnerHTML` anywhere.** Admin-authored copy — blog, FAQ, offers — renders
  through `client/src/lib/richText.jsx`. The one page that needs an inline script, the printable
  invoice, ships its own `default-src 'none'` policy with a per-request nonce rather than loosening
  the app's.
- Helmet, `x-powered-by` disabled, stack traces suppressed in production, and payment methods stored
  as brand plus last four digits only.

---

## Conventions

- Canadian throughout — CAD, provinces, `A1A 1A1` postal codes, GST/HST.
- The brand gradient `#CF3429` to `#000000` is an **accent** — CTAs, active states, progress. Never
  a page or card background.
- **Responsive is a requirement, not a polish pass.** 320–767, 768–1023, 1024–1439 and 1440+ are
  each designed, never a shrunk desktop layout. No horizontal page scroll at any of them.
- One `StepIndicator` component serves the tab wizard, checkout and order tracking.
- One dropdown: `components/ui/SelectMenu`. There is no native `<select>` in the app — form fields
  bind to it through `SelectField`, which wraps a react-hook-form `Controller`.
- History is append-only. Catalogue entries deactivate rather than delete, because orders reference
  products by id.
- A cart needs only sign-in; **ordering** needs approval. A pending business keeps its cart while it
  waits.

---

## Project documentation

Everything except this README and `CLAUDE.md` lives in [docs/](docs/).

| File | What it is |
| --- | --- |
| [PROJECT_INSTRUCTIONS.md](docs/PROJECT_INSTRUCTIONS.md) | The rules — design tokens, filter architecture, data model, full API contract, definition of done. Binding. |
| [SAAS_PLATFORM.md](docs/SAAS_PLATFORM.md) | The multi-tenant end state — super admin, per-tenant databases, feature flags. Binding for tenancy work. |
| [ADMIN_ERP_REWORK.md](docs/ADMIN_ERP_REWORK.md) | Plan for rebuilding `/admin` as a full ERP console. Cellvix is the ERP — there is no external system of record. |
| [PROGRESS.md](docs/PROGRESS.md) | Phase board, decisions log, session log, known gaps, open questions. |
| [cellvix-project-brief.md](docs/cellvix-project-brief.md) | The client's original brief. Read-only reference. |
| [CLAUDE.md](CLAUDE.md) | Session primer for AI coding agents. Stays at the root so it auto-loads. |

---

## Status

**The brief is delivered.** All nine build phases are complete — foundation and design system, data
layer, shop page, cart and checkout, accounts, admin, static pages, editorial surfaces, and the
offers engine.

On top of it, the **admin ERP rework** is 12 of 13 phases in: shell and component kit, dashboard,
sales depth, purchase, reports, quotes and RMA, outlet/staff/roles, marketing, referrals, settings,
and the search/profile/export/notification layer. **No admin route renders a stub and nothing in the
shell is unwired.** Phase 13 wires the remaining §6b shells. `docs/ADMIN_ERP_REWORK.md` is the plan;
`PROGRESS.md` is the board.

`npm run smoke` runs 208 end-to-end API assertions. `npm run a11y` audits 39 surfaces against WCAG
2.1 AA.

Outstanding work is either hardening or blocked on the client. The largest open items: order
creation still writes its four documents outside a transaction, and approval, rejection and
forgot-password emails are not written yet — the mail transport exists, but a provider still has to
be chosen and configured. `PROGRESS.md` tracks both lists in full.
