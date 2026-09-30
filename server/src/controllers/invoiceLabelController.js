import { asyncHandler } from '../utils/ApiError.js';
import invoiceLabelService from '../services/invoiceLabelService.js';
import auditService from '../services/auditService.js';

/**
 * The manual invoice status list, and setting one on an invoice.
 *
 * **Two different permissions, and that is the point.** Editing the LIST is a
 * settings write - it changes the vocabulary every invoice is described in, and
 * a status can carry a message to customers. Setting a label ON an
 * invoice is ordinary sales work somebody at the counter does all day. The
 * routes gate them separately for that reason.
 *
 * Setting a label is audited because it starts the clock on that status's
 * message, and "who set this" is the question asked after the first complaint.
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
          isActive: before.isActive,
        }
      : null,
    after: {
      name: result.label.name,
      colorToken: result.label.colorToken,
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

/** Set or clear the manual status on one invoice. */
const setOnInvoice = asyncHandler(async (req, res) => {
  const result = await invoiceLabelService.setInvoiceLabel(req.params.number, req.body);

  await auditService.record({
    req,
    action: 'invoice.label',
    entity: { kind: 'invoice', id: req.params.number, label: req.params.number },
    after: { label: result.labelName ?? null },
    description: result.cleared
      ? `Cleared the status on invoice ${req.params.number}.`
      : `Set invoice ${req.params.number} to “${result.labelName}”.`,
  });

  res.json(result);
});

export { list, create, update, remove, setOnInvoice };
export default { list, create, update, remove, setOnInvoice };
