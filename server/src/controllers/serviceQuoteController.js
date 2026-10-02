import { asyncHandler } from '../utils/ApiError.js';
import * as serviceQuoteService from '../services/serviceQuoteService.js';
import auditService from '../services/auditService.js';
import '../models/ServiceQuote.js';
import '../models/Ticket.js';

/**
 * Repair estimates (Sales § Quote, service businesses).
 *
 * Thin, like every controller here. The rules worth not routing around live in
 * the service: totals are recomputed server-side from the lines, an estimate is
 * accepted before it can become a ticket, and converting copies the devices
 * whole rather than summarising them.
 */

const listQuotes = asyncHandler(async (req, res) => {
  res.json(
    await serviceQuoteService.listQuotes({ ...req.query, business: req.businessScope }),
  );
});

const getQuote = asyncHandler(async (req, res) => {
  res.json(await serviceQuoteService.getQuote(req.params.id));
});

const createQuote = asyncHandler(async (req, res) => {
  res
    .status(201)
    .json(await serviceQuoteService.createQuote(req.body, req.user._id, req.businessScope));
});

const updateQuote = asyncHandler(async (req, res) => {
  res.json(await serviceQuoteService.updateQuote(req.params.id, req.body));
});

const setQuoteStatus = asyncHandler(async (req, res) => {
  res.json(await serviceQuoteService.setQuoteStatus(req.params.id, req.body, req.user._id));
});

/**
 * Deleting an estimate destroys what was quoted to a customer, and a converted
 * one cannot be deleted at all - so the number is recorded, because after this
 * call it is the only trace of what was removed.
 */
const deleteQuote = asyncHandler(async (req, res) => {
  const result = await serviceQuoteService.deleteQuote(req.params.id);

  await auditService.record({
    req,
    action: 'serviceQuote.delete',
    entity: { kind: 'serviceQuote', id: req.params.id, label: result.quoteNumber ?? '' },
    description: `Deleted quote ${result.quoteNumber ?? req.params.id}.`,
  });

  res.json(result);
});

/**
 * The customer accepted and arrived with the device.
 *
 * Audited because it starts work and creates a second record: the ticket number
 * is what somebody traces the job by afterwards.
 */
const convertToTicket = asyncHandler(async (req, res) => {
  const result = await serviceQuoteService.convertToTicket(
    req.params.id,
    req.body,
    req.user._id,
  );

  await auditService.record({
    req,
    action: 'serviceQuote.convert',
    entity: {
      kind: 'serviceQuote',
      id: req.params.id,
      label: result.quote?.quoteNumber ?? '',
    },
    description: `Quote ${result.quote?.quoteNumber} became ticket ${result.ticket?.ticketNumber}.`,
  });

  res.status(201).json(result);
});

export { listQuotes, getQuote, createQuote, updateQuote, setQuoteStatus, deleteQuote, convertToTicket };
export default {
  listQuotes,
  getQuote,
  createQuote,
  updateQuote,
  setQuoteStatus,
  deleteQuote,
  convertToTicket,
};
