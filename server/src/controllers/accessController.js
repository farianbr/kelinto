import { asyncHandler } from '../utils/ApiError.js';
import accessService from '../services/accessService.js';
import auditService from '../services/auditService.js';

/**
 * Businesses, roles and staff accounts (ERP rework §6.14, §6.15/3, §7.6).
 *
 * Thin, like every other controller here. The self-demotion, last-admin and
 * role-in-use rules live in the service so a second route cannot reach around
 * them - the actor's id is the only thing this layer adds, because only the
 * request knows who is asking.
 */

// ---- businesses ----------------------------------------------------------------

/**
 * The tenant whose businesses this request may see.
 *
 * Read from the session rather than the query string, and passed down as the
 * second argument so the service cannot be called unscoped by accident. An
 * account with no tenant predates the control plane and pairs with the
 * businesses that also have none - see `accessService.listBusinesses`.
 */
const tenantOf = (req) => (req.user?.tenant ? String(req.user.tenant) : null);

const listBusinesses = asyncHandler(async (req, res) => {
  res.json(await accessService.listBusinesses(req.query, { tenant: tenantOf(req) }));
});

const getBusiness = asyncHandler(async (req, res) => {
  res.json(await accessService.getBusiness(req.params.id, { tenant: tenantOf(req) }));
});

/** Ask the platform for a web address. Approved in the super-admin console. */
const requestAddress = asyncHandler(async (req, res) => {
  const actor = [req.user?.contactName, req.user?.email].filter(Boolean).join(' · ');
  res.json(
    await accessService.requestAddress(req.params.id, req.body, { tenant: tenantOf(req), actor }),
  );
});

const cancelAddressRequest = asyncHandler(async (req, res) => {
  res.json(await accessService.cancelAddressRequest(req.params.id, { tenant: tenantOf(req) }));
});

const nextBusinessCode = asyncHandler(async (_req, res) => {
  res.json({ code: await accessService.nextBusinessCode() });
});

const createBusiness = asyncHandler(async (req, res) => {
  res.status(201).json(await accessService.createBusiness(req.body));
});

const updateBusiness = asyncHandler(async (req, res) => {
  res.json(await accessService.updateBusiness(req.params.id, req.body));
});

const setDefaultBusiness = asyncHandler(async (req, res) => {
  res.json(await accessService.setDefaultBusiness(req.params.id));
});

const deleteBusiness = asyncHandler(async (req, res) => {
  res.json(await accessService.deleteBusiness(req.params.id));
});

// ---- roles ------------------------------------------------------------------

const listRoles = asyncHandler(async (_req, res) => {
  res.json({ roles: await accessService.listRoles() });
});

/**
 * Roles and staff are audited without exception, and both land in the
 * **security** log (§7.6).
 *
 * These are the routes that decide what everybody else can reach, so "who
 * granted this" is the question the log exists to answer. A permission change
 * that leaves no trace is indistinguishable from one that was never authorised.
 *
 * A role edit belongs beside the staff changes rather than in the activity feed:
 * it is the more powerful of the two, because it changes access for **everyone**
 * holding the role at once rather than for one named account. Splitting them
 * across two screens would mean reconstructing one escalation from two places.
 */
const createRole = asyncHandler(async (req, res) => {
  const role = await accessService.createRole(req.body);

  await auditService.record({
    req,
    kind: 'security',
    action: 'role.create',
    entity: { kind: 'role', id: role.id ?? '', label: role.name },
    after: { name: role.name, areas: role.areas },
    description: `Created the role “${role.name}”.`,
  });

  res.status(201).json(role);
});

const updateRole = asyncHandler(async (req, res) => {
  const before = await accessService.getRoleSnapshot(req.params.id);
  const role = await accessService.updateRole(req.params.id, req.body);

  await auditService.record({
    req,
    kind: 'security',
    action: 'role.update',
    entity: { kind: 'role', id: req.params.id, label: role.name },
    // Areas in full on both sides rather than a per-key diff: the useful
    // question about a permission change is "what does this role allow now",
    // and a row saying only `purchase: view → full` makes the reader go and
    // look up the other six.
    before: { name: before?.name ?? null, areas: before?.areas ?? null },
    after: { name: role.name, areas: role.areas },
    description: `Changed access for the role “${role.name}”.`,
  });

  res.json(role);
});

const deleteRole = asyncHandler(async (req, res) => {
  const before = await accessService.getRoleSnapshot(req.params.id);
  const result = await accessService.deleteRole(req.params.id);

  await auditService.record({
    req,
    kind: 'security',
    action: 'role.delete',
    entity: { kind: 'role', id: req.params.id, label: before?.name ?? '' },
    before: { name: before?.name ?? null, areas: before?.areas ?? null },
    description: `Deleted the role “${before?.name ?? req.params.id}”.`,
  });

  res.json(result);
});

// ---- staff ------------------------------------------------------------------

const listStaff = asyncHandler(async (req, res) => {
  res.json(await accessService.listStaff(req.query));
});

/**
 * Creating a staff account, changing its role and removing it are all **security
 * events**, not merely administrative ones: each changes who can sign in and
 * what they can reach once they do.
 */
const createStaff = asyncHandler(async (req, res) => {
  const staff = await accessService.createStaff(req.body);

  await auditService.record({
    req,
    kind: 'security',
    action: 'staff.create',
    entity: { kind: 'staff', id: staff.id ?? '', label: staff.email },
    // No password anywhere near this: `diff`'s redaction covers the field name,
    // and the payload simply is not passed here.
    after: {
      email: staff.email,
      accountType: staff.accountType,
      role: staff.role?.name ?? null,
      business: staff.business?.name ?? null,
    },
    description: `Created the staff account ${staff.email}.`,
  });

  res.status(201).json(staff);
});

const updateStaff = asyncHandler(async (req, res) => {
  const before = await accessService.getStaffSnapshot(req.params.id);
  const staff = await accessService.updateStaff(req.params.id, req.body, req.user._id);

  await auditService.record({
    req,
    kind: 'security',
    action: 'staff.update',
    entity: { kind: 'staff', id: req.params.id, label: staff.email },
    before,
    after: {
      email: staff.email,
      accountType: staff.accountType,
      role: staff.role?.name ?? null,
      business: staff.business?.name ?? null,
      locked: staff.locked,
    },
    description: `Updated the staff account ${staff.email}.`,
  });

  res.json(staff);
});

const deleteStaff = asyncHandler(async (req, res) => {
  const before = await accessService.getStaffSnapshot(req.params.id);
  const result = await accessService.deleteStaff(req.params.id, req.user._id);

  await auditService.record({
    req,
    kind: 'security',
    action: 'staff.delete',
    entity: { kind: 'staff', id: req.params.id, label: before?.email ?? '' },
    before,
    description: `Removed the staff account ${before?.email ?? req.params.id}.`,
  });

  res.json(result);
});

export { listBusinesses, getBusiness, requestAddress, cancelAddressRequest, nextBusinessCode, createBusiness, updateBusiness, setDefaultBusiness, deleteBusiness, listRoles, createRole, updateRole, deleteRole, listStaff, createStaff, updateStaff, deleteStaff };
