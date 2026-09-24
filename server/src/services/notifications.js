import env from '../config/env.js';
import { sendMail } from './mailer.js';
import { renderInvoiceHtml, renderInvoiceText, resolveInvoiceBrand } from './invoiceDocument.js';
import { storefrontOrigin } from './linkOrigins.js';

/**
 * Transactional mail the buyer gets without asking for it.
 *
 * Called fire-and-forget from `orderService.placeOrder`: the order is already
 * written and paid by the time this runs, so nothing here is allowed to reject.
 */

/** Emails the invoice for a freshly placed order. Never throws. */
async function sendInvoiceEmail({ invoice, order, user }) {
  if (!user?.email) return { delivered: false, via: null, error: 'No email address on file.' };

  try {
    const brand = await resolveInvoiceBrand(invoice.business);
    const html = renderInvoiceHtml({ invoice, order, user, origin: await storefrontOrigin(), ...brand });
    const text = renderInvoiceText({ invoice, order, shop: brand.shop });

    return await sendMail({
      to: user.email,
      subject: `Invoice ${invoice.number} · order ${order.orderNumber}`,
      html,
      text,
    });
  } catch (error) {
    console.error(`  Mail: invoice ${invoice?.number} could not be built - ${error.message}`);
    return { delivered: false, via: null, error: error.message };
  }
}

export { sendInvoiceEmail };
export default sendInvoiceEmail;
