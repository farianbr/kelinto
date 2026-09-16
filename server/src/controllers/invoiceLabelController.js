import { asyncHandler } from '../utils/ApiError.js';
import invoiceLabelService from '../services/invoiceLabelService.js';
import auditService from '../services/auditService.js';

/**
 * The manual invoice status list, and setting one on an invoice.
 *
 * **Two different permissions, and that is the point.** Editing the LIST is a
 * settings write - it changes the vocabulary every invoice is described in, and
 * ticking `sendsWarrantyEmail` arms an automatic email. Setting a label ON an
 * invoice is ordinary sales work somebody at the counter does all day. The
 * routes gate them separately for that reason.
 *
 * Setting a label is audited because it can send mail to a customer, and "who
 * caused this email" is the question asked after the first complaint.
 */

// ---- the list (Settings) ----------------------------------------------------

const list = asyncHandler(async (req, res) => {
  res.json(await invoiceLabelService.listLabels({ status: req.query.status }));
});

const create = asyncHandler(async (req, res) => {
  const result = await invoiceLabelService.createLabel(req.body, req.user?._id);

  await auditService.record({
    req,
    action: 'invoice_label.create',
    entity: { kind: 'invoiceLabel', id: result.label.id, label: result.label.name },
    after: {
      colorToken: result.label.colorToken,
      sendsWarrantyEmail: result.label.sendsWarrantyEmail,
      isActive: result.label.isActive,
    },
    description: `Added the invoice status “${result.label.name}”.`,
  });

  res.status(201).json(result);
});

const update = asyncHandler(async (req, res) => {
  const before = (await invoiceLabelService.listLabels({ status: 'all' })).labels.find(
    (row) => row.id === req.params.id,
  );
  const result = await invoiceLabelService.updateLabel(req.params.id, req.body);

  await auditService.recordChange({
    req,
    action: 'invoice_label.update',
    entity: { kind: 'invoiceLabel', id: req.params.id, label: result.label.name },
    before: before
      ? {
          name: before.name,
          colorToken: before.colorToken,
          sendsWarrantyEmail: before.sendsWarrantyEmail,
          isActive: before.isActive,
        }
      : null,
    after: {
      name: result.label.name,
      colorToken: result.label.colorToken,
      sendsWarrantyEmail: result.label.sendsWarrantyEmail,
      isActive: result.label.isActive,
    },
    description: `Updated the invoice status “${result.label.name}”.`,
  });

  res.json(result);
});

const remove = asyncHandler(async (req, res) => {
  const result = await invoiceLabelService.deleteLabel(req.params.id);

  await auditService.record({
    req,
    action: 'invoice_label.delete',
    entity: { kind: 'invoiceLabel', id: req.params.id, label: result.name },
    description: `Deleted the invoice status “${result.name}”.`,
  });

  res.json(result);
});

// ---- setting one on an invoice (Sales) --------------------------------------

/**
 * Set or clear the manual status on one invoice.
 *
 * The audit line says whether the warranty email actually went out, not whether
 * it was meant to: the service reports `emailed`, and a failed send must not be
 * recorded as a delivery.
 */
const setOnInvoice = asyncHandler(async (req, res) => {
  const result = await invoiceLabelService.setInvoiceLabel(req.params.number, req.body);

  await auditService.record({
    req,
    action: 'invoice.label',
    entity: { kind: 'invoice', id: req.params.number, label: req.params.number },
    after: { label: result.labelName ?? null, warrantyEmailed: result.emailed },
    description: result.cleared
      ? `Cleared the status on invoice ${req.params.number}.`
      : `Set invoice ${req.params.number} to “${result.labelName}”` +
        (result.emailed ? ' and sent the warranty email.' : '.'),
  });

  res.json(result);
});

export { list, create, update, remove, setOnInvoice };
export default { list, create, update, remove, setOnInvoice };
