import { asyncHandler } from '../utils/ApiError.js';
import * as superAdminService from '../services/superAdminService.js';
import * as impersonationService from '../services/impersonationService.js';
import * as supportService from '../services/supportService.js';

/**
 * The super-admin console (SAAS_PLATFORM §4.5, §6).
 *
 * Every handler below reads `req.superAdmin`, which only
 * `middleware/superAdminAuth.js` sets - never `req.user`, never `req.supplier`.
 * That is what keeps a signed-in admin or supplier out of the console by
 * holding the wrong cookie, and a super admin out of everything else.
 */

const login = asyncHandler(async (req, res) => {
  res.json(await superAdminService.login(req.body, res));
});

const logout = asyncHandler(async (_req, res) => {
  res.json(superAdminService.logout(res));
});

/** Who is signed in. `null` rather than a 401 - the shell asks on every load. */
const me = asyncHandler(async (req, res) => {
  res.json({ admin: req.superAdmin ? req.superAdmin.toPublic() : null });
});

// ---- tenants ----------------------------------------------------------------

const listTenants = asyncHandler(async (_req, res) => {
  res.json(await superAdminService.listTenants());
});

const createTenant = asyncHandler(async (req, res) => {
  res.status(201).json(await superAdminService.createTenant(req.body));
});

const updateTenant = asyncHandler(async (req, res) => {
  res.json(await superAdminService.updateTenant(req.params.id, req.body));
});

const setSlots = asyncHandler(async (req, res) => {
  res.json(await superAdminService.setSlots(req.params.id, req.body));
});

// ---- businesses -------------------------------------------------------------

const createBusiness = asyncHandler(async (req, res) => {
  res.status(201).json(await superAdminService.createBusiness(req.params.id, req.body));
});

const assignBusiness = asyncHandler(async (req, res) => {
  res.json(await superAdminService.assignBusiness(req.params.id, req.body));
});

// ---- features ---------------------------------------------------------------

const getBusinessFeatures = asyncHandler(async (req, res) => {
  res.json(await superAdminService.getBusinessFeatures(req.params.id));
});

const setBusinessFeature = asyncHandler(async (req, res) => {
  res.json(await superAdminService.setBusinessFeature(req.params.id, req.body));
});

// ---- owner provisioning -----------------------------------------------------

/**
 * Create the tenant's administrator and email them an invitation.
 *
 * `origin` is passed through so the reset link points at the host the operator
 * is actually using - a link to the production domain is useless to somebody
 * setting a tenant up on staging.
 */
const createOwner = asyncHandler(async (req, res) => {
  res.status(201).json(
    await superAdminService.createOwner(req.params.id, req.body, {
      origin: req.get('origin'),
    }),
  );
});

/** Send a fresh invitation - for one that expired, or never arrived. */
const resendOwnerInvite = asyncHandler(async (req, res) => {
  res.json(
    await superAdminService.resendOwnerInvite(req.params.id, { origin: req.get('origin') }),
  );
});

// ---- impersonation ----------------------------------------------------------

/**
 * Step into a business.
 *
 * Performed on the **console** session - `requireSuperAdmin` guards the route
 * and it mints a separate cookie rather than replacing that session, so leaving
 * returns the operator to a console they never signed out of.
 */
const enterBusiness = asyncHandler(async (req, res) => {
  res.json(
    await impersonationService.enter(req.superAdmin, req.params.id, req.body, req, res),
  );
});

/**
 * Leave.
 *
 * Deliberately **not** behind `requireSuperAdmin`: the console session may have
 * expired while the operator was inside a business, and somebody in that state
 * must still be able to get out. The impersonation cookie is the authority
 * here, and `leave` is idempotent when there is nothing to close.
 */
const leaveBusiness = asyncHandler(async (req, res) => {
  const grantId = req.impersonation?.grant?._id ?? null;
  res.json(await impersonationService.leave(grantId, res, { req }));
});

/**
 * The panel host's half of stepping in when the console is on another host.
 *
 * A browser navigation, not a fetch, so it answers with a redirect: into the
 * panel with the session set, or to the panel's sign-in page when the link was
 * spent, expired or never valid. Nothing is said about why - the operator can
 * step in again from the console, and a link somebody else found says nothing.
 */
const claimImpersonation = asyncHandler(async (req, res) => {
  const ok = await impersonationService.claim(req.query.t, res);
  res.redirect(302, ok ? '/admin' : '/');
});

/** The support history, and who is inside something right now. */
const listImpersonations = asyncHandler(async (req, res) => {
  res.json(await impersonationService.list(req.query));
});

/** Close somebody else's session. */
const revokeImpersonation = asyncHandler(async (req, res) => {
  res.json(await impersonationService.revoke(req.params.id, req));
});

// ---- support threads --------------------------------------------------------

const listThreads = asyncHandler(async (req, res) => {
  res.json(await supportService.listThreads(req.query));
});

/** One tenant's conversation. Opening it marks it read for the platform. */
const getThread = asyncHandler(async (req, res) => {
  res.json(await supportService.getThread(req.params.id));
});

const replyToThread = asyncHandler(async (req, res) => {
  res.json(await supportService.replyAsPlatform(req.params.id, req.superAdmin, req.body));
});

const resolveThread = asyncHandler(async (req, res) => {
  res.json(await supportService.resolveThread(req.params.id));
});

// ---- plans ------------------------------------------------------------------

/** Plans, with how many tenants each one carries. */
const listPlans = asyncHandler(async (_req, res) => {
  res.json(await superAdminService.listPlansWithUsage());
});

/** The public price list, for kelinto.com. No session: it is a price list. */
const listPublicPlans = asyncHandler(async (_req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.json(await superAdminService.listPublicPlans());
});

const updatePlan = asyncHandler(async (req, res) => {
  res.json(await superAdminService.updatePlan(req.params.id, req.body));
});

/** `enabled: null` clears the default rather than switching the feature off. */
const setPlanFeature = asyncHandler(async (req, res) => {
  res.json(await superAdminService.setPlanFeature(req.params.id, req.body));
});

// ---- business lifecycle -----------------------------------------------------

/** A tenant's requested address: approve makes it live, reject records why. */
const approveAddressRequest = asyncHandler(async (req, res) => {
  res.json(await superAdminService.approveAddressRequest(req.params.id));
});

const rejectAddressRequest = asyncHandler(async (req, res) => {
  res.json(await superAdminService.rejectAddressRequest(req.params.id, req.body));
});

/** Slug and custom domain - where the business answers. */
const setBusinessAddress = asyncHandler(async (req, res) => {
  res.json(await superAdminService.setBusinessAddress(req.params.id, req.body));
});

const setBusinessStatus = asyncHandler(async (req, res) => {
  res.json(await superAdminService.setBusinessStatus(req.params.id, req.body));
});

/** Soft, with a retention window - the slot stays spent until it closes. */
const deleteBusiness = asyncHandler(async (req, res) => {
  res.json(await superAdminService.deleteBusiness(req.params.id));
});

const restoreBusiness = asyncHandler(async (req, res) => {
  res.json(await superAdminService.restoreBusiness(req.params.id));
});

const createPlan = asyncHandler(async (req, res) => {
  res.status(201).json(await superAdminService.createPlan(req.body));
});

export {
  assignBusiness,
  createBusiness,
  createOwner,
  createPlan,
  createTenant,
  deleteBusiness,
  enterBusiness,
  getBusinessFeatures,
  getThread,
  claimImpersonation,
  leaveBusiness,
  listImpersonations,
  listPlans,
  listPublicPlans,
  listThreads,
  listTenants,
  login,
  logout,
  me,
  resendOwnerInvite,
  replyToThread,
  resolveThread,
  restoreBusiness,
  revokeImpersonation,
  setBusinessFeature,
  approveAddressRequest,
  rejectAddressRequest,
  setBusinessAddress,
  setBusinessStatus,
  setPlanFeature,
  setSlots,
  updatePlan,
  updateTenant,
};
