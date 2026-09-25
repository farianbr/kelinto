import SupportThread from '../models/SupportThread.js';
import Tenant from '../models/Tenant.js';
import Business from '../models/Business.js';
import ApiError from '../utils/ApiError.js';

/**
 * Support conversations between a tenant and the platform (SAAS_PLATFORM §4.5).
 *
 * **Two callers, two identities, one thread.** The console writes as a
 * `SuperAdmin`; the tenant's panel writes as a `User` inside one of their
 * businesses. Neither knows about the other's session, and this is the only
 * place that maps both onto the same conversation.
 *
 * **The tenant is resolved from the business, never from the request.** A panel
 * user has no tenant id to send and must not be trusted with one if they did
 * `?tenant=` would be an invitation to read somebody else's thread. The chain
 * is `req.businessScope` → `Business.tenant` → thread, all server-side.
 *
 * **How many messages a thread keeps** is decided here rather than in the
 * schema, so raising the cap later is a constant change rather than a
 * migration.
 */

/** Beyond this, the oldest messages fall off. Generous: threads are small. */
const MAX_MESSAGES = 500;

/**
 * The tenant behind a request, or null.
 *
 * Null is a real answer and not an error: Cellvix and CellShoppe belong to no
 * tenant, so their staff have nobody to talk to and the screen should say so
 * rather than fail.
 */
async function tenantForRequest(req) {
  const scope = req?.businessScope;
  if (!scope) return null;

  const business = await Business.findById(scope).select('tenant').lean();
  if (!business?.tenant) return null;

  return Tenant.findById(business.tenant).select('name').lean();
}

/**
 * Find or create a tenant's thread.
 *
 * Created lazily on first use rather than alongside the tenant: a tenant that
 * never contacts us should not carry an empty conversation, and creating it on
 * demand means a tenant made before this existed gets one the moment it is
 * needed.
 */
async function threadFor(tenantId, tenantName = '') {
  const existing = await SupportThread.findOne({ tenant: tenantId });
  if (existing) return existing;

  return SupportThread.create({ tenant: tenantId, tenantName, messages: [] });
}

/**
 * Post a message.
 *
 * **Posting reopens a resolved thread.** Somebody replying to a conversation
 * marked resolved is saying it was not; leaving the status alone would hide
 * their message from a console filtered to open threads, which is the one place
 * it needed to appear.
 */
async function post(thread, { side, author, authorName, authorEmail, body, business, businessName }) {
  const text = String(body ?? '').trim();
  if (!text) throw ApiError.badRequest('Write something first.', 'MESSAGE_EMPTY');

  thread.messages.push({
    side,
    author: author ?? null,
    authorName: authorName ?? '',
    authorEmail: authorEmail ?? '',
    body: text,
    business: business ?? null,
    businessName: businessName ?? '',
    createdAt: new Date(),
  });

  if (thread.messages.length > MAX_MESSAGES) {
    thread.messages = thread.messages.slice(-MAX_MESSAGES);
  }

  thread.lastMessageAt = new Date();
  thread.status = 'open';

  /**
   * The sender has, by definition, seen their own message.
   *
   * Without this the author's own post would count as unread to them the moment
   * they sent it, and the badge would never reach zero.
   */
  if (side === 'platform') thread.platformReadAt = thread.lastMessageAt;
  else thread.tenantReadAt = thread.lastMessageAt;

  await thread.save();
  return thread;
}

// ---- the platform side ------------------------------------------------------

/** Every thread, newest activity first, for the console's Support section. */
async function listThreads({ status } = {}) {
  const filter = {};
  if (status) filter.status = status;

  const threads = await SupportThread.find(filter).sort({ lastMessageAt: -1 }).limit(200);

  return {
    threads: threads.map((thread) => ({
      id: thread._id.toString(),
      tenant: thread.tenant?.toString() ?? null,
      tenantName: thread.tenantName,
      status: thread.status,
      lastMessageAt: thread.lastMessageAt,
      unread: thread.unreadFor('platform'),
      // The list shows a preview; the thread screen fetches the whole
      // conversation. Sending every message of every thread to render a list
      // would be most of the collection on one request.
      preview: thread.messages.at(-1)?.body?.slice(0, 140) ?? '',
      messageCount: thread.messages.length,
    })),
  };
}

/** One tenant's conversation, marked read for the platform. */
async function getThread(tenantId) {
  const tenant = await Tenant.findById(tenantId).select('name').lean();
  if (!tenant) throw ApiError.notFound('Tenant not found.', 'TENANT_NOT_FOUND');

  const thread = await threadFor(tenantId, tenant.name);

  // Opening a thread is reading it. Written on read rather than through a
  // separate call, so a console that forgets to mark it cannot exist.
  thread.platformReadAt = new Date();
  await thread.save();

  return { thread: thread.toPublic('platform') };
}

/** Reply as the platform. */
async function replyAsPlatform(tenantId, superAdmin, { body, business }) {
  const tenant = await Tenant.findById(tenantId).select('name').lean();
  if (!tenant) throw ApiError.notFound('Tenant not found.', 'TENANT_NOT_FOUND');

  let businessName = '';
  if (business) {
    const row = await Business.findById(business).select('name tenant').lean();
    // A message cannot be pinned to a business the tenant does not own - that
    // would name somebody else's shop in their conversation.
    if (!row || String(row.tenant) !== String(tenantId)) {
      throw ApiError.badRequest('That business does not belong to this tenant.', 'BUSINESS_NOT_IN_TENANT');
    }
    businessName = row.name;
  }

  const thread = await post(await threadFor(tenantId, tenant.name), {
    side: 'platform',
    author: superAdmin._id,
    authorName: superAdmin.name,
    authorEmail: superAdmin.email,
    body,
    business: business || null,
    businessName,
  });

  return { thread: thread.toPublic('platform') };
}

/** Close a thread. Reopened by anybody posting to it. */
async function resolveThread(tenantId) {
  const thread = await SupportThread.findOne({ tenant: tenantId });
  if (!thread) throw ApiError.notFound('No such thread.', 'THREAD_NOT_FOUND');

  thread.status = 'resolved';
  await thread.save();
  return { thread: thread.toPublic('platform') };
}

// ---- the tenant side --------------------------------------------------------

/**
 * The signed-in tenant's own conversation.
 *
 * Returns `thread: null` rather than failing when the business belongs to no
 * tenant - the screen renders an explanation, which is better than an error for
 * a state that is entirely normal for Cellvix today.
 */
async function getMyThread(req) {
  const tenant = await tenantForRequest(req);
  if (!tenant) return { thread: null };

  const thread = await threadFor(tenant._id, tenant.name);
  thread.tenantReadAt = new Date();
  await thread.save();

  return { thread: thread.toPublic('tenant') };
}

/** Post as the tenant. */
async function postAsTenant(req, { body }) {
  const tenant = await tenantForRequest(req);
  if (!tenant) {
    throw ApiError.badRequest(
      'This business is not part of a Kelinto account, so there is nobody to message.',
      'NO_TENANT',
    );
  }

  const business = req.businessScope
    ? await Business.findById(req.businessScope).select('name').lean()
    : null;

  const thread = await post(await threadFor(tenant._id, tenant.name), {
    side: 'tenant',
    author: req.user?._id ?? null,
    authorName: req.user?.contactName ?? '',
    authorEmail: req.user?.email ?? '',
    body,
    // Pinned to whichever business they are working in - for the tenant side
    // that is always known, and it saves them saying which shop they mean.
    business: business?._id ?? null,
    businessName: business?.name ?? '',
  });

  return { thread: thread.toPublic('tenant') };
}

/** The unread count for the panel's own badge. */
async function myUnread(req) {
  const tenant = await tenantForRequest(req);
  if (!tenant) return { unread: 0 };

  const thread = await SupportThread.findOne({ tenant: tenant._id });
  return { unread: thread ? thread.unreadFor('tenant') : 0 };
}

export {
  MAX_MESSAGES,
  getMyThread,
  getThread,
  listThreads,
  myUnread,
  postAsTenant,
  replyAsPlatform,
  resolveThread,
};
