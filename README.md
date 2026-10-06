# Kelinto

A multi-tenant ERP for service and retail businesses: repair shops, parts wholesalers, garages,
salons, clinics, IT services. One codebase serves every business on it, each with its own website,
its own ERP and its own database.

The repository is still called `cellvix` because it started as Cellvix, a B2B wholesale marketplace
for replacement phone parts. That build became **tenant #1** on Kelinto. Where code or older
docs say "Cellvix" meaning the whole system, read "Kelinto".

**Stack:** React 19 · Vite 6 · Tailwind v4 · TanStack Query · Zustand · Express 4.21 · MongoDB /
Mongoose 8 · Zod · Cloudflare R2. JavaScript ESM throughout, npm workspaces (`client`, `server`,
plus `shared/` imported by both). Node 20 or later.

---

## The model in one minute

- A **tenant** is an account. It owns **one or more businesses**, buying a slot from Kelinto for
  each one.
- **The business owns the database.** The control database holds tenants, plans, super admins and
  the `Business` records; each business's records live in `<DB_PREFIX>_biz_<code>`.
- Every business is typed **product** (sells parts), **service** (repairs devices) or **both**. The
  type sets which ERP sections exist by default; a super admin can toggle any feature per business
  afterwards.

| | Product | Service | Both |
|---|---|---|---|
| **Sales** | Customers · Orders · Returns · Invoices · Web Quote | Customers · Tickets · Invoices · Quotes · Web Quote | union |
| **Purchase** | Suppliers · Purchase Orders · Expenses · Inventory | Suppliers · Purchase Orders · Expenses · Inventory | union |

Product runs **Quote → Order → Invoice**, service runs **Quote → Ticket → Invoice**, so `both` is a
clean union. Returns (`Rma`, money out, needs an order) and Tickets (work to do, money in) are
separate records.

**Tenant #1 runs one business today: CellShoppe, typed `both`,** and it is the default business. It
sells parts on its website and repairs devices at the counter.

---

## The surfaces

| Surface | Who uses it | Live | Local |
|---|---|---|---|
| **Website** | A business's customers | https://cellshoppe.kelinto.com | http://cellshoppe.localhost:5173 |
| **ERP** | Owners and staff | https://app.kelinto.com | http://app.localhost:5173 |
| **Console** | Kelinto's super admins | https://admin.kelinto.com | http://admin.localhost:5173 |
| **Supplier portal** | A business's suppliers | `<website>/supplier` | http://cellshoppe.localhost:5173/supplier |
| **Kiosk** | Walk-in customers, on a tablet | `<website>/kiosk` | http://cellshoppe.localhost:5173/kiosk |
| **Kelinto** | Everyone else | https://kelinto.com | http://localhost:5173 |

`*.localhost` resolves to your own machine in every major browser, so the host split works locally
with no hosts-file edit. With `PANEL_HOST` and `SUPERADMIN_HOST` empty, every route also works on
plain `localhost:5173`.

A business can also have its own domains (`parts.cellshoppe.ca` for the website, an ERP domain for
staff). Those are saved in the console and need no env edit or restart; see
[docs/SUBDOMAIN_SETUP.md](docs/SUBDOMAIN_SETUP.md).

### Website

The homepage is a landing page at `/`; the catalogue lives at `/shop`, with `/clearance` and
`/deals/:slug` beside it. Three filter UIs (sidebar, mega menu, step wizard) share **one** Zustand
store and re-render only the product grid. The filter hierarchy is Component Type → Device Type →
Brand → Series → Model.

Customers have a wholesale account. Three things follow from that:

1. **Prices are private.** Nobody sees a price until the business approves their account, and the
   gate is on the server: the price is absent from the API response, not blurred.
2. **Buying can happen on credit.** An approved account can carry a credit limit and terms (Net 30
   and so on).
3. **A pending account can sign in and fill a cart,** and is told it is still under review rather
   than given a credential error. Ordering needs approval.

### ERP

Sales, Purchase, Inventory, Reports, Marketing, Outlets, Staff and Roles, Settings. Compact by design
(36px fields, a command palette on `Ctrl`/`⌘ K`), with one list component behind every list screen.
Staff reach the website from the ERP's top bar through a single-use link.

### Console

Tenants, business slots and plans, web addresses, the per-business feature grid, support sessions
and Kelinto's own brand.

### Supplier portal and kiosk

A supplier's login belongs to **one** business and lives at that business's website. Invite only;
suppliers sign their agreements once, then quote on purchase orders.

The kiosk has three doors: **Repair** (opens a partial ticket for the counter to finish), **Sell your
phone** (a buyback for staff to price) and **Buy parts** (signs the customer into the website with
pay-at-the-counter checkout).

---

## Quick start

```bash
npm install                 # root + both workspaces
cp .env.example .env        # fill in MONGODB_URI (with its database path) and JWT_SECRET
npm run seed                # WIPES and rebuilds whatever MONGODB_URI names
npm run seed:superadmin     # the console's super admin
npm run seed:demo           # additive demo data: tickets, quotes, suppliers, content
npm run dev                 # client on :5173, API on :4000
```

The Vite dev server proxies `/api` to `:4000`, so the app is same-origin in development and the
httpOnly session cookie travels without CORS credential handling.

### Demo accounts

Every password is `Cellvix123!`. All of it is dummy data.

| Who | Email | Signs in at |
|---|---|---|
| Super admin | `super@kelinto.com` (`super@cellvix.ca` on older installs) | Console |
| Tenant owner | `admin@cellvix.ca` | ERP |
| Staff | `priya@cellvix.ca`, `marcus@cellvix.ca`, `dana@cellvix.ca`, `nadia@cellshoppe.ca`, `eli@cellshoppe.ca`, `jun@cellshoppe.ca` | ERP |
| Customer, approved | `buyer@cellvix.ca` (Net 30), `amrit@westcoastscreen.ca` (Net 15) | Website |
| Customer, pending | `pending@cellvix.ca` | Website |
| Supplier | `orders@northbridgeparts.example`, `signup@harbourpoint.example` (nothing signed yet) | Supplier portal |
| Kiosk | PIN `1234` (enable it in ERP › Settings first) | Kiosk |

The full list, with what each account is for, is in [CLAUDE.md](CLAUDE.md).

---

## How it works

### The request pipeline

```
resolveBusiness ─▶ openBusinessDb ─▶ authenticate ─▶ route
(host, header or     (a handle onto     (User lives in the
 ?business=)          the same pool)     business database)
```

The order is load-bearing: a session cannot be read out of a database nobody has opened yet. A
request that resolves no business is refused with **503 `BUSINESS_UNRESOLVED`** rather than served
an empty catalogue with a 200. Exactly one business carries `isDefault` and serves any host that
names none; the server **refuses to start** without one. `/superadmin/*` and `/health` are exempt.

### From cart to invoice

```
add to cart ─▶ checkout quote ─▶ place order ─▶ invoice ─▶ email
     │              │                  │            │
   SKU + qty     server prices     server prices   generated from
   only          the whole cart    it again        the order
```

The client never sends a price or a discount, only SKUs and quantities. Money is stored in **integer
cents**. Three services each own one rule outright:

- **`productService.effectivePrice`** is the only place a unit price is decided (a clearance part
  sells at its clearance price everywhere).
- **`pricingService.js`** is the only place a discount is decided. Offers never stack, one offer per
  product, a promo code never reaches inside a combo bundle.
- **`storeCreditService.js`** is the only place a store-credit balance moves, always with a
  `CreditTransaction` behind it.

The **line of credit** (what the business lends a customer) and **store credit** (what the customer
already holds) are kept apart; only store credit spends itself at checkout.

### Documents are sent by a business

Every invoice and email names the business that sent it, through `services/sendingBusiness.js`. The
envelope sender is one SMTP account for the installation; who a message is *from* is per business.

### Files

Uploads live in Cloudflare R2, under their owner: `businesses/<code>/<kind>/` or `kelinto/<kind>/`.
Records store the **key**, never the URL; the server adds `R2_PUBLIC_URL` on the way out. Every file
is optimised once, on upload (WebP for pictures, H.264 MP4 for video). Personal files, such as a
kiosk seller's photo, go to a second bucket with public access off.

### Payments

The gateway is a **mock** (`payment.js`, the only gateway-aware file). It succeeds unless asked not
to: a delivery note starting `DECLINE`, or `MOCK_PAYMENT_DECLINE=true`, routes checkout to
`/payment-failed`.

---

## Repo layout

```
client/           React app (Vite)
  src/
    components/   ui/ primitives, website pieces, admin/ (the ERP shell and
                  list kit), superadmin/ (the console)
    pages/        one file per route; account/, admin/, superadmin/, supplier/
    store/        Zustand: filterStore, cartStore, uiStore
    hooks/        data fetching (TanStack Query) and DOM behaviour
    lib/          api client, formatters, rich-text renderer, media sizes
server/           Express API
  src/
    routes/       every route names its middleware
    controllers/  request and response only, no Mongoose
    services/     all business logic and queries
    models/       Mongoose schemas
    db/           connections.js: the control database and one handle per business
    seed/         seeds, backfills, migrations and one-off moves
shared/           Zod schemas, catalogue data and host rules, imported by BOTH sides
scripts/          smoke, a11y and screenshot runners
docs/             the rules, the plans, the progress board, deployment notes
```

`shared/schemas/*.js` holds the Zod schema the client form validates against **and** the server
route validates against, so the two cannot disagree.

---

## Environment

One `.env` at the repo root serves both workspaces. `server/src/config/env.js` validates it with Zod
and **exits at boot** with a named error if anything is missing or malformed.
[.env.example](.env.example) is the reference: a development block that works as-is once
`MONGODB_URI` is filled in, and a commented production block for the VPS.

| Variable | Required | Notes |
|---|---|---|
| `MONGODB_URI` | **yes** | Its path names the **control** database (`.../kelinto_control`). Without a path, the control plane lands in `test`. |
| `JWT_SECRET` | **yes** | At least 16 characters. Changing it signs everyone out. |
| `DB_PREFIX` | no | Defaults to `kelinto`. Business databases are `<prefix>_biz_<code>`. **Pinned on a live install.** |
| `COOKIE_NAME` | no | Defaults to `kelinto_session`. **Pinned on a live install.** |
| `SECRETS_KEY` | no | Encrypts provider credentials at rest. Empty derives one from `JWT_SECRET`. |
| `CLIENT_ORIGIN` | no | Comma-separated origins allowed to send credentialed requests. |
| `CORS_WILDCARD_ORIGINS` | no | `https://*.kelinto.com`: one subdomain label, so a new business needs no env edit. |
| `PANEL_HOST` / `SUPERADMIN_HOST` | no | The ERP and console hosts. Empty keeps every route on one host. |
| `ORIGIN_IPV4` | no | The VPS's IPv4. The console tells a business to point its own domain here with an A record. |
| `PUBLIC_ORIGIN` | no | Where email links point with no business in context. |
| `SMTP_URL` | no | Empty: every message is logged as not sent. |
| `MAIL_FROM` / `MAIL_FROM_ADMIN` / `MAIL_FROM_PLATFORM` | no | Envelope senders. **Pinned on a live install.** |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL` | no | All empty: uploads are off and everything shows its placeholder. |
| `R2_PRIVATE_BUCKET` | no | Bucket with public access off. Empty: the kiosk refuses a phone sale rather than store a face publicly. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `WHATSAPP_TOKEN` | no | Messaging providers. |
| `FFMPEG_PATH` | no | A system ffmpeg, if the bundled one will not run. |
| `MOCK_PAYMENT_DECLINE` | no | Forces the mock gateway to decline. Must stay `false` in production. |
| `VITE_API_URL` | no | Defaults to `/api`. Read at build time. |

`.env` is gitignored. Only `.env.example` is tracked.

---

## Scripts

```bash
npm run dev               # client + server together
npm run build             # production client bundle; the cheap default check
npm start                 # the API, which also serves the built client in production

npm run seed              # WIPES every business database and rebuilds the one CellShoppe business
npm run seed:superadmin   # the console's super admin; finds an existing one, never makes a second
npm run seed:demo         # the additive demo seeds in order
                          #   -- <name> [args]   one step   ·   -- --list   name them
npm run seed:articles     # per-product SEO articles; additive
npm run seed:reviews      # reviews AND the delivered orders behind them; moves revenue

npm run migrate           # outstanding schema migrations, every database (--dry-run first)
npm run backfill          # one-off data fixes; no args lists them, -- <name> runs one
npm run purge:business -- '#000002' [--dry-run]   # delete a soft-deleted business for good
npm run move:kelinto      # the 2026-10-06 cellvix -> kelinto database move (done on the VPS)

npm run smoke             # 208 end-to-end API assertions; cleans up after itself
npm run smoke:clean       # clear smoke leftovers by hand (--dry-run to look first)
npm run a11y              # WCAG 2.1 AA audit across 39 surfaces
npm run shoot             # Playwright screenshots -> docs/screenshots/
```

> `seed`, `smoke`, `a11y` and `shoot` all **write real data**. `seed` drops every business
> database; `shoot` places a real order, moving stock, invoices and credit. Run them only against a
> database of dummy data, and never as a routine check after a change: `npm run build` is that.

---

## Deployment

Kelinto runs on a **Hostinger VPS** under Passenger, behind Caddy, against MongoDB Atlas.
[docs/SUBDOMAIN_SETUP.md](docs/SUBDOMAIN_SETUP.md) covers DNS, certificates and custom domains;
[docs/Caddyfile](docs/Caddyfile) is the web server config.

```bash
npm install
npm run build
NODE_ENV=production npm start
```

In production the API serves the built client, so the whole site is one origin and one process.

**Pinned on the VPS, never "fixed" to the defaults:** `DB_PREFIX`, the database path in
`MONGODB_URI`, `COOKIE_NAME`, `MAIL_FROM` and `MAIL_FROM_ADMIN`. Changing the first two opens empty
databases beside the full ones; changing the cookie name signs everyone out at once.

**Every change states its deploy step.** A new env var, a migration, a DNS record or a restart beyond
the usual is named in the write-up, because a correct change whose env var was never set on the VPS
does not work.

---

## Security posture

- **The price gate is server-side**, in the catalogue and in a combo offer's bundle price.
- **Availability leaves as a boolean.** The website says in stock or out of stock, never a count or
  a shipment date.
- **Sessions are httpOnly JWT cookies**, each with a `sid` that sign-out revokes server-side. Each
  sign-in door admits only its own kind of account, and a wrong-kind account fails exactly like a
  wrong password.
- **Query values can never become Mongo operators.** `app.js` uses the `simple` query parser and
  every equality is coerced with `String()`.
- **Every mutating route validates through a shared Zod schema** in `shared/schemas/`.
- **Uploads are sniffed from their bytes**, SVG is refused, and a record accepts only its owner's
  own R2 URL, never a hotlink.
- **No `dangerouslySetInnerHTML` anywhere.** Admin-authored copy renders through
  `client/src/lib/richText.jsx`.
- Rate limiting on credential endpoints and public forms, Helmet, provider secrets encrypted at rest,
  payment methods stored as brand plus last four only.

---

## Conventions

- Canadian throughout: CAD, provinces, `A1A 1A1` postal codes, GST/HST.
- In anything a person reads: **website** (not "storefront"), **ERP** (not "panel"), **Kelinto**
  (not "the platform"), and customers are **customers**, never "shops".
- No em dashes anywhere in the project, and a short list of banned words (Instructions §10).
- The brand gradient is the brand: three ramps picked by surface, never a page or card background.
- Every mutation confirms; deletes, payments and anything sent to a third party confirm twice.
- Responsive is a requirement: 320, 768, 1024 and 1440 widths are each designed.

The full rules are in [docs/PROJECT_INSTRUCTIONS.md](docs/PROJECT_INSTRUCTIONS.md).

---

## Project documentation

| File | What it is |
|---|---|
| [CLAUDE.md](CLAUDE.md) | Session primer: the non-negotiables, deployment, every demo account. Stays at the root so it auto-loads. |
| [PROJECT_INSTRUCTIONS.md](docs/PROJECT_INSTRUCTIONS.md) | The rules: design tokens, filter architecture, data model, API contract, definition of done. Binding. |
| [SAAS_PLATFORM.md](docs/SAAS_PLATFORM.md) | The multi-tenant model: super admin, per-business databases, feature flags. Binding for tenancy work. |
| [ADMIN_ERP_REWORK.md](docs/ADMIN_ERP_REWORK.md) | The ERP spec. Binding for any `/admin` work. |
| [PROGRESS.md](docs/PROGRESS.md) | What is built, what is next, decisions, open questions. |
| [SESSION_ARCHIVE.md](docs/SESSION_ARCHIVE.md) | Past session write-ups. History, read only to trace a decision. |
| [SUBDOMAIN_SETUP.md](docs/SUBDOMAIN_SETUP.md) | DNS, certificates, custom domains, Caddy. |
| [cellvix-project-brief.md](docs/cellvix-project-brief.md) | The client's original brief. Read-only reference. |
