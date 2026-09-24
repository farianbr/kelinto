import { randomBytes } from 'node:crypto';
import { asyncHandler } from '../utils/ApiError.js';
import env from '../config/env.js';
import * as accountService from '../services/accountService.js';
import { storefrontOrigin } from '../services/linkOrigins.js';

const summary = asyncHandler(async (req, res) => {
  res.json(await accountService.summary(req.user));
});

const updateProfile = asyncHandler(async (req, res) => {
  const user = await accountService.updateProfile(req.user, req.body);
  res.json({ user: user.toPublic() });
});

const addAddress = asyncHandler(async (req, res) => {
  const user = await accountService.addAddress(req.user, req.body);
  res.status(201).json({ user: user.toPublic() });
});

const updateAddress = asyncHandler(async (req, res) => {
  const user = await accountService.updateAddress(req.user, req.params.addressId, req.body);
  res.json({ user: user.toPublic() });
});

const removeAddress = asyncHandler(async (req, res) => {
  const user = await accountService.removeAddress(req.user, req.params.addressId);
  res.json({ user: user.toPublic() });
});

const addPaymentMethod = asyncHandler(async (req, res) => {
  const user = await accountService.addPaymentMethod(req.user, req.body);
  res.status(201).json({ user: user.toPublic() });
});

const removePaymentMethod = asyncHandler(async (req, res) => {
  const user = await accountService.removePaymentMethod(req.user, req.params.methodId);
  res.json({ user: user.toPublic() });
});

const changePassword = asyncHandler(async (req, res) => {
  await accountService.changePassword(req.user, req.body);
  res.status(204).end();
});

const listInvoices = asyncHandler(async (req, res) => {
  res.json(await accountService.listInvoices(req.user._id));
});

const getInvoice = asyncHandler(async (req, res) => {
  res.json({ invoice: await accountService.getInvoice(req.user._id, req.params.number) });
});

/**
 * The invoice as a printable page rather than JSON - the dashboard's PDF button
 * opens it and the browser's print dialog does the rest.
 *
 * Helmet's global CSP forbids inline script, and the page needs exactly one
 * line of it for the print button. Rather than loosening the policy for the
 * whole app, this response carries its own: nothing loads, and the one nonced
 * script may run.
 */
const invoiceDocument = asyncHandler(async (req, res) => {
  const nonce = randomBytes(16).toString('base64');
  const html = await accountService.invoiceDocument(req.user, req.params.number, {
    nonce,
    // The browser copy gets an origin too, so an unpaid document can link back
    // to the screen that pays it. It is a link and not a form on purpose: the
    // CSP below sets `form-action 'none'`, and loosening that to let an invoice
    // post somewhere would undo the point of giving this response its own
    // policy at all.
    //
    // The business's storefront rather than this request's own host: the
    // document is served by the API, and the link has to land where `/account`
    // is (`linkOrigins.storefrontOrigin`).
    origin: await storefrontOrigin(),
  });

  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'none'",
      "style-src 'unsafe-inline'",
      "img-src data:",
      `script-src 'nonce-${nonce}'`,
      "base-uri 'none'",
      "form-action 'none'",
    ].join('; '),
  );
  res.type('html').send(html);
});

const storeCredit = asyncHandler(async (req, res) => {
  res.json(await accountService.storeCreditStatement(req.user._id));
});

const creditActivity = asyncHandler(async (req, res) => {
  res.json(await accountService.lineOfCreditActivity(req.user));
});

const rechargeStoreCredit = asyncHandler(async (req, res) => {
  res.status(201).json(await accountService.rechargeStoreCredit(req.user, req.body));
});

const payInvoice = asyncHandler(async (req, res) => {
  res.status(201).json(await accountService.payInvoice(req.user, req.params.number, req.body));
});

const payOffCredit = asyncHandler(async (req, res) => {
  res.status(201).json(await accountService.payOffCredit(req.user, req.body));
});

const activity = asyncHandler(async (req, res) => {
  res.json(await accountService.activity(req.user._id));
});

/**
 * The activity page. Filters and paging arrive as query params rather than in a
 * body because this is a GET that a buyer can bookmark and reload.
 *
 * An unknown `kind` falls through to `all` in the service rather than erroring:
 * a stale bookmark should show the buyer their history, not a validation
 * failure about a filter they cannot see.
 */
const activityPage = asyncHandler(async (req, res) => {
  const { kind, from, to, page, limit } = req.query;
  res.json(
    await accountService.activityPage(req.user._id, {
      kind,
      from: from || null,
      to: to || null,
      page,
      limit,
    }),
  );
});

const referrals = asyncHandler(async (req, res) => {
  res.json(await accountService.referrals(req.user));
});

export { summary, updateProfile, addAddress, updateAddress, removeAddress, addPaymentMethod, removePaymentMethod, changePassword, listInvoices, getInvoice, invoiceDocument, storeCredit, creditActivity, rechargeStoreCredit, payInvoice, payOffCredit, activity, activityPage, referrals };
