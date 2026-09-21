import { BUSINESS_INFO } from '../../../shared/business.js';
import { displayNameOf } from '../utils/displayName.js';
import { formatDate } from '../../../shared/dates.js';

/**
 * The account statement.
 *
 * One page listing every invoice raised against an account and every payment
 * received, in date order, ending in what is still owed. It answers the
 * question a customer asks on the phone - "what do I owe you, and for what?"
 * which no single invoice can, because the answer spans all of them.
 *
 * **Deliberately not built on `invoiceDocument`.** That renderer describes one
 * transaction and is the artefact the customer already holds a copy of; this
 * describes a *relationship over time*. Sharing a template would mean every
 * change to an invoice's layout silently reshaping the statement, and the two
 * documents answer different questions. What they do share is the house style
 * below, so they look like they came from the same business.
 *
 * Styling is INLINE, for the same reason it is on the invoice: this is opened
 * for print-to-PDF and may be mailed, and mail clients strip `<style>` blocks
 * without warning.
 */

const CAD = new Intl.NumberFormat('en-CA', {
  style: 'currency',
  currency: 'CAD',
  currencyDisplay: 'narrowSymbol',
});

const money = (cents) => CAD.format((cents ?? 0) / 100);
const day = (value) => formatDate(value);

const INK = '#111113';
const MUTED = '#6b6b73';
const LINE = '#e4e4e8';
const BRAND = '#CF3429';
const OK = '#087443';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Every invoice and every payment, merged into one column of dated events.
 *
 * A statement that listed invoices and payments in two separate tables would
 * make the reader do the interleaving themselves to see how the balance got
 * where it is. Merged and sorted, the running balance beside each row *is* the
 * explanation.
 *
 * A reversal carries a negative amount and is already in `payments`, so it
 * appears as its own debit line and needs no special case - the running total
 * follows it for free.
 */
function buildRows(invoices) {
  const events = [];

  for (const invoice of invoices) {
    events.push({
      at: invoice.issuedAt ?? invoice.createdAt,
      kind: 'invoice',
      reference: invoice.number,
      detail: invoice.orderNumber ? `Order ${invoice.orderNumber}` : 'Invoice raised',
      // An invoice is money owed to the business: a debit against the account.
      charge: invoice.amount ?? 0,
      credit: 0,
    });

    for (const payment of invoice.payments ?? []) {
      const amount = payment.amount ?? 0;
      const reversal = amount < 0;
      events.push({
        at: payment.at,
        kind: reversal ? 'reversal' : 'payment',
        reference: invoice.number,
        detail: reversal
          ? 'Payment reversed'
          : `Payment received${payment.method ? ` · ${payment.method}` : ''}`,
        charge: reversal ? -amount : 0,
        credit: reversal ? 0 : amount,
      });
    }
  }

  events.sort((a, b) => new Date(a.at) - new Date(b.at));

  let running = 0;
  return events.map((event) => {
    running += event.charge - event.credit;
    return { ...event, balance: running };
  });
}

function rowHtml(row) {
  const toneColour = row.kind === 'payment' ? OK : row.kind === 'reversal' ? BRAND : INK;

  return `
    <tr>
      <td style="padding:9px 10px;border-bottom:1px solid ${LINE};font-size:12px;color:${MUTED};white-space:nowrap;">
        ${escapeHtml(day(row.at))}
      </td>
      <td style="padding:9px 10px;border-bottom:1px solid ${LINE};font-size:12px;color:${INK};">
        <strong style="font-weight:600;">${escapeHtml(row.reference)}</strong>
        <span style="display:block;color:${MUTED};font-size:11px;">${escapeHtml(row.detail)}</span>
      </td>
      <td style="padding:9px 10px;border-bottom:1px solid ${LINE};font-size:12px;color:${toneColour};text-align:right;white-space:nowrap;">
        ${row.charge ? money(row.charge) : ''}
      </td>
      <td style="padding:9px 10px;border-bottom:1px solid ${LINE};font-size:12px;color:${OK};text-align:right;white-space:nowrap;">
        ${row.credit ? money(row.credit) : ''}
      </td>
      <td style="padding:9px 10px;border-bottom:1px solid ${LINE};font-size:12px;color:${INK};text-align:right;white-space:nowrap;font-weight:600;">
        ${money(row.balance)}
      </td>
    </tr>`;
}

function summaryCard(label, value, { tone = INK, hint } = {}) {
  return `
    <td style="padding:0 6px;vertical-align:top;width:33.33%;">
      <div style="border:1px solid ${LINE};border-radius:10px;padding:12px 14px;">
        <div style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:${MUTED};font-weight:700;">
          ${escapeHtml(label)}
        </div>
        <div style="font-size:20px;font-weight:700;color:${tone};margin-top:6px;">${value}</div>
        ${hint ? `<div style="font-size:11px;color:${MUTED};margin-top:4px;">${escapeHtml(hint)}</div>` : ''}
      </div>
    </td>`;
}

/**
 * @param {{ user: object, invoices: object[], nonce?: string }} input
 * @returns {string} A complete HTML document, ready to print.
 */
export function renderStatementHtml({ user, invoices = [], nonce, business = BUSINESS_INFO }) {
  const rows = buildRows(invoices);

  const invoiced = invoices.reduce((sum, invoice) => sum + (invoice.amount ?? 0), 0);
  const paid = invoices.reduce(
    (sum, invoice) => sum + (invoice.payments ?? []).reduce((n, p) => n + (p.amount ?? 0), 0),
    0,
  );
  const outstanding = invoiced - paid;

  const name = displayNameOf(user);
  // The business arrives from the caller, which resolved it for this request. The
  // constant stays the default for a statement rendered with no business in
  // context - a script, or a record older than businesses.

  const body = rows.length
    ? rows.map(rowHtml).join('')
    : `<tr><td colspan="5" style="padding:24px 10px;text-align:center;font-size:12px;color:${MUTED};">
         Nothing has been invoiced to this account yet.
       </td></tr>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Account statement - ${escapeHtml(name)}</title>
<style>
  /* Print rules only. Nothing the layout depends on lives here - see the note
     at the top of this file. */
  @page { margin: 14mm; }
  @media print {
    .no-print { display: none !important; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body style="margin:0;padding:24px;background:#f7f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${INK};">
  <div style="max-width:760px;margin:0 auto;background:#ffffff;border:1px solid ${LINE};border-radius:14px;padding:28px;">

    <table role="presentation" width="100%" style="border-collapse:collapse;">
      <tr>
        <td style="vertical-align:top;">
          <div style="font-size:17px;font-weight:700;color:${BRAND};">${escapeHtml(business.name)}</div>
          <div style="font-size:11.5px;color:${MUTED};line-height:1.7;margin-top:2px;">
            ${escapeHtml(business.phone ?? '')}
          </div>
        </td>
        <td style="vertical-align:top;text-align:right;">
          <div style="font-size:22px;font-weight:700;letter-spacing:.04em;">ACCOUNT STATEMENT</div>
          <div style="font-size:11.5px;color:${MUTED};margin-top:4px;">Issued ${escapeHtml(day(new Date()))}</div>
        </td>
      </tr>
    </table>

    <hr style="border:0;border-top:2px solid ${BRAND};margin:18px 0;" />

    <table role="presentation" width="100%" style="border-collapse:collapse;">
      <tr>
        <td style="vertical-align:top;">
          <div style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:${MUTED};font-weight:700;">
            Statement for
          </div>
          <div style="font-size:15px;font-weight:700;margin-top:4px;">${escapeHtml(name)}</div>
          ${user?.businessName && user.businessName !== name ? `<div style="font-size:12px;color:${MUTED};">${escapeHtml(user.businessName)}</div>` : ''}
          <div style="font-size:12px;color:${MUTED};">${escapeHtml(user?.email ?? '')}</div>
          ${user?.phone ? `<div style="font-size:12px;color:${MUTED};">${escapeHtml(user.phone)}</div>` : ''}
        </td>
        <td style="vertical-align:top;text-align:right;">
          <div style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:${MUTED};font-weight:700;">
            Payment terms
          </div>
          <div style="font-size:13px;margin-top:4px;text-transform:uppercase;">${escapeHtml(user?.terms ?? 'prepaid')}</div>
        </td>
      </tr>
    </table>

    <table role="presentation" width="100%" style="border-collapse:separate;border-spacing:0;margin:20px -6px 0;">
      <tr>
        ${summaryCard('Total invoiced', money(invoiced), { hint: `${invoices.length} ${invoices.length === 1 ? 'invoice' : 'invoices'}` })}
        ${summaryCard('Total paid', money(paid), { tone: OK })}
        ${summaryCard('Balance owing', money(outstanding), {
          tone: outstanding > 0 ? BRAND : OK,
          hint: outstanding > 0 ? 'Please settle at your earliest convenience' : 'Nothing outstanding',
        })}
      </tr>
    </table>

    <div style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:${MUTED};font-weight:700;margin:26px 0 8px;">
      Activity
    </div>

    <table role="presentation" width="100%" style="border-collapse:collapse;">
      <thead>
        <tr>
          <th style="padding:0 10px 8px;text-align:left;font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:${MUTED};border-bottom:1px solid ${LINE};">Date</th>
          <th style="padding:0 10px 8px;text-align:left;font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:${MUTED};border-bottom:1px solid ${LINE};">Reference</th>
          <th style="padding:0 10px 8px;text-align:right;font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:${MUTED};border-bottom:1px solid ${LINE};">Charge</th>
          <th style="padding:0 10px 8px;text-align:right;font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:${MUTED};border-bottom:1px solid ${LINE};">Paid</th>
          <th style="padding:0 10px 8px;text-align:right;font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:${MUTED};border-bottom:1px solid ${LINE};">Balance</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>

    <table role="presentation" width="100%" style="border-collapse:collapse;margin-top:14px;">
      <tr>
        <td></td>
        <td style="width:230px;">
          <div style="border:1px solid ${outstanding > 0 ? BRAND : LINE};border-radius:10px;padding:12px 14px;background:${outstanding > 0 ? '#fef2f2' : '#ffffff'};">
            <div style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:${MUTED};font-weight:700;">
              Closing balance
            </div>
            <div style="font-size:22px;font-weight:700;margin-top:4px;color:${outstanding > 0 ? BRAND : OK};">
              ${money(outstanding)}
            </div>
          </div>
        </td>
      </tr>
    </table>

    <p style="font-size:11px;color:${MUTED};line-height:1.7;margin:22px 0 0;border-top:1px solid ${LINE};padding-top:14px;">
      This statement covers all activity on the account to ${escapeHtml(day(new Date()))}.
      Questions about any line? Reply to this statement or call ${escapeHtml(business.phone ?? 'the sales desk')} and quote the reference.
    </p>

    <div class="no-print" style="margin-top:20px;text-align:right;">
      <button id="print-statement" type="button"
        style="border:1px solid ${LINE};background:#ffffff;border-radius:9px;padding:8px 14px;font-size:13px;font-weight:600;color:${INK};cursor:pointer;">
        Print or save as PDF
      </button>
    </div>
  </div>

  <script${nonce ? ` nonce="${nonce}"` : ''}>
    document.getElementById('print-statement').addEventListener('click', function () { window.print(); });
  </script>
</body>
</html>`;
}

export default renderStatementHtml;
