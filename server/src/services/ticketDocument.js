import { paletteFor, migrateColorToken } from '../../../shared/businessPalette.js';
import { TICKET_STATUS_LABELS } from '../../../shared/schemas/admin.js';

/**
 * The job label a repair counter sticks on a device (Sales § Ticket).
 *
 * It has to be readable at arm's length on a shelf of forty handsets, so it
 * carries six facts in large type, in the business's own identity colour.
 *
 * The ticket and the quote the customer is handed are NOT drawn here any
 * more: since 2026-10-06 they are drawn by `invoiceDocument.renderRepairDocumentHtml`,
 * so the quote, the ticket and the invoice of one job are the same piece of
 * paper. The label stays its own render because it is not a document but a
 * sticker, on whatever roll the shop's printer takes.
 *
 * HTML rather than a PDF: the browser's print dialog handles the label's
 * unusual paper size, which a server-side renderer would have to be told about
 * for every roll a shop happens to own.
 */

const CAD = new Intl.NumberFormat('en-CA', {
  style: 'currency',
  currency: 'CAD',
  minimumFractionDigits: 2,
});

const money = (cents) => CAD.format((cents ?? 0) / 100);

const INK = '#111113';
const MUTED = '#6b6b73';
const LINE = '#e4e4e8';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function day(value) {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** The shop's identity colour, so a document is never in another business's brand. */
function brandOf(business) {
  return paletteFor(migrateColorToken(business?.colorToken)).base;
}

/**
 * The label sizes a repair shop actually owns.
 *
 * Offered as a picker rather than fixed, because a shop buys whatever roll its
 * printer takes and a document that assumes one size is a document that prints
 * off the edge of every other.
 */
const LABEL_SIZES = [
  { value: '50x80', label: '50 × 80 mm', width: '50mm', height: '80mm' },
  { value: '40x60', label: '40 × 60 mm', width: '40mm', height: '60mm' },
  { value: '62x100', label: '62 × 100 mm', width: '62mm', height: '100mm' },
];


/**
 * The job label.
 *
 * **Six facts, and nothing else.** The number, the status, who it belongs to,
 * what the device is, how to get into it, and what it comes to. Everything a
 * technician needs while holding the device, at a size they can read without
 * picking it up - which is the whole reason it is not just a small ticket.
 *
 * The passcode is on it deliberately: a label is on a device already in the
 * shop's possession, and a technician who cannot unlock it cannot test the
 * repair. It is the one place that field is printed.
 */
function renderTicketLabel({ ticket, business, settings, size = '50x80', nonce = '' }) {
  const chosen = LABEL_SIZES.find((entry) => entry.value === size) ?? LABEL_SIZES[0];
  const brand = brandOf(business);
  const device = ticket.devices?.[0] ?? {};
  const deviceName = [device.brand ?? ticket.deviceBrand, device.model ?? ticket.deviceModel]
    .filter(Boolean)
    .join(' - ');

  const total = ticket.finalCents || ticket.estimateCents || 0;
  const due = Math.max(0, total - (ticket.depositTotal ?? 0));

  return `<!doctype html>
<html lang="en-CA">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Job Label - ${escapeHtml(ticket.ticketNumber)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: #f4f4f6;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    color: ${INK};
  }

  /* The toolbar is screen-only: it is how somebody picks a size and prints,
     and it must never appear on the label itself. */
  .bar {
    display: flex; flex-wrap: wrap; align-items: center; gap: 12px;
    max-width: 680px; margin: 28px auto 20px; padding: 14px 18px;
    background: #fff; border-radius: 12px;
    box-shadow: 0 1px 3px rgba(0,0,0,.08), 0 8px 24px rgba(0,0,0,.06);
  }
  .bar h1 { flex: 1 1 auto; margin: 0; font-size: 15px; font-weight: 700; }
  .bar select { padding: 7px 10px; border: 1px solid ${LINE}; border-radius: 8px; font-size: 13px; }
  .bar button {
    cursor: pointer; border: 0; border-radius: 8px; padding: 9px 16px;
    font-size: 13px; font-weight: 600; color: #fff; background: ${brand};
  }
  .bar a {
    padding: 9px 16px; border-radius: 8px; font-size: 13px; font-weight: 600;
    color: ${MUTED}; text-decoration: none; border: 1px solid ${LINE};
  }

  /* The label. Sized in millimetres because it is going on a roll, not a screen. */
  .label {
    width: ${chosen.width};
    min-height: ${chosen.height};
    margin: 0 auto 40px;
    background: #fff;
    border: 1px solid ${INK};
    display: flex; flex-direction: column;
  }
  .row { border-bottom: 1px solid ${INK}; padding: 2mm 2.5mm; text-align: center; }
  .row:last-child { border-bottom: 0; }

  /* The number is the label's whole job: it is what somebody reads across a
     bench. Everything else is set relative to it. */
  .num { font-size: 20px; font-weight: 800; line-height: 1.05; letter-spacing: -.02em; }
  .status { font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: ${MUTED}; }
  .who { font-size: 12px; font-weight: 700; }
  .sub { font-size: 10px; }
  .dev { font-size: 12px; font-weight: 700; line-height: 1.2; }
  .issue { font-size: 9px; font-style: italic; color: ${MUTED}; margin-top: 1mm; }
  .cap { font-size: 7px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: ${MUTED}; }
  .pin { font-size: 14px; font-weight: 800; letter-spacing: .12em; }
  .money { display: flex; }
  .money > div { flex: 1; }
  .money > div + div { border-left: 1px solid ${INK}; }
  .amt { font-size: 12px; font-weight: 800; }

  @media print {
    body { background: #fff; }
    .bar { display: none; }
    .label { margin: 0; border: 0; }
    /* The sheet IS the label, so the page takes its size and loses its margin.
       Without this the browser centres a 50mm label on A4 and the roll feeds
       a blank page after every print. */
    @page { size: ${chosen.width} ${chosen.height}; margin: 0; }
  }
</style>
</head>
<body>
  <div class="bar">
    <h1>Repair ticket label - ${escapeHtml(ticket.ticketNumber)}</h1>
    <label style="font-size:13px;color:${MUTED};">
      Size:
      <select id="size">
        ${LABEL_SIZES.map(
          (entry) =>
            `<option value="${entry.value}"${entry.value === chosen.value ? ' selected' : ''}>${entry.label}</option>`,
        ).join('')}
      </select>
    </label>
    <button type="button" id="print">Print</button>
    <a href="#" id="close">Close</a>
  </div>

  <div class="label">
    <div class="row">
      <div class="num">${escapeHtml(ticket.ticketNumber)}</div>
      <div class="status">${escapeHtml(TICKET_STATUS_LABELS[ticket.status] ?? ticket.status)}</div>
    </div>

    <div class="row">
      <div class="who">${escapeHtml(ticket.customerName)}</div>
      <div class="sub">${escapeHtml(ticket.customerPhone)}</div>
    </div>

    <div class="row">
      <div class="dev">${escapeHtml(deviceName || 'Device')}</div>
      ${ticket.issue ? `<div class="issue">${escapeHtml(ticket.issue)}</div>` : ''}
    </div>

    ${
      device.passcode
        ? `<div class="row">
             <div class="cap">Passcode</div>
             <div class="pin">${escapeHtml(device.passcode)}</div>
           </div>`
        : ''
    }

    <div class="row money">
      <div><div class="cap">Total</div><div class="amt">${money(total)}</div></div>
      <div><div class="cap">Due</div><div class="amt">${money(due)}</div></div>
    </div>
  </div>

<script nonce="${escapeHtml(nonce)}">
  document.getElementById('print').addEventListener('click', function () { window.print(); });
  document.getElementById('close').addEventListener('click', function (event) {
    event.preventDefault();
    window.close();
  });
  // Changing the size re-renders server-side rather than resizing in the page:
  // the @page rule is what the printer reads, and it cannot be set from script.
  document.getElementById('size').addEventListener('change', function (event) {
    var url = new URL(window.location.href);
    url.searchParams.set('size', event.target.value);
    window.location.assign(url.toString());
  });
</script>
</body>
</html>`;
}

export { LABEL_SIZES, renderTicketLabel };
