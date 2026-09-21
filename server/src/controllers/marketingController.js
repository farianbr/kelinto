import { asyncHandler } from '../utils/ApiError.js';
import marketingService from '../services/marketingService.js';
import auditService from '../services/auditService.js';

/**
 * Marketing - calls, SMS, WhatsApp, email campaigns and consent (§6.13, phase 9).
 *
 * Thin, like every other controller here. Two things this layer adds and the
 * service cannot: the acting staff member, taken from the session so a message
 * can never claim to be from somebody else, and the channel, which comes from
 * the route rather than the body - a request must not be able to nominate the
 * channel it is sent on.
 */

// ---- messages ---------------------------------------------------------------

const listMessages = asyncHandler(async (req, res) => {
  res.json(await marketingService.listMessages(req.query));
});

/**
 * One handler per channel, each closing over its own channel name.
 *
 * The alternative - reading `req.body.channel` - would let a caller compose on
 * the SMS screen and have it sent as email. The route knows which screen it
 * serves; the body does not get a vote.
 */
const composer = (channel) =>
  asyncHandler(async (req, res) => {
    res.status(201).json(await marketingService.sendMessage(channel, req.body, req.user));
  });

const sendSms = composer('sms');
const sendWhatsapp = composer('whatsapp');
const sendEmail = composer('email');
const logCall = composer('call');
/**
 * A note said to the customer, not about them.
 *
 * Same shape as a logged call - nothing transmits, the row lands `logged` - and
 * deliberately NOT the internal-notes endpoint: that writes to `User`, is
 * staff-only and the customer never sees it. This is contact history, and the
 * customer portal shows it.
 */
const logNote = composer('note');

// ---- templates --------------------------------------------------------------

const listTemplates = asyncHandler(async (req, res) => {
  res.json(await marketingService.listTemplates(req.query));
});

const createTemplate = asyncHandler(async (req, res) => {
  res.status(201).json(await marketingService.createTemplate(req.body, req.user));
});

const updateTemplate = asyncHandler(async (req, res) => {
  res.json(await marketingService.updateTemplate(req.params.id, req.body));
});

const deleteTemplate = asyncHandler(async (req, res) => {
  res.json(await marketingService.deleteTemplate(req.params.id));
});

// ---- campaigns --------------------------------------------------------------

const listCampaigns = asyncHandler(async (req, res) => {
  res.json(await marketingService.listCampaigns(req.query));
});

const getCampaign = asyncHandler(async (req, res) => {
  res.json(await marketingService.getCampaign(req.params.id));
});

const createCampaign = asyncHandler(async (req, res) => {
  res.status(201).json(await marketingService.createCampaign(req.body, req.user));
});

const updateCampaign = asyncHandler(async (req, res) => {
  res.json(await marketingService.updateCampaign(req.params.id, req.body));
});

const deleteCampaign = asyncHandler(async (req, res) => {
  res.json(await marketingService.deleteCampaign(req.params.id));
});

const sendCampaign = asyncHandler(async (req, res) => {
  res.json(await marketingService.sendCampaign(req.params.id, req.user));
});

// ---- consent ----------------------------------------------------------------

const listUnsubscribes = asyncHandler(async (req, res) => {
  res.json(await marketingService.listUnsubscribes(req.query));
});

const resubscribe = asyncHandler(async (req, res) => {
  res.json(await marketingService.resubscribe(req.params.id));
});

/**
 * The public unsubscribe. No session, by design - see the service. The HMAC in
 * the link is what authorises it.
 */
const unsubscribe = asyncHandler(async (req, res) => {
  res.json(await marketingService.unsubscribe(req.body.u, req.body.t));
});

// ---- overview ---------------------------------------------------------------

const summary = asyncHandler(async (_req, res) => {
  res.json(await marketingService.summary());
});

const listLimits = asyncHandler(async (_req, res) => {
  res.json(await marketingService.listLimits());
});

/**
 * Changing a send cap is audited.
 *
 * It decides how many customers can be contacted before the system refuses,
 * so raising one is exactly the change somebody would want a record of after
 * an incident.
 */
const saveLimit = asyncHandler(async (req, res) => {
  const result = await marketingService.saveLimit(req.body);

  await auditService.recordChange({
    req,
    action: 'marketing.limit.save',
    entity: { kind: 'setting', id: `limit:${req.body.channel}`, label: `${req.body.channel} send cap` },
    before: null,
    after: { daily: req.body.daily, monthly: req.body.monthly },
    description: `Set the ${req.body.channel} send cap to ${req.body.daily} a day, ${req.body.monthly} a month.`,
  });

  res.json(result);
});

export { listMessages, sendSms, sendWhatsapp, sendEmail, logCall, logNote, listTemplates, createTemplate, updateTemplate, deleteTemplate, listCampaigns, getCampaign, createCampaign, updateCampaign, deleteCampaign, sendCampaign, listUnsubscribes, resubscribe, unsubscribe, summary, listLimits, saveLimit };
