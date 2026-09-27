import { BUSINESS_INFO } from '../../../shared/business.js';
import { formatDate } from '../../../shared/dates.js';
import { paletteFor, migrateColorToken } from '../../../shared/businessPalette.js';
import { db, controlModels } from '../db/models.js';
import storage from './storageService.js';

/**
 * The invoice document.
 *
 * One renderer, two consumers: the copy emailed to the buyer when the order is
 * placed, and `GET /api/invoices/:number/document`, which the dashboard's PDF
 * button opens for print-to-PDF. Both have to be the same piece of paper, so
 * neither builds its own markup.
 *
 * Styling is INLINE on purpose. Mail clients strip <style> blocks with no
 * warning, and an invoice that arrives as unstyled text is not an invoice. The
 * <style> block that is here carries print rules only - nothing the layout
 * depends on.
 */

const CAD = new Intl.NumberFormat('en-CA', {
  style: 'currency',
  currency: 'CAD',
  currencyDisplay: 'narrowSymbol',
});

const money = (cents) => CAD.format((cents ?? 0) / 100);
const day = (value) => formatDate(value);

const TERMS_COPY = {
  prepaid: 'Paid at checkout. No credit is extended on this account.',
  net15: 'Payment is due 15 days from the issue date.',
  net30: 'Payment is due 30 days from the issue date.',
  net60: 'Payment is due 60 days from the issue date.',
};

/** Everything interpolated below is account-authored, so it all escapes. */
function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Spelled-out country names for the non-domestic case. A two-letter code on a
 * printed address reads as a database field; the name reads as an address.
 */
const COUNTRY_NAMES = {
  US: 'United States',
  GB: 'United Kingdom',
  AU: 'Australia',
  NZ: 'New Zealand',
  IE: 'Ireland',
  DE: 'Germany',
  FR: 'France',
  MX: 'Mexico',
};

const INK = '#111113';
const MUTED = '#6b6b73';
const LINE = '#e4e4e8';
/** Neutral slate. Only used when a caller did not resolve the real business. */
const BRAND_FALLBACK = '#41566e';

/**
 * The document's type scale.
 *
 * Inline styles cannot inherit from the app's design tokens, so the sizes here
 * were being written per element and had drifted to nine of them - 9.5, 10, 11,
 * 12, 12.5, 13, 13.5, 17, 25, 30 - several within half a pixel of each other.
 * The same drift the app carried, for the same reason: no named scale to reach
 * for.
 *
 * Six steps, mirroring the client's, and the invoice's hierarchy is built from
 * these rather than from arbitrary numbers.
 */
const T = {
  micro: '10px', // column headers, the SKU under a line
  small: '11px', // section eyebrows, meta
  body: '12px', // supporting copy, addresses
  item: '13px', // A LINE ITEM. See below.
  lead: '15px', // the totals rows
  figure: '26px', // the amount due, and INVOICE
};

function addressBlock(title, address) {
  if (!address) return '';
  const rows = [
    address.contactName,
    address.company,
    address.line1,
    address.line2,
    [address.city, address.region].filter(Boolean).join(', ') +
      (address.postal ? ` ${address.postal}` : ''),
    // Canada is not printed on a Canadian invoice. Every address in the system
    // is domestic by default, so "CA" on its own line was a stray country code
    // under every address - it reads as a data field that leaked onto the page
    // rather than as part of an address. A genuinely foreign address still
    // prints its country, spelled out, because there it is information.
    address.country && String(address.country).toUpperCase() !== 'CA'
      ? COUNTRY_NAMES[String(address.country).toUpperCase()] ?? address.country
      : null,
    address.phone,
  ]
    .filter((line) => line && String(line).trim())
    .map(
      (line) =>
        `<div style="font-size:${T.body};line-height:1.65;color:${MUTED};">${escapeHtml(line)}</div>`,
    )
    .join('');

  return `
    <td style="vertical-align:top;padding:22px 24px;width:50%;">
      <div style="font-size:${T.small};font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${INK};margin-bottom:10px;">${escapeHtml(title)}</div>
      ${rows}
    </td>`;
}

function itemRows(order) {
  return (order?.items ?? [])
    .map(
      (item, index) => `
        <tr>
          <td style="padding:13px 10px;border-bottom:1px solid ${LINE};font-size:${T.body};color:${MUTED};vertical-align:top;">${index + 1}.</td>
          <td style="padding:13px 10px;border-bottom:1px solid ${LINE};font-size:${T.item};color:${INK};vertical-align:top;">
            <div style="font-weight:600;">${escapeHtml(item.name)}</div>
            <div style="font-size:${T.micro};color:${MUTED};margin-top:3px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">
              ${escapeHtml(item.sku ?? '')}${item.grade ? ` · ${escapeHtml(item.grade)}` : ''}
            </div>
          </td>
          <td style="padding:13px 10px;border-bottom:1px solid ${LINE};font-size:${T.item};color:${INK};text-align:right;vertical-align:top;white-space:nowrap;">${money(item.unitPrice)}</td>
          <td style="padding:13px 10px;border-bottom:1px solid ${LINE};font-size:${T.item};color:${INK};text-align:right;vertical-align:top;">${item.qty}</td>
          <td style="padding:13px 10px;border-bottom:1px solid ${LINE};font-size:${T.item};color:${INK};text-align:right;vertical-align:top;white-space:nowrap;font-weight:700;">${money(item.lineTotal)}</td>
        </tr>`,
    )
    .join('');
}

/**
 * The rows for an itemised (repair) invoice.
 *
 * Grouped by device, because that is how the customer reads it: "what did you
 * do to my phone, and what did each thing cost". A flat list of eight lines
 * across two devices makes them work out which belonged to which.
 *
 * The device header spans the table rather than sitting in the description
 * column, so a device with one service still reads as a heading over a line
 * rather than as two lines of similar text.
 */
function deviceRows(devices = []) {
  let counter = 0;

  return devices
    .map((device) => {
      const lines = [...(device.services ?? []), ...(device.parts ?? [])];
      if (lines.length === 0) return '';

      const title = [device.brand, device.series, device.model].filter(Boolean).join(' ');
      const subtitle = [
        device.serial ? `Serial ${device.serial}` : '',
        device.problem ?? '',
      ]
        .filter(Boolean)
        .join(' · ');

      const header = `
        <tr>
          <td colspan="5" style="padding:14px 10px 6px;border-bottom:1px solid ${LINE};background:#fafafb;">
            <div style="font-size:${T.item};font-weight:700;color:${INK};">${escapeHtml(title || 'Device')}</div>
            ${subtitle ? `<div style="font-size:${T.micro};color:${MUTED};margin-top:2px;">${escapeHtml(subtitle)}</div>` : ''}
          </td>
        </tr>`;

      const rows = lines
        .map((line) => {
          counter += 1;
          const qty = line.qty ?? 1;
          const lineTotal = (line.priceCents ?? 0) * qty;

          return `
        <tr>
          <td style="padding:11px 10px;border-bottom:1px solid ${LINE};font-size:${T.body};color:${MUTED};vertical-align:top;">${counter}.</td>
          <td style="padding:11px 10px;border-bottom:1px solid ${LINE};font-size:${T.item};color:${INK};vertical-align:top;">
            <div style="font-weight:600;">${escapeHtml(line.name)}</div>
            ${line.description ? `<div style="font-size:${T.micro};color:${MUTED};margin-top:3px;">${escapeHtml(line.description)}</div>` : ''}
          </td>
          <td style="padding:11px 10px;border-bottom:1px solid ${LINE};font-size:${T.item};color:${INK};text-align:right;vertical-align:top;white-space:nowrap;">${money(line.priceCents)}</td>
          <td style="padding:11px 10px;border-bottom:1px solid ${LINE};font-size:${T.item};color:${INK};text-align:right;vertical-align:top;">${qty}</td>
          <td style="padding:11px 10px;border-bottom:1px solid ${LINE};font-size:${T.item};color:${INK};text-align:right;vertical-align:top;white-space:nowrap;font-weight:700;">${money(lineTotal)}</td>
        </tr>`;
        })
        .join('');

      return header + rows;
    })
    .join('');
}

function totalsRow(label, value, { strong = false, tone } = {}) {
  return `
    <tr>
      <td style="padding:6px 0;font-size:${T.body};letter-spacing:.04em;text-transform:uppercase;color:${strong ? INK : MUTED};font-weight:${strong ? 700 : 500};">${escapeHtml(label)}</td>
      <td style="padding:6px 0 6px 28px;font-size:${strong ? T.lead : T.body};text-align:right;white-space:nowrap;color:${tone ?? (strong ? INK : MUTED)};font-weight:${strong ? 700 : 600};">${escapeHtml(value)}</td>
    </tr>`;
}

/**
 * @param {object}  args
 * @param {object}  args.invoice  Invoice document (lean or hydrated)
 * @param {object}  args.order    The order it bills, if there is one
 * @param {object}  args.user     The buyer
 * @param {string}  [args.origin] Public site origin, for the "view online" link
 * @param {string}  [args.nonce]  CSP nonce. Present only for the browser copy
 *                                without one the print button is not rendered,
 *                                which is exactly what the emailed copy wants.
 */
/**
 * The shop an invoice belongs to, and the colour it prints in.
 *
 * One helper so the three callers - the admin PDF route, the buyer own copy
 * and the email sent on order - cannot drift into branding the same document
 * three different ways. `Business` is control-plane, hence `controlModels()`.
 *
 * Falls back to the static constant when the invoice names no business, which
 * is every record written before businesses existed.
 */
async function resolveInvoiceBrand(businessId) {
  if (!businessId) return { shop: null, brandColor: null };

  const business = await controlModels()
    .Business.findById(businessId)
    .select('name colorToken isDefault')
    .lean();
  if (!business) return { shop: null, brandColor: null };

  const settings = await db().Settings.load();
  const info = settings?.business ?? {};

  return {
    // The business RECORD names the shop. `Settings.business.name` defaults to
    // "Cellvix" and a business nobody has filled it in for still carries that,
    // so preferring settings prints the wrong company - the same trap the
    // ticket document documents.
    shop: { ...info, name: business.name || info.name },
    brandColor: paletteFor(migrateColorToken(business.colorToken)).base,
    /**
     * Whether the bundled logo belongs to this business.
     *
     * `client/public/brand/logo.png` is one file for the whole install, and it
     * is the default business's mark. That one keeps it; every other business
     * gets the typeset wordmark built from its own name and colour, which is a
     * better answer than somebody else's logo.
     */
    isHouse: business.isDefault === true,
    // The business's own uploaded logo, embedded (see `storageService.dataUriOf`).
    logo: await storage.dataUriOf(info.logoUrl),
  };
}

function renderInvoiceHtml({ invoice, order, user, origin, nonce, shop, brandColor, logo = null }) {
  const balance = (invoice.amount ?? 0) - (invoice.amountPaid ?? 0);
  const settled = balance <= 0;

  /**
   * The business whose name and colour go on this document.
   *
   * **This used to be the static Cellvix constant on every invoice**, so a
   * CellShoppe customer was handed a document in the wholesaler's brand with
   * the wholesaler's phone number to ring. The caller resolves the real one now
   * and passes it; the constant is the fallback for an invoice that names no
   * business, which is every record written before businesses existed.
   */
  const business = shop ?? BUSINESS_INFO;
  const BRAND = brandColor ?? BRAND_FALLBACK;

  /**
   * The strapline, unless it is still the schema default.
   *
   * `Settings.business.tagline` defaults to the wholesale line,
   * so a repair shop that has not written its own would print the wholesaler
   * description under its own name. Blank is the honest answer - the same rule
   * the ticket document applies to the default phone number.
   */
  const tagline = business.tagline === 'Wholesale phone and laptop parts' ? '' : (business.tagline ?? '');

  // What this document calls itself. A tax invoice is issued only against money
  // that arrived; before that the same row is an amount due, and a receipt for
  // a store-credit movement is neither. Calling all three "invoice" is what the
  // `kind` field on the model exists to stop.
  const kind = invoice.kind ?? 'invoice';
  const docLabel =
    kind === 'receipt' ? 'Receipt' : kind === 'due' ? 'Statement of amount due' : 'Invoice';
  const numberLabel = kind === 'receipt' ? 'Receipt no.' : kind === 'due' ? 'Reference' : 'Invoice no.';

  const payments = (invoice.payments ?? [])
    .map(
      (payment) => `
        <div style="font-size:${T.body};line-height:1.7;color:${MUTED};">
          ${escapeHtml(day(payment.at))} · ${escapeHtml(payment.method ?? 'payment')} · ${money(payment.amount)}
        </div>`,
    )
    .join('');

  const discountRows = [
    order?.bundleDiscount > 0 ? totalsRow('Combo savings', `−${money(order.bundleDiscount)}`) : '',
    order?.promoDiscount > 0
      ? totalsRow(
          order?.promo?.code ? `Promo ${order.promo.code}` : 'Promotion',
          `−${money(order.promoDiscount)}`,
        )
      : '',
  ].join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(docLabel)} ${escapeHtml(invoice.number)} · ${escapeHtml(business.name)}</title>
<style>
  @media print {
    body { background: #fff !important; padding: 0 !important; }
    .sheet { box-shadow: none !important; margin: 0 !important; }
    .no-print { display: none !important; }
  }
</style>
</head>
<body style="margin:0;padding:24px 12px;background:#f4f4f6;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">

${
  nonce
    ? `<div class="no-print" style="max-width:760px;margin:0 auto 14px;text-align:right;">
  <button type="button" id="print-invoice" style="cursor:pointer;border:0;border-radius:10px;padding:9px 16px;font-size:${T.item};font-weight:600;color:#fff;background:${BRAND};">
    Print / save as PDF
  </button>
</div>
<script nonce="${escapeHtml(nonce)}">
  document.getElementById('print-invoice').addEventListener('click', function () { window.print(); });
</script>`
    : ''
}

<table role="presentation" class="sheet" cellpadding="0" cellspacing="0" style="max-width:760px;width:100%;margin:0 auto;background:#fff;border-collapse:collapse;box-shadow:0 1px 3px rgba(0,0,0,.08);">
  <tr>
    <td style="padding:34px 34px 0;">

      <!-- ---- masthead ------------------------------------------------- -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="vertical-align:top;">
            ${
              /**
               * The business's OWN logo, uploaded in Settings and embedded as a
               * data URI, or its name set in type. Never a bundled file: one
               * file for the whole install was one business's mark printed on
               * every other business's paperwork.
               */
              logo
                ? `<img src="${logo}" alt="${escapeHtml(business.name)}" width="190" height="48"
                     style="display:block;width:190px;height:auto;border:0;" />`
                : `<table role="presentation" cellpadding="0" cellspacing="0">
              <tr>
                <td style="width:34px;height:34px;background:${INK};border-radius:6px;"></td>
                <td style="padding-left:11px;vertical-align:middle;">
                  <div style="font-size:${T.figure};font-weight:800;letter-spacing:-.01em;color:${INK};">${escapeHtml(business.name.toUpperCase())}</div>
                  <div style="font-size:${T.micro};letter-spacing:.16em;text-transform:uppercase;color:${MUTED};margin-top:2px;">${escapeHtml(tagline)}</div>
                </td>
              </tr>
            </table>`
            }
          </td>
          <td style="vertical-align:top;text-align:right;">
            <div style="font-size:${T.figure};font-weight:800;letter-spacing:-.01em;color:${INK};line-height:1;">INVOICE</div>
            <div style="font-size:${T.small};letter-spacing:.06em;text-transform:uppercase;color:${MUTED};margin-top:8px;">Issued ${escapeHtml(day(invoice.issuedAt))}</div>
          </td>
        </tr>
      </table>

      <!-- ---- parties -------------------------------------------------- -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:26px;background:#f7f7f9;border-radius:8px;">
        <tr>
          ${addressBlock('Invoice to', order?.billingAddress ?? { contactName: user?.contactName, company: user?.businessName })}
          ${addressBlock('Ship to', order?.shippingAddress ?? null)}
        </tr>
      </table>

      <!-- ---- meta ----------------------------------------------------- -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:22px;">
        <tr>
          <td style="font-size:${T.small};letter-spacing:.06em;text-transform:uppercase;color:${MUTED};">
            Due ${escapeHtml(day(invoice.dueDate))}${order?.poNumber ? ` &nbsp;·&nbsp; PO ${escapeHtml(order.poNumber)}` : ''}
          </td>
          <td style="text-align:right;font-size:${T.small};letter-spacing:.06em;text-transform:uppercase;color:${INK};font-weight:700;">
            ${escapeHtml(numberLabel)} ${escapeHtml(invoice.number)}${order?.orderNumber ? ` &nbsp;·&nbsp; Order ${escapeHtml(order.orderNumber)}` : ''}
          </td>
        </tr>
      </table>

      <!-- ---- lines ---------------------------------------------------- -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;border-collapse:collapse;">
        <thead>
          <tr>
            <th style="text-align:left;padding:9px 10px;border-top:1px solid ${LINE};border-bottom:1px solid ${LINE};font-size:${T.micro};letter-spacing:.08em;text-transform:uppercase;color:${MUTED};width:34px;">No</th>
            <th style="text-align:left;padding:9px 10px;border-top:1px solid ${LINE};border-bottom:1px solid ${LINE};font-size:${T.micro};letter-spacing:.08em;text-transform:uppercase;color:${MUTED};">Item description</th>
            <th style="text-align:right;padding:9px 10px;border-top:1px solid ${LINE};border-bottom:1px solid ${LINE};font-size:${T.micro};letter-spacing:.08em;text-transform:uppercase;color:${MUTED};">Price</th>
            <th style="text-align:right;padding:9px 10px;border-top:1px solid ${LINE};border-bottom:1px solid ${LINE};font-size:${T.micro};letter-spacing:.08em;text-transform:uppercase;color:${MUTED};">Qty</th>
            <th style="text-align:right;padding:9px 10px;border-top:1px solid ${LINE};border-bottom:1px solid ${LINE};font-size:${T.micro};letter-spacing:.08em;text-transform:uppercase;color:${MUTED};">Total</th>
          </tr>
        </thead>
        <tbody>
          ${
            itemRows(order) ||
            deviceRows(invoice.devices) ||
            `<tr><td colspan="5" style="padding:16px 10px;border-bottom:1px solid ${LINE};font-size:${T.item};color:${MUTED};">${escapeHtml(invoice.reference || `Account charge - ${invoice.number}`)}</td></tr>`
          }
        </tbody>
      </table>

      <!-- ---- totals --------------------------------------------------- -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;">
        <tr>
          <td style="vertical-align:top;width:47%;">
            <div style="font-size:${T.small};font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${MUTED};">${settled ? 'Paid in full' : 'Total due'}</div>
            ${/*
                The figure is INK, not brand, even when there is money outstanding.

                Three red things were stacked here - this number, the "Balance
                due" row beside it, and the Pay button below it - and a reader
                cannot tell which of three identical signals is the one to act
                on. The number's job is to be READ, and it is already the largest
                thing in this half of the page; size is what makes it findable,
                not colour.

                Red is left to the button, which is the one thing here that is
                actually clicked, and to the balance-due row, which is the line an
                overdue account is scanning for. That keeps the accent doing one
                job apiece instead of three at once.
              */''}
            <div style="margin-top:10px;">
              <span style="font-size:${T.figure};font-weight:800;color:${INK};letter-spacing:-.02em;">${money(settled ? invoice.amount : balance)}</span>
            </div>
            ${
              // Pay from the document itself - the shortest path from "I am
              // looking at what I owe" to having paid it.
              //
              // A LINK, never a form. This page is served under its own
              // Content-Security-Policy carrying `form-action 'none'`
              // (`controllers/accountController.js`), so a posting button here
              // would be silently dead. It carries `?pay=1`, which the invoices
              // screen reads to open the payment sheet on arrival.
              //
              // `.no-print` because a printed sheet with a button on it is a
              // button nobody can press.
              !settled && origin
                ? `<div class="no-print" style="margin-top:12px;">
              <a href="${escapeHtml(origin)}/account/invoices?pay=${encodeURIComponent(invoice.number)}"
                 style="display:inline-block;padding:11px 20px;border-radius:10px;background:${BRAND};color:#fff;font-size:${T.item};font-weight:700;text-decoration:none;">
                Pay ${money(balance)} now
              </a>
              <div style="margin-top:8px;font-size:${T.small};line-height:1.6;color:${MUTED};">
                Pay by card or with your store credit.
              </div>
            </div>`
                : ''
            }
          </td>
          <td style="vertical-align:top;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${/*
                An order supplies its own subtotal, shipping and tax. A
                standalone invoice has none of those - so an itemised one
                supplies its OWN, and a flat charge shows a subtotal equal to
                the total and no tax line, which is exactly what it is.
              */''}
              ${totalsRow('Subtotal', money(order?.subtotal ?? invoice.subtotalCents ?? invoice.amount))}
              ${discountRows}
              ${
                !order && invoice.discountCents > 0
                  ? totalsRow('Discount', `−${money(invoice.discountCents)}`)
                  : ''
              }
              ${order?.shipping !== undefined ? totalsRow('Shipping', money(order.shipping)) : ''}
              ${
                order?.tax !== undefined
                  ? totalsRow('GST/HST', money(order.tax))
                  : invoice.taxCents > 0
                    ? totalsRow(
                        `GST/HST${invoice.taxPercent ? ` (${invoice.taxPercent}%)` : ''}`,
                        money(invoice.taxCents),
                      )
                    : ''
              }
              ${totalsRow('Grand total', money(invoice.amount), { strong: true })}
              ${invoice.amountPaid > 0 ? totalsRow('Paid', `−${money(invoice.amountPaid)}`) : ''}
              ${totalsRow('Balance due', money(Math.max(0, balance)), { strong: true, tone: balance > 0 ? BRAND : INK })}
              ${
                /**
                 * The tip sits AFTER the balance due, outside the sum.
                 *
                 * Every row above it is a step in one calculation that arrives
                 * at what the customer owes. A tip is not a step in it: it was
                 * never owed, it carries no tax, and placing it among the
                 * subtotal and tax rows would invite the reader to add it in
                 * and make the grand total wrong. Below the line it reads as
                 * what it is - money given on top, already received.
                 *
                 * Printed only when there is one. A "Tip $0.00" row on every
                 * wholesale invoice is a line that teaches people to stop
                 * reading the totals block.
                 */
                invoice.tipCents > 0
                  ? totalsRow('Tip (not part of the total)', money(invoice.tipCents))
                  : ''
              }
            </table>
          </td>
        </tr>
      </table>

      <!-- ---- terms ---------------------------------------------------- -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:30px;border-top:1px solid ${LINE};">
        <tr>
          <td style="vertical-align:top;width:50%;padding:20px 20px 0 0;">
            <div style="font-size:${T.small};font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${INK};margin-bottom:8px;">Payment</div>
            <div style="font-size:${T.body};line-height:1.7;color:${MUTED};">Terms: ${escapeHtml((invoice.terms ?? 'prepaid').replace('net', 'Net '))}</div>
            <div style="font-size:${T.body};line-height:1.7;color:${MUTED};">Remit to: ${escapeHtml(business.billingEmail ?? business.email)}</div>
            ${business.gstNumber ? `<div style="font-size:${T.body};line-height:1.7;color:${MUTED};">GST/HST no. ${escapeHtml(business.gstNumber)}</div>` : ''}
            ${payments}
          </td>
          <td style="vertical-align:top;width:50%;padding:20px 0 0 20px;">
            <div style="font-size:${T.small};font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${INK};margin-bottom:8px;">Terms &amp; conditions</div>
            <div style="font-size:${T.body};line-height:1.7;color:${MUTED};">
              ${escapeHtml(TERMS_COPY[invoice.terms] ?? TERMS_COPY.prepaid)}
              All amounts are in Canadian dollars. Parts are covered by the warranty stated on the
              product page at the time of purchase.
            </div>
          </td>
        </tr>
      </table>

      <!-- ---- footer --------------------------------------------------- -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px;border-top:1px solid ${LINE};">
        <tr>
          <td style="padding:16px 0 30px;font-size:${T.small};line-height:1.7;color:${MUTED};">
            Questions? Email <a href="mailto:${escapeHtml(business.email)}" style="color:${BRAND};text-decoration:none;">${escapeHtml(business.email)}</a>
            or call ${escapeHtml(business.phone)}.<br />
            ${escapeHtml(business.address.line1)}, ${escapeHtml(business.address.city)}, ${escapeHtml(business.address.region)} ${escapeHtml(business.address.postal)} · ${escapeHtml(business.domain)}
            ${
              origin && order?.orderNumber
                ? `<br /><a href="${escapeHtml(origin)}/account/orders/${escapeHtml(order.orderNumber)}" style="color:${BRAND};text-decoration:none;">View this order in your account</a>`
                : ''
            }
          </td>
        </tr>
      </table>

    </td>
  </tr>
</table>
</body>
</html>`;
}

/** Plain-text fallback, for the mail clients that refuse HTML. */
//  for the same reason the HTML copy takes it: a plain-text invoice
// naming the wrong company is no better than a styled one.
/**
 * The plain-text fallback, for mail clients that refuse HTML.
 *
 * Takes `shop` for the same reason the HTML copy does: an invoice naming the
 * wrong company is no better in plain text than it is styled.
 */
function renderInvoiceText({ invoice, order, origin, shop }) {
  const info = shop ?? BUSINESS_INFO;
  const balance = (invoice.amount ?? 0) - (invoice.amountPaid ?? 0);
  const kind = invoice.kind ?? 'invoice';
  const docLabel = kind === 'receipt' ? 'receipt' : kind === 'due' ? 'amount due' : 'invoice';

  const lines = [
    `${info.name} - ${docLabel} ${invoice.number}`,
    order?.orderNumber ? `Order ${order.orderNumber}` : null,
    `Issued ${day(invoice.issuedAt)} · due ${day(invoice.dueDate)}`,
    '',
    ...(order?.items ?? []).map(
      (item) => `${item.qty} × ${item.name} (${item.sku ?? ''}) - ${money(item.lineTotal)}`,
    ),
    '',
    `Total ${money(invoice.amount)}`,
    invoice.amountPaid > 0 ? `Paid ${money(invoice.amountPaid)}` : null,
    `Balance due ${money(Math.max(0, balance))}`,
    // After the balance, outside the sum, for the reason the HTML copy gives.
    invoice.tipCents > 0 ? `Tip (not part of the total) ${money(invoice.tipCents)}` : null,
    // The plain-text copy gets the same route to paying that the HTML one does.
    // A reader on a mail client that refuses HTML is exactly the reader who
    // needs the URL spelled out.
    balance > 0 && origin
      ? `\nPay online: ${origin}/account/invoices?pay=${encodeURIComponent(invoice.number)}`
      : null,
    '',
    `Questions? ${info.email} · ${info.phone}`,
  ];

  return lines.filter((line) => line !== null).join('\n');
}

export { renderInvoiceHtml, renderInvoiceText, resolveInvoiceBrand };
export default renderInvoiceHtml;
