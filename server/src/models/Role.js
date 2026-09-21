import mongoose from 'mongoose';

/**
 * A named permission set (ERP rework §7.6).
 *
 * The first draft of the plan stored a permission map on each user. This is the
 * corrected model: the staff member assigns a **job title**, and the title carries
 * the map. Editing one role updates everyone holding it, which is what a
 * staff member expects when they change what "Warehouse" is allowed to do.
 *
 * Access is per **area** - the top-level nav groups - not per page. A per-page
 * matrix would be twenty rows nobody maintains correctly, and a permission
 * system nobody maintains is one that gets set to full access and forgotten.
 */

/** The areas a role can be granted. These are the sidebar's top-level groups. */
const PERMISSION_AREAS = [
  'clients',
  'sales',
  'purchase',
  'reports',
  'marketing',
  'business',
  'settings',
];

/** Ordered weakest to strongest - `LEVELS.indexOf` is the comparison. */
const PERMISSION_LEVELS = ['none', 'view', 'full'];

/** The settings categories that can be pinned away from their parent. */
const SETTINGS_SUBAREAS = [
  'business',
  'financial',
  'users',
  'scheduling',
  'communications',
  'system',
  'integrations',
];

const areaField = {
  type: String,
  enum: PERMISSION_LEVELS,
  default: 'none',
};

/**
 * A settings category. Defaults to `inherit`, which is not a level - it is the
 * absence of one, resolved against `settings` when the check runs.
 */
const subAreaField = {
  type: String,
  enum: ['inherit', ...PERMISSION_LEVELS],
  default: 'inherit',
};

const roleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, index: true },

    // Seeded with the product rather than created by the staff member. A built-in
    // may be edited (except the system one) but never deleted - deleting one
    // would orphan every staff member holding it.
    isBuiltIn: { type: Boolean, default: false },

    // The Admin role. Never editable, never deletable, and `admin` accounts
    // bypass the role system entirely regardless of what this row says - it
    // exists so the Roles & Access screen has something honest to render.
    isSystem: { type: Boolean, default: false },

    areas: {
      clients: areaField,
      sales: areaField,
      purchase: areaField,
      reports: areaField,
      marketing: areaField,
      business: areaField,
      settings: areaField,
    },

    /**
     * One row per settings category, each defaulting to `inherit`.
     *
     * **Its own field, not a key inside `areas`.** A dotted key there -
     * `areas['settings.financial']` - is read by Mongoose as the nested path
     * `areas.settings.financial`, which collides with the `settings` string
     * field one line up and throws *"Cannot create property 'financial' on
     * string"* on the first write. A sibling map sidesteps that, and `levelFor`
     * is the single place that has to know the two live apart.
     */
    settingsAreas: {
      ...SETTINGS_SUBAREAS.reduce((out, area) => ({ ...out, [area]: subAreaField }), {}),
    },
  },
  { timestamps: true },
);

roleSchema.index({ isBuiltIn: -1, name: 1 });

/**
 * Does this role clear `level` on `area`?
 *
 * An unknown area answers **no**. A new nav group that nobody has granted yet
 * should be closed until an admin opens it, not open because the map has no
 * opinion about it.
 */
/**
 * The level this role actually holds for an area, inheritance resolved.
 *
 * A settings sub-area set to `inherit` - the default, and what every role
 * carries until somebody pins one - answers with whatever `settings` holds. So
 * a role with `settings: view` and nothing else set reads `view` for all seven
 * categories, which is exactly how the system behaved before they existed.
 *
 * An unknown area is `none`, not an error: a route guarding an area nobody has
 * defined should deny rather than throw, because throwing turns a typo in a
 * route into a 500 on a screen that should simply have been refused.
 */
roleSchema.methods.levelFor = function levelFor(area) {
  /**
   * `settings.financial` addresses the sub-area map, which is stored separately
   * from `areas` - see the note on `settingsAreas`. The dotted string stays the
   * address everywhere else, so routes and the screen never learn that.
   */
  if (typeof area === 'string' && area.startsWith('settings.')) {
    const key = area.slice('settings.'.length);
    const held = this.settingsAreas?.[key] ?? 'inherit';
    return held === 'inherit' ? (this.areas?.settings ?? 'none') : held;
  }

  return this.areas?.[area] ?? 'none';
};

roleSchema.methods.allows = function allows(area, level = 'view') {
  const held = this.levelFor(area);
  return PERMISSION_LEVELS.indexOf(held) >= PERMISSION_LEVELS.indexOf(level);
};

roleSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id.toString(),
    name: this.name,
    slug: this.slug,
    isBuiltIn: this.isBuiltIn,
    isSystem: this.isSystem,
    areas: {
      ...PERMISSION_AREAS.reduce(
        (out, area) => ({ ...out, [area]: this.areas?.[area] ?? 'none' }),
        {},
      ),
      /**
       * Sub-areas are sent **as stored**, `inherit` and all.
       *
       * The screen shows "Same as Settings" for an unpinned row, so it needs to
       * know the row is unpinned. Sending the resolved level instead would make
       * every row look deliberately set, and a staff member changing `settings`
       * would then wonder why none of the seven rows below it moved.
       */
      ...SETTINGS_SUBAREAS.reduce(
        (out, area) => ({
          ...out,
          // Flattened back to the dotted address on the way out, so the client
          // sees one `areas` map and never the storage split.
          [`settings.${area}`]: this.settingsAreas?.[area] ?? 'inherit',
        }),
        {},
      ),
    },
  };
};

const Role = mongoose.model('Role', roleSchema);

export { PERMISSION_AREAS, PERMISSION_LEVELS, SETTINGS_SUBAREAS, Role };
export default Role;
