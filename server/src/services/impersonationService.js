import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

import ImpersonationGrant, {
  IMPERSONATION_MINUTES,
  IMPERSONATION_MAX_MINUTES,
} from '../models/ImpersonationGrant.js';
import Business from '../models/Business.js';
import SuperAdmin from '../models/SuperAdmin.js';
import ApiError from '../utils/ApiError.js';
import env from '../config/env.js';
import auditService from './auditService.js';

/**
 * "Step into a business" (SAAS_PLATFORM §4.5, §6 phase 16, invariant 9).
 *
 * **A fourth cookie.** The console's own session stays exactly where it is:
 * entering a business does not consume or replace it, so an operator can leave
 * and still be signed in to the console. That is the whole reason this is
 * separate rather than a mode on the existing token - a single cookie that
 * changed meaning would make "am I inside somebody's business" a question the
 * browser answers differently depending on which tab you are looking at.
 *
 * **Three things are re-read on every request, never trusted from the token:**
 * the grant still exists, it has not been revoked, and it has not expired.
 * A JWT's own `exp` cannot be shortened after it is issued, so revocation would
 * otherwise take up to an hour to bite - which is not revocation.
 *
 * **Entry and exit are both written into the business's own `AuditLog`.**
 * Invariant 9 requires the trail to live where the owner reads it, not only
 * where the platform does. `ImpersonationGrant` is the platform's copy; those
 * two rows are the tenant's.
 */

const IMPERSONATION_COOKIE = `${env.COOKIE_NAME}_impersonation`;

function issueToken(res, grant) {
  const seconds = Math.max(
    60,
    Math.floor((new Date(grant.expiresAt).getTime() - Date.now()) / 1000),
  );

  const token = jwt.sign(
    {
      sub: grant.superAdmin.toString(),
      kind: 'impersonation',
      grant: grant._id.toString(),
      business: grant.business.toString(),
    },
    env.JWT_SECRET,
    { expiresIn: seconds },
  );

  res.cookie(IMPERSONATION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.isProd,
    // Matched to the grant rather than given a round number: a cookie that
    // outlives its grant is a cookie that sends requests guaranteed to be
    // refused, and the UI reads that as a bug rather than as an expiry.
    maxAge: seconds * 1000,
    path: '/',
  });
}

function clearImpersonationSession(res) {
  res.clearCookie(IMPERSONATION_COOKIE, { path: '/' });
}

/**
 * Open a grant and hand back a token for it.
 *
 * `reason` is required by the model and validated here too, so the error is a
 * sentence rather than a Mongoose validation dump.
 */
async function enter(superAdmin, businessId, { reason, minutes } = {}, req, res) {
  const text = String(reason ?? '').trim();
  if (!text) {
    throw ApiError.badRequest(
      'Say why you are stepping into this business. It is written into their own activity log.',
      'IMPERSONATION_REASON_REQUIRED',
    );
  }

  const business = await Business.findById(businessId);
  if (!business) throw ApiError.notFound('Business not found.', 'BUSINESS_NOT_FOUND');

  const requested = Number(minutes) || IMPERSONATION_MINUTES;
  const span = Math.min(Math.max(requested, 5), IMPERSONATION_MAX_MINUTES);

  /**
   * One live grant per operator per business.
   *
   * Re-entering while already inside would mint a second token and a second
   * pair of audit rows, and the exit would close only one of them - leaving a
   * row that reads as an operator who never left. Reusing the open grant is
   * both truthful and what the operator meant.
   */
  const existing = await ImpersonationGrant.findOne({
    superAdmin: superAdmin._id,
    business: business._id,
    endedAt: null,
    expiresAt: { $gt: new Date() },
  });

  if (existing) return deliver(res, existing, { resumed: true });

  const grant = await ImpersonationGrant.create({
    superAdmin: superAdmin._id,
    superAdminName: superAdmin.name,
    superAdminEmail: superAdmin.email,
    business: business._id,
    businessName: business.name,
    tenant: business.tenant,
    reason: text,
    expiresAt: new Date(Date.now() + span * 60 * 1000),
    ip: req?.ip ?? '',
    userAgent: (req?.get?.('user-agent') ?? '').slice(0, 300),
  });

  // The tenant's own copy. Written with the operator as the actor, which is
  // what `actorFrom` produces once `req.impersonation` is set - here it is set
  // by hand because the entry request is made on the console's session, before
  // any impersonation token exists.
  await auditService.record({
    req: { ...req, impersonation: { superAdmin } },
    kind: 'security',
    action: 'impersonation.enter',
    entity: { kind: 'business', id: business._id.toString(), label: business.name },
    description: `Kelinto support entered ${business.name}: ${text}`,
  });

  return deliver(res, grant, { resumed: false });
}

/** Are the super admin and the panel on different hosts? Then no cookie can cross. */
function hostsAreSplit() {
  return Boolean(env.SUPERADMIN_HOST && env.PANEL_HOST && env.SUPERADMIN_HOST !== env.PANEL_HOST);
}

/** How long a handoff link lives. Long enough to follow, short enough to be spent. */
const HANDOFF_SECONDS = 60;

/**
 * Hand the operator the session, wherever the panel is.
 *
 * On one host the cookie is simply set, as it always was. On two, a cookie set
 * here would stay on the super admin host and the panel would never see it - so
 * the grant gets a single-use handoff instead, and the super admin sends the
 * browser to the panel host to claim it (`claim` below).
 */
async function deliver(res, grant, { resumed }) {
  if (!hostsAreSplit()) {
    issueToken(res, grant);
    return { grant: grant.toPublic(), resumed };
  }

  const jti = crypto.randomUUID();
  grant.handoffJti = jti;
  await grant.save();

  const token = jwt.sign(
    { kind: 'impersonation-handoff', grant: grant._id.toString(), jti },
    env.JWT_SECRET,
    { expiresIn: HANDOFF_SECONDS },
  );

  return {
    grant: grant.toPublic(),
    resumed,
    handoffUrl: `${env.originFor(env.PANEL_HOST)}/api/impersonation/claim?t=${encodeURIComponent(token)}`,
  };
}

/**
 * Turn a handoff link into the support session, on the panel's host.
 *
 * **Single use.** The grant's `handoffJti` is cleared in the same update that
 * matches it, so two claims of one link cannot both succeed, and a link read
 * out of a browser history later finds nothing to match. A grant that has
 * ended or expired since the link was minted is refused the same way.
 *
 * Returns whether a session was issued; the caller decides where to send the
 * browser either way.
 */
async function claim(token, res) {
  let payload;
  try {
    payload = jwt.verify(String(token ?? ''), env.JWT_SECRET);
  } catch {
    return false;
  }
  if (payload?.kind !== 'impersonation-handoff' || !payload.jti) return false;

  const grant = await ImpersonationGrant.findOneAndUpdate(
    { _id: payload.grant, handoffJti: payload.jti },
    { $set: { handoffJti: null } },
    { new: true },
  );
  if (!grant || !grant.isLive()) return false;

  issueToken(res, grant);
  return true;
}

/**
 * Close a grant.
 *
 * Idempotent: leaving twice, or leaving something already revoked, is not an
 * error. The operator's intent - "I am out" - is satisfied either way, and
 * failing the second call would leave a cookie nobody can clear.
 */
async function leave(grantId, res, { reason = 'left', req } = {}) {
  clearImpersonationSession(res);

  const grant = await ImpersonationGrant.findById(grantId);
  if (!grant || grant.endedAt) return { ok: true };

  grant.endedAt = new Date();
  grant.endedReason = reason;
  await grant.save();

  await auditService.record({
    req: {
      ...req,
      impersonation: {
        superAdmin: {
          _id: grant.superAdmin,
          name: grant.superAdminName,
          email: grant.superAdminEmail,
        },
      },
    },
    kind: 'security',
    action: reason === 'revoked' ? 'impersonation.revoked' : 'impersonation.leave',
    entity: { kind: 'business', id: grant.business.toString(), label: grant.businessName },
    description:
      reason === 'revoked'
        ? `Kelinto support access to ${grant.businessName} was revoked.`
        : `Kelinto support left ${grant.businessName}.`,
  });

  return { ok: true };
}

/**
 * Resolve a token into a live grant, or null.
 *
 * Returns null for every failure rather than throwing: an expired grant is a
 * signed-out state, exactly as an expired session cookie is, and the middleware
 * above treats it that way.
 */
async function resolve(token) {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET);
    if (payload.kind !== 'impersonation') return null;

    const grant = await ImpersonationGrant.findById(payload.grant);
    if (!grant || !grant.isLive()) return null;

    // The token names a business; so does the grant. They can only disagree if
    // a token was edited, and the grant is the authority.
    if (String(grant.business) !== String(payload.business)) return null;

    const superAdmin = await SuperAdmin.findById(grant.superAdmin);
    if (!superAdmin?.isActive) return null;

    return { grant, superAdmin, business: grant.business.toString() };
  } catch {
    return null;
  }
}

/** Every grant, newest first - the console's support history. */
async function list({ business, live } = {}) {
  const filter = {};
  if (business) filter.business = business;
  if (live) {
    filter.endedAt = null;
    filter.expiresAt = { $gt: new Date() };
  }

  const grants = await ImpersonationGrant.find(filter).sort({ startedAt: -1 }).limit(200);
  return { grants: grants.map((grant) => grant.toPublic()) };
}

/** Close somebody else's grant. Same path as leaving, different reason. */
async function revoke(grantId, req) {
  const grant = await ImpersonationGrant.findById(grantId);
  if (!grant) throw ApiError.notFound('No such grant.', 'GRANT_NOT_FOUND');

  // `leave` clears a cookie on the response, which is the revoking operator's
  // own - not the revoked operator's. Passing a throwaway keeps the two apart:
  // the revoked session dies because the grant is closed, not because a cookie
  // was removed from a browser this request never touches.
  await leave(grantId, { clearCookie: () => {} }, { reason: 'revoked', req });
  return { ok: true };
}

export {
  IMPERSONATION_COOKIE,
  claim,
  clearImpersonationSession,
  enter,
  leave,
  list,
  resolve,
  revoke,
};
