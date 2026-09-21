import { BUSINESS_INFO } from '../../../shared/business.js';
import { formatDate } from '../../../shared/dates.js';

/**
 * The proforma invoice document (§6.8b).
 *
 * A **supplier's** formal offer against a purchase order, rendered from the
 * fields they filled in on the portal. The mirror image of `invoiceDocument.js`
 * - that one is money coming in and is written by us; this one is money going
 * out and its numbers came from outside.
 *
 * **Form-driven, never uploaded.** There is no PDF library in this codebase and
 * no file-storage path: the supplier states their reference, terms and bank
 * details, the server totals the lines they already priced, and this renders
 * the sheet for print-to-PDF. A form the server totals is a document whose
 * arithmetic we can trust even though its prices are theirs.
 *
 * Styling is INLINE for the reason `invoiceDocument.js` gives: the same sheet
 * has to survive being emailed, and mail clients strip <style> blocks without
 * warning. The <style> block here carries print rules only.
 */

const INK = '#111113';
const MUTED = '#6b6b73';
const LINE = '#e4e4e8';
const BRAND = '#CF3429';

/** The same six-step scale the invoice uses, so the two read as one system. */
const T = {
  micro: '10px',
  small: '11px',
  body: '12px',
  item: '13px',
  lead: '15px',
  figure: '26px',
};

const CAD = new Intl.NumberFormat('en-CA', {
  style: 'currency',
  currency: 'CAD',
  currencyDisplay: 'narrowSymbol',
});

const money = (cents) => CAD.format((cents ?? 0) / 100);
const day = (value) => formatDate(value);

/** Everything interpolated below is supplier-authored, so it all escapes. */
function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** A block of free text, with the supplier's own line breaks kept. */
function textBlock(value) {
  return escapeHtml(value)
    .split('\n')
    .filter((line) => line.trim())
    .join('<br />');
}

function totalsRow(label, value, { strong = false } = {}) {
  return `
    <tr>
      <td style="padding:${strong ? '9px' : '4px'} 0 ${strong ? '9px' : '4px'} 0;font:${strong ? '700' : '400'} ${strong ? T.lead : T.item}/1.4 inherit;color:${strong ? INK : MUTED};${strong ? `border-top:1px solid ${LINE};` : ''}">${escapeHtml(label)}</td>
      <td align="right" style="padding:${strong ? '9px' : '4px'} 0;font:${strong ? '700' : '500'} ${strong ? T.lead : T.item}/1.4 inherit;color:${INK};${strong ? `border-top:1px solid ${LINE};` : ''}">${escapeHtml(value)}</td>
    </tr>`;
}

/**
 * Render one supplier's proforma invoice against a purchase order.
 *
 * @param {object}  po        the purchase order document (lean or hydrated)
 * @param {object}  bid       the supplier's bid, carrying `proforma`
 * @param {object}  supplier  the supplier document, for the letterhead
 * @param {string} [nonce]    when present, adds the print button and its script
 */
function renderProformaHtml({ po, bid, supplier, nonce = null, business = BUSINESS_INFO }) {
  const proforma = bid?.proforma;
  if (!proforma) return null;

  const qtyBySku = new Map((po.items ?? []).map((item) => [item.sku, item.qtyOrdered]));

  // Only the lines this supplier can actually fill. A line they marked
  // unavailable is not on their invoice, because they are not offering it.
  const lines = (bid.lines ?? [])
    .filter((line) => line.available !== false)
    .map((line) => {
      const item = (po.items ?? []).find((row) => row.sku === line.sku);
      const qty = qtyBySku.get(line.sku) ?? 0;
      return {
        sku: line.sku,
        name: item?.name ?? line.sku,
        qty,
        unitCost: line.unitCost ?? 0,
        lineTotal: (line.unitCost ?? 0) * qty,
      };
    });

  const lineRows = lines
    .map(
      (line) => `
      <tr>
        <td style="padding:9px 0;border-bottom:1px solid ${LINE};font:400 ${T.item}/1.4 inherit;color:${INK};">
          ${escapeHtml(line.name)}
          <span style="display:block;font:400 ${T.micro}/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:${MUTED};">${escapeHtml(line.sku)}</span>
        </td>
        <td align="right" style="padding:9px 0;border-bottom:1px solid ${LINE};font:400 ${T.item}/1.4 inherit;color:${MUTED};">${line.qty}</td>
        <td align="right" style="padding:9px 0;border-bottom:1px solid ${LINE};font:400 ${T.item}/1.4 inherit;color:${MUTED};">${escapeHtml(money(line.unitCost))}</td>
        <td align="right" style="padding:9px 0;border-bottom:1px solid ${LINE};font:500 ${T.item}/1.4 inherit;color:${INK};">${escapeHtml(money(line.lineTotal))}</td>
      </tr>`,
    )
    .join('');

  const reference = proforma.number || `${po.poNumber}-PI${proforma.revision ?? 1}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Proforma ${escapeHtml(reference)} · ${escapeHtml(supplier?.name ?? 'Supplier')}</title>
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
  <button type="button" id="print-proforma" style="cursor:pointer;border:0;border-radius:10px;padding:9px 16px;font-size:${T.item};font-weight:600;color:#fff;background:${BRAND};">
    Print / save as PDF
  </button>
</div>
<script nonce="${escapeHtml(nonce)}">
  document.getElementById('print-proforma').addEventListener('click', function () { window.print(); });
</script>`
    : ''
}

<table role="presentation" class="sheet" cellpadding="0" cellspacing="0" style="max-width:760px;width:100%;margin:0 auto;background:#fff;border-collapse:collapse;box-shadow:0 1px 3px rgba(0,0,0,.08);">
  <tr>
    <td style="padding:32px 36px 0;">

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="vertical-align:top;">
            <!-- The SUPPLIER's letterhead: this is their document, not ours. -->
            <span style="display:block;font:700 ${T.lead}/1.2 inherit;color:${INK};">${escapeHtml(supplier?.name ?? 'Supplier')}</span>
            ${supplier?.email ? `<span style="display:block;margin-top:3px;font:400 ${T.body}/1.5 inherit;color:${MUTED};">${escapeHtml(supplier.email)}</span>` : ''}
            ${supplier?.phone ? `<span style="display:block;font:400 ${T.body}/1.5 inherit;color:${MUTED};">${escapeHtml(supplier.phone)}</span>` : ''}
          </td>
          <td align="right" style="vertical-align:top;">
            <span style="display:block;font:700 ${T.figure}/1 inherit;color:${INK};letter-spacing:-0.02em;">PROFORMA</span>
            <span style="display:block;margin-top:5px;font:600 ${T.small}/1.4 inherit;color:${MUTED};letter-spacing:.08em;text-transform:uppercase;">Not a tax invoice</span>
          </td>
        </tr>
      </table>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:22px;border-top:1px solid ${LINE};">
        <tr>
          <td style="padding-top:14px;vertical-align:top;width:50%;">
            <span style="display:block;font:600 ${T.small}/1.4 inherit;color:${MUTED};letter-spacing:.08em;text-transform:uppercase;">Billed to</span>
            <span style="display:block;margin-top:5px;font:600 ${T.item}/1.5 inherit;color:${INK};">${escapeHtml(business.name)}</span>
            <span style="display:block;font:400 ${T.body}/1.5 inherit;color:${MUTED};">${escapeHtml(business.address.line1 ?? '')}</span>
            <span style="display:block;font:400 ${T.body}/1.5 inherit;color:${MUTED};">${escapeHtml(
              [business.address.city, business.address.region, business.address.postal]
                .filter(Boolean)
                .join(', '),
            )}</span>
          </td>
          <td align="right" style="padding-top:14px;vertical-align:top;">
            <table role="presentation" cellpadding="0" cellspacing="0" style="display:inline-table;">
              ${[
                ['Reference', reference],
                ['Against', po.poNumber],
                ['Issued', day(proforma.issuedAt)],
                ...(proforma.revision > 1 ? [['Revision', String(proforma.revision)]] : []),
                ...(proforma.validUntil ? [['Valid until', day(proforma.validUntil)]] : []),
                ...(bid.leadTimeDays != null ? [['Lead time', `${bid.leadTimeDays} days`]] : []),
              ]
                .map(
                  ([label, value]) => `
                <tr>
                  <td style="padding:2px 12px 2px 0;font:400 ${T.body}/1.5 inherit;color:${MUTED};">${escapeHtml(label)}</td>
                  <td align="right" style="padding:2px 0;font:600 ${T.body}/1.5 inherit;color:${INK};">${escapeHtml(value)}</td>
                </tr>`,
                )
                .join('')}
            </table>
          </td>
        </tr>
      </table>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;">
        <tr>
          <td style="padding-bottom:7px;border-bottom:1px solid ${LINE};font:600 ${T.micro}/1.4 inherit;color:${MUTED};letter-spacing:.08em;text-transform:uppercase;">Item</td>
          <td align="right" style="padding-bottom:7px;border-bottom:1px solid ${LINE};font:600 ${T.micro}/1.4 inherit;color:${MUTED};letter-spacing:.08em;text-transform:uppercase;">Qty</td>
          <td align="right" style="padding-bottom:7px;border-bottom:1px solid ${LINE};font:600 ${T.micro}/1.4 inherit;color:${MUTED};letter-spacing:.08em;text-transform:uppercase;">Unit</td>
          <td align="right" style="padding-bottom:7px;border-bottom:1px solid ${LINE};font:600 ${T.micro}/1.4 inherit;color:${MUTED};letter-spacing:.08em;text-transform:uppercase;">Amount</td>
        </tr>
        ${lineRows}
      </table>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">
        <tr>
          <td style="width:50%;vertical-align:top;padding-right:24px;">
            ${
              proforma.paymentTerms
                ? `<span style="display:block;font:600 ${T.small}/1.4 inherit;color:${MUTED};letter-spacing:.08em;text-transform:uppercase;">Payment terms</span>
            <span style="display:block;margin-top:4px;font:400 ${T.body}/1.6 inherit;color:${INK};">${textBlock(proforma.paymentTerms)}</span>`
                : ''
            }
            ${
              proforma.bankDetails
                ? `<span style="display:block;margin-top:14px;font:600 ${T.small}/1.4 inherit;color:${MUTED};letter-spacing:.08em;text-transform:uppercase;">Remit to</span>
            <span style="display:block;margin-top:4px;font:400 ${T.body}/1.6 inherit;color:${INK};">${textBlock(proforma.bankDetails)}</span>`
                : ''
            }
          </td>
          <td style="vertical-align:top;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:inherit;">
              ${totalsRow('Subtotal', money(proforma.subtotal))}
              ${proforma.shipping ? totalsRow('Shipping', money(proforma.shipping)) : ''}
              ${proforma.tax ? totalsRow('Tax', money(proforma.tax)) : ''}
              ${totalsRow('Total', money(proforma.total), { strong: true })}
            </table>
          </td>
        </tr>
      </table>

      ${
        proforma.note
          ? `<p style="margin:20px 0 0;padding-top:14px;border-top:1px solid ${LINE};font:400 ${T.body}/1.6 inherit;color:${MUTED};">${textBlock(proforma.note)}</p>`
          : ''
      }

      <p style="margin:20px 0 0;font:400 ${T.micro}/1.5 inherit;color:${MUTED};">
        A proforma invoice is a quotation of price and terms, not a demand for payment and not a tax
        invoice. Figures are calculated from the prices submitted against ${escapeHtml(po.poNumber)}.
      </p>

    </td>
  </tr>
  <tr><td style="height:32px;"></td></tr>
</table>

</body>
</html>`;
}

export { renderProformaHtml };
export default renderProformaHtml;
