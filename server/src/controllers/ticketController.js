import { randomBytes } from 'node:crypto';

import { asyncHandler } from '../utils/ApiError.js';
import * as ticketService from '../services/ticketService.js';
import auditService from '../services/auditService.js';

/**
 * The job label and the ticket document.
 *
 * Same per-response CSP as the invoice document, and for the same reason:
 * Helmet's global policy forbids inline script, each page needs exactly one
 * line of it for its print button, and loosening the policy app-wide to serve
 * two documents would be the wrong trade. Nothing loads; the one nonced script
 * may run.
 *
 * `kind` picks the render. They share a route because they share a record, a
 * lookup and this entire security preamble - two routes would be two places to
 * keep that in step.
 */
const ticketDocument = asyncHandler(async (req, res) => {
  const nonce = randomBytes(16).toString('base64');

  const html = await ticketService.ticketDocumentHtml(req.params.id, {
    kind: req.query.kind === 'label' ? 'label' : 'document',
    size: req.query.size,
    nonce,
    businessId: req.businessScope,
  });

  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'none'",
      "style-src 'unsafe-inline'",
      'img-src data:',
      `script-src 'nonce-${nonce}'`,
      "base-uri 'none'",
      "form-action 'none'",
    ].join('; '),
  );
  res.type('html').send(html);
});

/**
 * Repair tickets (Sales § Ticket).
 *
 * Thin, like every controller here. The two rules worth not routing around live
 * in the service: a status move always lands on the ticket timeline, and the
 * estimate is an estimate - nothing in this path bills anyone.
 */

const listTickets = asyncHandler(async (req, res) => {
  res.json(await ticketService.listTickets({ ...req.query, business: req.businessScope }));
});

const getTicket = asyncHandler(async (req, res) => {
  res.json(await ticketService.getTicket(req.params.id));
});

const createTicket = asyncHandler(async (req, res) => {
  res.status(201).json(await ticketService.createTicket(req.body, req.user._id, req.businessScope));
});

const updateTicket = asyncHandler(async (req, res) => {
  res.json(await ticketService.updateTicket(req.params.id, req.body, req.user._id));
});

const setTicketStatus = asyncHandler(async (req, res) => {
  res.json(await ticketService.setTicketStatus(req.params.id, req.body, req.user._id));
});

/**
 * A person has finished a kiosk check-in.
 *
 * Deliberately its own call rather than a side effect of editing: a staff member
 * who priced the job and assigned a technician has reviewed it, one who fixed a
 * typo has not, and a flag clearing itself on any edit would empty the queue
 * without anybody having looked at the device.
 */
const markReviewed = asyncHandler(async (req, res) => {
  res.json(await ticketService.markReviewed(req.params.id, req.user._id));
});

/**
 * Deleting a ticket destroys the repair history for a device, so it is audited
 * with actor and IP - the ticket number is recorded because after this call it
 * is the only trace left of what was removed.
 */
const deleteTicket = asyncHandler(async (req, res) => {
  const result = await ticketService.deleteTicket(req.params.id, req.user._id);

  await auditService.record({
    req,
    action: 'ticket.delete',
    entity: { kind: 'ticket', id: req.params.id, label: result.ticketNumber ?? '' },
    description: `Deleted ticket ${result.ticketNumber ?? req.params.id}.`,
  });

  res.json(result);
});

const recordDeposit = asyncHandler(async (req, res) => {
  const result = await ticketService.recordDeposit(req.params.id, req.body, req.user);

  await auditService.record({
    req,
    action: 'ticket.deposit',
    entity: { kind: 'ticket', id: req.params.id, label: result.ticket.ticketNumber },
    description: `Recorded a deposit on ${result.ticket.ticketNumber}.`,
  });

  res.json(result);
});

const removeDeposit = asyncHandler(async (req, res) => {
  const result = await ticketService.removeDeposit(req.params.id, req.params.depositId);

  await auditService.record({
    req,
    action: 'ticket.deposit.remove',
    entity: { kind: 'ticket', id: req.params.id, label: result.ticket.ticketNumber },
    description: `Removed a deposit from ${result.ticket.ticketNumber}.`,
  });

  res.json(result);
});

const convertToInvoice = asyncHandler(async (req, res) => {
  const result = await ticketService.convertToInvoice(req.params.id, req.body, req.user);

  await auditService.record({
    req,
    action: 'ticket.convert',
    entity: { kind: 'ticket', id: req.params.id, label: result.ticket.ticketNumber },
    description: `${result.ticket.ticketNumber} became invoice ${result.invoice.number}.`,
  });

  res.json(result);
});

export {
  listTickets,
  getTicket,
  createTicket,
  updateTicket,
  setTicketStatus,
  markReviewed,
  ticketDocument,
  deleteTicket,
  recordDeposit,
  removeDeposit,
  convertToInvoice,
};
