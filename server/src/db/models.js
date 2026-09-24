import mongoose from 'mongoose';

import { controlDb, dbFor } from './connections.js';
import { currentConnection } from './context.js';

/**
 * The model registry - every collection, bound to the right database.
 *
 * **Schemas are read back off the already-compiled models rather than exported
 * from each model file.** `mongoose.model('Order').schema` is the same object
 * the file built, so binding it to another connection needs no change to any of
 * the 35 model files - and, more usefully, none of them can drift out of step
 * with a parallel list of schema exports. Several files define three or four
 * schemas (sub-documents for lines, addresses, hours); only the compiled one
 * matters, and this finds it without anybody deciding which.
 *
 * ## Which database holds what (SAAS_PLATFORM §4.1)
 *
 * **Control plane** - what *describes* businesses. A business database holding
 * these would be circular: the record naming a business cannot live inside the
 * thing it names.
 *
 * **Per-business** - everything else. Including `User`, `Product` and
 * `Taxonomy`: a repair shop's parts list has nothing to do with a wholesaler's,
 * and a customer belongs to the business they buy from.
 *
 * `AuditLog` is per-business on purpose. SAAS_PLATFORM invariant 9 requires an
 * impersonation to be written into *the target business's own* trail, where its
 * owner reads it; a central audit collection would put every tenant's history
 * in one place, which is the opposite of what that asks for.
 */

/** Lives in the control plane. Everything not named here is per-business. */
const CONTROL_MODELS = new Set([
  'Tenant',
  'Plan',
  'SuperAdmin',
  'Business',
  'ImpersonationGrant',
  // A support conversation is about the account, outlives any one business, and
  // must stay readable while the tenant is suspended - which is exactly when
  // they most need to reach us.
  'SupportThread',
  // Which business database holds each panel account, so the shared admin
  // login can find staff whose business the host no longer names.
  'LoginEntry',
  // A supplier's one login across every business it supplies; each business
  // keeps its own `Supplier` record for the relationship.
  'SupplierAccount',
]);

/** `connection -> { modelName: Model }`, so a schema is compiled once per database. */
const cache = new WeakMap();

/**
 * Bind one model name to one connection.
 *
 * `connection.model(name)` with no schema returns an already-bound model, and
 * with a schema compiles one. Asking for the existing one first avoids
 * recompiling on every call and keeps Mongoose's own registry authoritative.
 */
function bind(connection, name) {
  try {
    return connection.model(name);
  } catch {
    // Not yet compiled on this connection - build it from the default's schema.
    const { schema } = mongoose.model(name);
    const model = connection.model(name, schema);
    // Everything this model can `populate` has to exist on the same connection
    // before anybody tries. See `bindRefs`.
    bindRefs(connection, schema);
    return model;
  }
}

/**
 * Compile every model a schema can `populate` into, on the same connection.
 *
 * **`populate` resolves a `ref` by name against the connection, not against
 * Mongoose's global registry.** So a model bound to a business database could
 * only populate a reference if the referenced model happened to have been
 * touched on that connection already - which made it depend on the order a
 * request read things in. In practice `getBidBoard` populated `bids.supplier`
 * and got `null` back on every bid, because nothing had asked for
 * `db().Supplier` first: the supplier id and email were empty in the API
 * response, and the panel's mailto link, Confirm, Negotiate and Remove actions
 * were all keyed on an id that was never there.
 *
 * Binding the refs alongside the model makes it order-independent. It walks
 * nested paths and document arrays, because the reference that broke was
 * `bids.supplier` - inside an array of subdocuments, which a flat scan of
 * `schema.paths` does not reach.
 *
 * Control-plane refs are skipped: a `Business` lives in one database whichever
 * one is being served, and compiling a second copy against a business
 * connection would read an empty collection.
 */
function bindRefs(connection, schema, seen = new Set()) {
  schema.eachPath((path, type) => {
    // A ref can sit on the path itself or, for `[{ type: ObjectId, ref }]`, on
    // its element caster.
    const ref = type.options?.ref ?? type.caster?.options?.ref;
    if (typeof ref === 'string' && !seen.has(ref) && !CONTROL_MODELS.has(ref)) {
      seen.add(ref);
      // Only what is already declared globally: an unknown name here means a
      // model file nobody imported, and throwing would take down a request over
      // a reference it was never going to follow.
      if (mongoose.models[ref]) bind(connection, ref);
    }

    // Subdocuments and document arrays carry their own schemas, which is where
    // `bids.supplier` lives.
    const nested = type.schema ?? type.caster?.schema;
    if (nested) bindRefs(connection, nested, seen);
  });
}

/**
 * Every model, bound to the database that should hold it.
 *
 * Returns a `Proxy` rather than an eagerly-built object: there are 35 models and
 * a given request touches two or three, so binding them all on every call would
 * be work nobody asked for. The proxy also means `db().Order` reads exactly
 * like the import it replaces.
 */
function modelsFor(connection) {
  const target = connection ?? mongoose.connection;

  let bound = cache.get(target);
  if (!bound) {
    bound = {};
    cache.set(target, bound);
  }

  return new Proxy(bound, {
    get(store, name) {
      if (typeof name !== 'string') return undefined;
      if (store[name]) return store[name];

      // A control-plane model ignores the business connection entirely: a
      // `Tenant` is the same record whichever business is being served.
      const home = CONTROL_MODELS.has(name) ? controlDb() : target;
      const model = bind(home, name);
      store[name] = model;
      return model;
    },
    has(store, name) {
      return typeof name === 'string' && (name in store || Boolean(mongoose.models[name]));
    },
  });
}

/**
 * The models for the business this request is about.
 *
 * **The one call a service makes.** `const { Order } = db();` replaces
 * `import Order from '../models/Order.js'`, and everything else about the
 * service stays as it was.
 *
 * Outside a request there is no context, and the default connection is the
 * honest answer rather than an error - a seed script writing to the database it
 * was pointed at is doing exactly what it should. `runInBusiness` is how a
 * script opts into a specific one.
 */
function db() {
  return modelsFor(currentConnection());
}

/** The control plane's models, whatever business the request is about. */
function controlModels() {
  return modelsFor(controlDb());
}

export { CONTROL_MODELS, controlModels, db, dbFor, modelsFor };
