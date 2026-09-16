import { paletteFor, migrateColorToken } from '../../../shared/businessPalette.js';
import { TICKET_STATUS_LABELS } from '../../../shared/schemas/admin.js';
import SettingsModel from '../models/Settings.js';
import { warrantyTerms, unlessDefault } from './warrantyTerms.js';

/**
 * The two pieces of paper a repair counter prints (Sales § Ticket).
 *
 * **A job label** that goes on the device, and **a ticket document** the
 * customer leaves with. They answer different questions and are therefore not
 * two sizes of one render: the label has to be readable at arm's length on a
 * shelf of forty handsets, so it carries six facts in large type; the document
 * is the record of what was agreed, so it carries the fault, the work, the
 * money and the warranty.
 *
 * ## Why this is not `invoiceDocument`
 *
 * That renderer is hardcoded to Cellvix - `BRAND` is a red hex literal and
 * `BUSINESS_INFO` is the wholesale business's static details. Correct when it
 * was written, wrong for a repair shop: a CellShoppe customer must not be handed
 * a document in another company's colour with another company's phone number on
 * it. Everything here reads the **business's own** settings and identity colour.
 *
 * ## Why both render HTML rather than a PDF
 *
 * There is no PDF generator in this codebase and adding one to print a label
 * would be a dependency earning its keep on one screen. The browser's print
 * dialog is where "save as PDF" already lives, and it also handles the label's
 * unusual paper size - which a server-side renderer would have to be told about
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
 * `unlessDefault` and the warranty ladder both live in `warrantyTerms.js`.
 *
 * The warranty email states the same promise this sheet prints, so the ladder
 * and the "is that still Cellvix's placeholder phone number" guard are
 * computed in one place. Two copies would let a customer be handed a sheet
 * saying 120 days and an email saying 90.
 */

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

/**
 * The second sheet: warranty, feedback, confidentiality.
 *
 * **A page of its own, not a longer first page.** The first sheet is the
 * transaction - what came in, what is being done, what it costs - and a customer
 * checking a figure should not have to read past a warranty table to find it.
 * This is the half they keep, and it is what they produce when they come back.
 *
 * The warranty table shows **every tier, with the customer's own marked**. A
 * table listing only what they have tells them nothing; one showing what the
 * next tier gives is the only version that is worth printing, and the figures
 * are the shop's real `warrantyBonusByTier` settings rather than copy.
 */
function warrantyPage({ ticket, shop, contact, brand, tiers, review }) {
  const mine = tiers.find((tier) => tier.isCustomer);

  return `
  <div class="sheet page-2">
    <div class="pad">
      <table>
        <tr>
          <td style="vertical-align:top;">
            <div style="font-size:17px;font-weight:800;color:${brand};">${escapeHtml(shop)}</div>
            ${contact ? `<div style="margin-top:3px;font-size:10px;" class="muted">${escapeHtml(contact)}</div>` : ''}
          </td>
          <td style="vertical-align:top;text-align:right;font-size:11px;">
            <div><strong>Ticket:</strong> ${escapeHtml(ticket.ticketNumber)}</div>
            <div style="margin-top:2px;"><strong>Date:</strong> ${escapeHtml(day(ticket.createdAt))}</div>
          </td>
        </tr>
      </table>

      <div style="margin:16px 0 18px;border-top:2px solid ${brand};"></div>

      <div style="border:1px solid ${brand}33;border-radius:6px;background:${brand}0a;padding:16px 18px;">
        <div style="font-size:15px;font-weight:800;color:${brand};">WARRANTY INFORMATION</div>

        <p style="margin:10px 0 12px;font-size:11px;line-height:1.7;color:${INK};">
          Thank you for choosing <strong>${escapeHtml(shop)}</strong>.${
            mine
              ? ` As a <strong>${escapeHtml(mine.label)} Member</strong>, every repair on this ticket is covered by a <strong>${mine.days}-day warranty</strong>.`
              : ' Every repair on this ticket is covered by the warranty shown below.'
          }
        </p>

        <table style="border-collapse:collapse;">
          <tr style="background:${brand};color:#fff;">
            <th style="padding:5px 10px;font-size:10px;text-align:left;">Membership tier</th>
            <th style="padding:5px 10px;font-size:10px;text-align:right;">Warranty period (all repairs)</th>
          </tr>
          ${tiers
            .map(
              (tier) => `
            <tr${tier.isCustomer ? ` style="background:${brand};color:#fff;"` : ''}>
              <td style="padding:4px 10px;font-size:10px;font-weight:700;">
                ${escapeHtml(tier.label)} Member${tier.isCustomer ? ' (this customer)' : ''}
              </td>
              <td style="padding:4px 10px;font-size:10px;font-weight:700;text-align:right;">
                ${tier.days}-day warranty
              </td>
            </tr>`,
            )
            .join('')}
        </table>

        <div style="margin-top:12px;font-size:10px;font-weight:700;">Important terms and conditions:</div>
        <ul style="margin:5px 0 0;padding-left:16px;font-size:10px;line-height:1.8;" class="muted">
          <li>Warranty does not cover liquid damage or physical damage occurring after service.</li>
          <li>Warranty applies only to the specific repair performed.</li>
          <li>Proof of this ticket is required to claim warranty service.</li>
        </ul>
        ${contact ? `<div style="margin-top:9px;font-size:10px;font-weight:700;">For warranty support: ${escapeHtml(contact)}</div>` : ''}
      </div>

      <div style="margin-top:14px;border:1px solid ${LINE};border-radius:6px;background:#f6f8fb;padding:16px 18px;">
        <div style="font-size:15px;font-weight:800;color:${brand};">YOUR FEEDBACK MATTERS</div>
        <p style="margin:9px 0 0;font-size:11px;line-height:1.7;">
          We strive to deliver reliable repair service every time. Your experience matters to us and
          helps us serve you better. Enjoyed our service? We would love to hear from you.
        </p>
        ${
          review
            ? `<div style="margin-top:10px;"><a href="${escapeHtml(review)}" style="font-size:11px;font-weight:700;color:#1a4fd6;">Click here to leave us a review</a></div>`
            : ''
        }
      </div>

      <!-- Left-ruled rather than boxed: it is a notice, not a section, and a
           full border would give it the same weight as the two panels above. -->
      <div style="margin-top:14px;border-left:3px solid #d99a00;background:#fdf6e3;padding:11px 14px;">
        <span style="font-size:10px;font-weight:700;color:#8a5a00;">Confidentiality notice:</span>
        <span style="font-size:10px;line-height:1.6;color:#8a5a00;">
          This ticket is intended solely for the individual or organization named above. If you have
          received it in error, please notify the sender immediately. Any unauthorized use,
          disclosure or distribution is prohibited.
        </span>
      </div>
    </div>

    <div style="padding:14px 32px;border-top:2px solid ${brand};text-align:center;">
      <div style="font-size:12px;font-weight:700;">${escapeHtml(shop)}</div>
      ${contact ? `<div style="margin-top:3px;font-size:10px;" class="muted">${escapeHtml(contact)}</div>` : ''}
    </div>
  </div>`;
}

/** One device block on the ticket document. */
function deviceSection(device) {
  const name = [device.brand, device.model].filter(Boolean).join(' - ') || 'Device';
  const lines = [...(device.services ?? []), ...(device.parts ?? [])];

  return `
    <tr>
      <td colspan="3" style="padding:10px 12px 6px;background:#f6f6f8;font-size:12px;font-weight:700;color:${INK};">
        ${escapeHtml(name)}${device.serial ? ` <span style="font-weight:400;color:${MUTED};">(S/N: ${escapeHtml(device.serial)})</span>` : ''}
      </td>
    </tr>
    ${
      device.problem
        ? `<tr><td colspan="3" style="padding:0 12px 6px;font-size:11px;color:${MUTED};">
             <strong style="color:${INK};">Problem:</strong> ${escapeHtml(device.problem)}
           </td></tr>`
        : ''
    }
    ${
      device.solution
        ? `<tr><td colspan="3" style="padding:0 12px 8px;font-size:11px;color:${MUTED};">
             <strong style="color:${INK};">Solution:</strong> ${escapeHtml(device.solution)}
           </td></tr>`
        : ''
    }
    ${
      lines.length
        ? lines
            .map(
              (line) => `
        <tr>
          <td style="padding:6px 12px;font-size:12px;border-bottom:1px solid ${LINE};">${escapeHtml(line.name)}</td>
          <td style="padding:6px 12px;font-size:12px;text-align:center;border-bottom:1px solid ${LINE};color:${MUTED};">${line.qty ?? 1}</td>
          <td style="padding:6px 12px;font-size:12px;text-align:right;border-bottom:1px solid ${LINE};">${money((line.priceCents ?? 0) * (line.qty ?? 1))}</td>
        </tr>`,
            )
            .join('')
        : `<tr><td colspan="3" style="padding:6px 12px 10px;font-size:11px;font-style:italic;color:${MUTED};">
             Nothing priced yet.
           </td></tr>`
    }`;
}

/**
 * The ticket document - what the customer is handed at drop-off.
 *
 * **It is not an invoice**, and says so: the figures on it are an estimate
 * until the work is done, and a document that looked like a bill would be
 * asking for money nobody owes yet. The warranty and the terms are on it
 * because this is the piece of paper a customer produces later when they come
 * back, which is the only reason a shop prints one at all.
 */
function renderTicketHtml({ ticket, business, settings, customerTier, nonce = '' }) {
  const brand = brandOf(business);
  const info = settings?.business ?? {};

  /**
   * The **business record** names the shop, not its settings.
   *
   * `Settings.business.name` defaults to `'Cellvix'` in the schema, and a
   * business nobody has filled that section in for still carries the default -
   * CellShoppe does, along with Cellvix's phone number and sales address. A
   * renderer that preferred settings printed the wrong company on a repair
   * shop's own paperwork, which is the single worst thing a document can get
   * wrong.
   *
   * `Business.name` is what created the shop and is always right, so it wins.
   * The settings copy is a per-business override for a shop that has set a
   * trading name different from its registered one.
   *
   * The contact details have no such authority anywhere else, so they are taken
   * from settings **only when they are not still the schema defaults** - a
   * placeholder phone number on a customer's ticket is worse than none, because
   * somebody will ring it. The defaults are read off the schema rather than
   * copied here, so changing one there cannot leave this comparing against a
   * string that no longer exists.
   */
  const shop = business?.name || info.name || 'Repair';
  const contact = [unlessDefault(info.phone, 'phone'), unlessDefault(info.email, 'email')]
    .filter(Boolean)
    .join('  |  ');
  const devices = ticket.devices?.length
    ? ticket.devices
    : [{ brand: ticket.deviceBrand, model: ticket.deviceModel, serial: ticket.deviceSerial, problem: ticket.issue, services: [], parts: [] }];

  const subtotal = devices.reduce(
    (sum, device) =>
      sum +
      [...(device.services ?? []), ...(device.parts ?? [])].reduce(
        (n, line) => n + (line.priceCents ?? 0) * (line.qty ?? 1),
        0,
      ),
    0,
  );
  const discount = Math.min(ticket.discountCents ?? 0, subtotal);
  const taxed = subtotal - discount;
  const tax = Math.round(taxed * ((ticket.taxRate ?? 0) / 100));
  const total = taxed + tax;
  const paid = ticket.depositTotal ?? 0;

  /**
   * The warranty ladder, from the shop own settings.
   *
   * Base days plus the tier bonus, so the table prints what this business
   * actually promises rather than numbers written into a template. A shop that
   * changes its bonus in Settings changes every ticket printed afterwards -
   * and changes the warranty email with it, which reads the same function.
   */
  const { tiers, review } = warrantyTerms(settings, customerTier);

  return `<!doctype html>
<html lang="en-CA">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Ticket ${escapeHtml(ticket.ticketNumber)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px 16px; background: #f4f4f6;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    color: ${INK};
  }
  .sheet {
    max-width: 780px; margin: 0 auto; background: #fff;
    border-top: 4px solid ${brand};
    box-shadow: 0 1px 3px rgba(0,0,0,.08), 0 8px 24px rgba(0,0,0,.06);
  }
  .pad { padding: 28px 32px; }
  .bar { max-width: 780px; margin: 0 auto 16px; display: flex; justify-content: flex-end; gap: 10px; }
  .bar button {
    cursor: pointer; border: 0; border-radius: 8px; padding: 9px 16px;
    font-size: 13px; font-weight: 600; color: #fff; background: ${brand};
  }
  table { width: 100%; border-collapse: collapse; }
  .muted { color: ${MUTED}; }
  .cap { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: ${brand}; }

  @media print {
    body { background: #fff; padding: 0; }
    .sheet { box-shadow: none; max-width: none; }
    .bar { display: none; }
    @page { margin: 14mm; }
    /* Sheet two is a page, not a continuation - it is the half the customer
       keeps, and it must not start halfway down the transaction. */
    .page-2 { break-before: page; }
  }
</style>
</head>
<body>
  <div class="bar"><button type="button" id="print">Print or save as PDF</button></div>

  <div class="sheet">
    <div class="pad">
      <table>
        <tr>
          <td style="vertical-align:top;">
            <div style="font-size:19px;font-weight:800;color:${brand};">${escapeHtml(shop)}</div>
            ${contact ? `<div style="margin-top:4px;font-size:11px;" class="muted">${escapeHtml(contact)}</div>` : ''}
          </td>
          <td style="vertical-align:top;text-align:right;">
            <!-- "TICKET", not "INVOICE". The figures below are an estimate
                 until the work is done, and a document that looked like a bill
                 would be asking for money nobody owes yet. -->
            <div style="font-size:24px;font-weight:800;letter-spacing:-.02em;">TICKET</div>
            <div style="font-size:13px;font-weight:700;color:${brand};">${escapeHtml(ticket.ticketNumber)}</div>
            <div style="margin-top:3px;font-size:11px;" class="muted">Date: ${escapeHtml(day(ticket.createdAt))}</div>
            <div style="margin-top:6px;display:inline-block;padding:3px 10px;border-radius:4px;background:#fdf3e2;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#8a5a00;">
              ${escapeHtml(TICKET_STATUS_LABELS[ticket.status] ?? ticket.status)}
            </div>
          </td>
        </tr>
      </table>

      <div style="margin:20px 0 14px;border-top:2px solid ${brand};"></div>

      <div class="cap">Customer</div>
      <div style="margin-top:5px;font-size:13px;font-weight:700;">${escapeHtml(ticket.customerName)}</div>
      ${ticket.customerEmail ? `<div style="font-size:12px;" class="muted">${escapeHtml(ticket.customerEmail)}</div>` : ''}
      <div style="font-size:12px;" class="muted">${escapeHtml(ticket.customerPhone)}</div>

      <table style="margin-top:18px;">
        ${devices.map((device) => deviceSection(device)).join('')}
      </table>

      <table style="margin-top:14px;">
        <tr>
          <td></td>
          <td style="width:250px;">
            <table>
              <tr>
                <td style="padding:4px 0;font-size:12px;" class="muted">Subtotal</td>
                <td style="padding:4px 0;font-size:12px;text-align:right;">${money(subtotal)}</td>
              </tr>
              ${
                discount > 0
                  ? `<tr><td style="padding:4px 0;font-size:12px;" class="muted">Discount</td>
                       <td style="padding:4px 0;font-size:12px;text-align:right;">-${money(discount)}</td></tr>`
                  : ''
              }
              <tr>
                <td style="padding:4px 0;font-size:12px;" class="muted">GST (${ticket.taxRate ?? 0}%)</td>
                <td style="padding:4px 0;font-size:12px;text-align:right;">${money(tax)}</td>
              </tr>
              <tr>
                <td style="padding:7px 10px;font-size:13px;font-weight:800;color:#fff;background:${brand};">TOTAL</td>
                <td style="padding:7px 10px;font-size:13px;font-weight:800;text-align:right;color:#fff;background:${brand};">${money(total)} CAD</td>
              </tr>
              ${
                paid > 0
                  ? `<tr><td style="padding:5px 0;font-size:12px;" class="muted">Deposit paid</td>
                       <td style="padding:5px 0;font-size:12px;text-align:right;">-${money(paid)}</td></tr>
                     <tr><td style="padding:2px 0;font-size:12px;font-weight:700;">Balance due</td>
                       <td style="padding:2px 0;font-size:12px;font-weight:700;text-align:right;">${money(Math.max(0, total - paid))}</td></tr>`
                  : ''
              }
            </table>
          </td>
        </tr>
      </table>

      ${
        ticket.clientNotes
          ? `<div style="margin-top:18px;padding:12px 14px;background:#f6f6f8;border-radius:6px;">
               <div class="cap">Notes</div>
               <div style="margin-top:5px;font-size:12px;white-space:pre-wrap;">${escapeHtml(ticket.clientNotes)}</div>
             </div>`
          : ''
      }

      <!-- The terms. This is the piece of paper a customer produces when they
           come back, so what the shop stands behind has to be on it. -->
      <div style="margin-top:18px;padding:14px 16px;border:1px solid ${LINE};border-radius:6px;">
        <div class="cap">Terms</div>
        <ul style="margin:7px 0 0;padding-left:18px;font-size:11px;line-height:1.7;" class="muted">
          <li>Proof of this ticket is required to collect the device.</li>
          <li>Any warranty covers the specific repair performed, not pre-existing faults.</li>
          <li>Liquid and physical damage occurring after service is not covered.</li>
          <li>Figures above are an estimate until the work is complete.</li>
        </ul>
      </div>
    </div>

    <div style="padding:14px 32px;border-top:2px solid ${brand};text-align:center;">
      <div style="font-size:12px;font-weight:700;">Thank you for your business</div>
      ${contact ? `<div style="margin-top:3px;font-size:10px;" class="muted">${escapeHtml(shop)}  |  ${escapeHtml(contact)}</div>` : ''}
    </div>
  </div>

  ${warrantyPage({ ticket, shop, contact, brand, tiers, review })}

<script nonce="${escapeHtml(nonce)}">
  document.getElementById('print').addEventListener('click', function () { window.print(); });
</script>
</body>
</html>`;
}

export { LABEL_SIZES, renderTicketLabel, renderTicketHtml };
