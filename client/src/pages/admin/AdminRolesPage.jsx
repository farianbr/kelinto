import { useState } from 'react';
import { Controller } from 'react-hook-form';
import useAdminForm from '@/hooks/useAdminForm';
import { AlertCircle, Pencil, Plus, ShieldCheck, Trash2, Users } from 'lucide-react';
import {
  PERMISSION_AREAS,
  SETTINGS_SUBAREAS,
  settingsAreaKey,
  SUBAREA_LEVELS,
  SUBAREA_LEVEL_LABELS,
  PERMISSION_LEVELS,
  PERMISSION_LEVEL_LABELS,
} from '@shared/schemas/admin';
import Panel, { PanelEmpty } from '@/components/ui/Panel';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/admin/PageHeader';
import { ADMIN_ROUTES } from '@/lib/adminRoutes';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import { useAdminRoles, useAdminMutations } from '@/hooks/useAdmin';
import cn from '@/lib/cn';
import { pressable } from '@/lib/motion';

/**
 * Roles & Access (§6.15/3, §7.6).
 *
 * A **named role carries the permission map**, and staff hold the role - so
 * changing what "Warehouse" may do updates everyone on it in one edit. That is
 * the staff member's own mental model: they think in job titles, not in per-user
 * checkboxes.
 *
 * Access is **per area, not per page**. A twenty-row matrix is one nobody
 * maintains correctly, and an unmaintained permission system gets set to full
 * access and forgotten.
 *
 * Everything here is a courtesy: `requirePermission` decides on the server for
 * every request. A role edited in this screen changes what the server allows,
 * not merely what the sidebar shows.
 */
const ADMIN_PAGE = { ...ADMIN_ROUTES['/admin/settings/roles'], icon: adminIcon('ShieldCheck') };

const AREA_LABELS = {
  clients: 'Clients',
  sales: 'Sales',
  purchase: 'Purchase',
  reports: 'Reports',
  marketing: 'Marketing',
  business: 'Business',
  settings: 'Settings',
};

const LEVEL_TONE = { none: 'neutral', view: 'info', full: 'ok' };

/**
 * The fourth option on the Settings row.
 *
 * A **display** state, never a stored one: it means "the categories below are
 * set individually". Nothing writes it to `areas.settings`, which holds one of
 * `PERMISSION_LEVELS` exactly as the schema requires - see `RoleForm`.
 */
const SETTINGS_CUSTOM = 'custom';

const SETTINGS_LEVELS = [...PERMISSION_LEVELS, SETTINGS_CUSTOM];

const SETTINGS_LEVEL_LABELS = {
  ...PERMISSION_LEVEL_LABELS,
  [SETTINGS_CUSTOM]: 'Custom',
};

/** The seven settings categories, as the Settings hub names them. */
const SUBAREA_LABELS = {
  business: 'Business & Organization',
  financial: 'Financial',
  users: 'Users & Access Control',
  scheduling: 'Scheduling & Booking',
  communications: 'Communications & Notifications',
  system: 'System & Audit Logs',
  integrations: 'Integrations & API',
};

/**
 * One access row - a name, and the levels it can hold.
 *
 * Shared by the top-level areas and the settings categories under them, so the
 * two can never drift into different controls for the same decision. The only
 * difference is the indent and the extra `inherit` level, both passed in.
 */
function LevelRow({ label, levels, labels, value, onChange, indented = false, disabled = false, disabledHint }) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2',
        // Indented and quieter: these belong to the row above, and reading as
        // its equal is what would make the section look like fourteen areas.
        indented && 'ml-5 mt-1.5 border-dashed bg-surface-2',
        disabled && 'opacity-55',
      )}
    >
      <span className={cn('text-sm', indented ? 'text-ink-500' : 'text-ink-700')}>
        {label}
        {disabled && disabledHint && (
          <span className="ml-1.5 text-xs text-ink-400">{disabledHint}</span>
        )}
      </span>
      {/* Explicit buttons rather than a select: the whole point of this screen
          is seeing a role's shape at a glance, and collapsed dropdowns show
          nothing. */}
      <div className="flex shrink-0 rounded-md border border-line bg-surface p-0.5">
        {levels.map((level) => (
          <button
            key={level}
            type="button"
            onClick={() => onChange(level)}
            aria-pressed={value === level}
            disabled={disabled}
            className={cn(
              pressable,
              'rounded-sm px-2.5 py-1 text-xs',
              value === level ? 'bg-ink-900 text-white' : 'text-ink-500 hover:bg-surface-2',
              disabled && 'cursor-not-allowed hover:bg-transparent',
            )}
          >
            {labels[level]}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The form's own shape, which is NOT the payload's.
 *
 * ## Why the sub-areas live in their own field
 *
 * `roleSchema` holds the settings categories as flat keys literally named
 * `"settings.financial"`. react-hook-form cannot hold a key like that: every
 * escaping form - `areas[settings.financial]`, a backslash, quotes inside the
 * brackets - is split on the dot by its path parser, so all three write a
 * nested object at `areas.settings` and collide with the string the schema
 * needs there. An earlier attempt used the bracket form believing it escaped;
 * it did not, and `set()` discarded the value silently, which is why picking a
 * level on a category did nothing while ALSO leaving Settings reading as it
 * was.
 *
 * So the form keeps two fields - `areas` for the seven top-level ones, and a
 * flat `subAreas` keyed by bare category name - and `toPayload` joins them
 * back into the dotted keys on submit. One translation, in one place, instead
 * of an escape that cannot work.
 */
function formDefaults(role) {
  const areas = role?.areas ?? {};

  return {
    name: role?.name ?? '',
    areas: PERMISSION_AREAS.reduce(
      (out, area) => ({ ...out, [area]: areas[area] ?? 'none' }),
      {},
    ),
    // Seeded explicitly rather than left undefined: an absent sub-area and one
    // deliberately set to `inherit` mean the same thing today, but only one of
    // them says so.
    subAreas: SETTINGS_SUBAREAS.reduce(
      (out, sub) => ({ ...out, [sub]: areas[settingsAreaKey(sub)] ?? 'inherit' }),
      {},
    ),
  };
}

/** The two form fields, joined back into the one map the route receives. */
function toPayload(values) {
  return {
    name: values.name,
    areas: {
      ...values.areas,
      ...SETTINGS_SUBAREAS.reduce(
        (out, sub) => ({ ...out, [settingsAreaKey(sub)]: values.subAreas?.[sub] ?? 'inherit' }),
        {},
      ),
    },
  };
}

function RoleForm({ role, onSubmit, onCancel, isPending, error }) {
  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    formState: { errors },
  } = useAdminForm({
    /*
      No resolver.

      `roleSchema` describes the PAYLOAD, and this form deliberately holds a
      different shape (see `formDefaults`), so validating against it here
      would fail on every submit over keys the form does not carry. The only
      rule this form has is "give it a name", which is checked below and
      enforced again by the route.
    */
    defaultValues: formDefaults(role),
  });

  /*
    Settings, and the seven categories under it.

    ## The state the screen was missing

    Sub-areas store `inherit` until somebody pins one, and `levelFor` resolves
    `inherit` to whatever `settings` holds. That part was always right. What
    the screen could not say was WHICH of those two worlds it was in: it drew
    Settings as one of three levels and the categories as seven independent
    pickers, so "No access" above and "Full" below looked like a contradiction
    the screen was happy to let you save - and greying the rows out instead
    only hid the question.

    So Settings has a fourth option, **Custom**, and it is a derived state
    rather than a stored one: it means "at least one category is pinned". The
    three real levels mean the opposite - every category follows this one. That
    makes the two rows consistent by construction instead of by warning.

    ## What each move does

    - Picking `none`/`view`/`full` on Settings **resets every category to
      `inherit`**, so the section genuinely does what the row above says.
    - Picking `custom` pins each category at its currently resolved level, so
      nothing changes the moment you switch - it just becomes editable.
    - Pinning a category while Settings is not custom **promotes Settings to
      custom**, because that is now what is true.

    `custom` never reaches the payload: `settings` is written from the pinned
    values on submit, and the schema still sees one of its three levels.
  */
  const settingsLevel = watch('areas.settings');
  const subAreas = watch('subAreas');

  const pinnedCount = SETTINGS_SUBAREAS.filter(
    (sub) => (subAreas?.[sub] ?? 'inherit') !== 'inherit',
  ).length;

  const isCustom = pinnedCount > 0;

  // What an unpinned category resolves to, and what a newly pinned one starts
  // at. `custom` is not a level, so it can never be the answer here.
  const inheritedLevel = PERMISSION_LEVELS.includes(settingsLevel) ? settingsLevel : 'none';

  function setSettingsLevel(next) {
    if (next === SETTINGS_CUSTOM) {
      /*
        Every category takes the level it already resolved to, so switching
        to Custom grants and revokes nothing - it only makes the seven
        answers explicit and editable. Same conversion the first pin does.
      */
      for (const sub of SETTINGS_SUBAREAS) {
        setValue(`subAreas.${sub}`, inheritedLevel, { shouldDirty: true });
      }
      return;
    }

    // A real level means "every category follows this one", so the pins are
    // cleared rather than left behind to contradict it.
    setValue('areas.settings', next, { shouldDirty: true });
    for (const sub of SETTINGS_SUBAREAS) {
      setValue(`subAreas.${sub}`, 'inherit', { shouldDirty: true });
    }
  }

  /**
   * Set one category, and make the rest explicit the first time.
   *
   * ## Why the other six get pinned too
   *
   * In Custom, "Same as Settings" is a promise the row above can no longer
   * keep. `settings` still holds a level underneath - whatever it was before
   * anybody started pinning - so an unpinned category silently resolved to
   * that, while the row it was pointing at read "Custom". The screen was
   * telling somebody their six other categories followed a value it had
   * stopped showing them.
   *
   * So the first pin converts the whole section: every category takes the
   * level it resolved to a moment ago, which changes nobody's access, and
   * from then on each row states its own answer. Custom means exactly one
   * thing - seven explicit levels - and `inherit` is not offered while it is
   * on (see `SUBAREA_LEVELS` at the call site).
   *
   * Reversing is the Settings row's job: picking a real level there clears
   * every pin and puts the section back to following one choice.
   */
  function setSubAreaLevel(sub, next) {
    if (!isCustom) {
      /*
        Read once, before any write.

        An earlier version recomputed the inherited level inside the loop,
        so the second pin re-read a value the first had already changed and
        reset it. `inheritedLevel` is from this render and cannot move.
      */
      const base = inheritedLevel;
      for (const other of SETTINGS_SUBAREAS) {
        if (other === sub) continue;
        setValue(`subAreas.${other}`, base, { shouldDirty: true });
      }
    }

    setValue(`subAreas.${sub}`, next, { shouldDirty: true });
  }

  return (
    // `toPayload` rejoins the two form fields into the one `areas` map the
    // route validates - the form deliberately holds a different shape.
    <form
      onSubmit={handleSubmit((values) => onSubmit(toPayload(values)))}
      className="flex flex-col gap-4"
    >
      {error && (
        <p className="flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {error}
        </p>
      )}

      <Input
        label="Role name"
        placeholder="Shipping Clerk"
        required
        error={errors.name?.message}
        {...register('name', {
          required: 'Enter a role name.',
          maxLength: { value: 60, message: 'Keep it under 60 characters.' },
        })}
      />

      <div>
        <span className="mb-2 block text-sm font-medium text-ink-700">Access by area</span>
        <div className="flex flex-col gap-1.5">
          {PERMISSION_AREAS.map((area) => (
            <div key={area}>
              <Controller
                control={control}
                name={`areas.${area}`}
                render={({ field }) =>
                  area === 'settings' ? (
                    // Four options here, and the extra one is derived: Custom
                    // is on whenever a category below is pinned.
                    <LevelRow
                      label={AREA_LABELS[area]}
                      levels={SETTINGS_LEVELS}
                      labels={SETTINGS_LEVEL_LABELS}
                      value={isCustom ? SETTINGS_CUSTOM : field.value}
                      onChange={setSettingsLevel}
                    />
                  ) : (
                    <LevelRow
                      label={AREA_LABELS[area]}
                      levels={PERMISSION_LEVELS}
                      labels={PERMISSION_LEVEL_LABELS}
                      value={field.value}
                      onChange={field.onChange}
                    />
                  )
                }
              />

              {/*
                Settings opens into its seven categories.

                A single Settings level was too coarse the moment a business had
                more than one staff member: a bookkeeper who needs the expense
                categories had to be handed the screen that mints API keys and
                the one that grants roles. Each row defaults to "Same as
                Settings", so the common case - everything alike - stays one
                choice and only the exception is spelled out.
              */}
              {area === 'settings' &&
                SETTINGS_SUBAREAS.map((sub) => (
                  /*
                    A bare category name, in its own `subAreas` field.

                    Not `areas["settings.financial"]` in any form: react-hook-
                    form splits on the dot whatever the brackets or quotes say,
                    so every escape built a nested object at `areas.settings`
                    and collided with the string that lives there. See
                    `formDefaults` - the join back to the dotted keys the route
                    wants happens once, in `toPayload`.
                  */
                  <Controller
                    key={sub}
                    control={control}
                    name={`subAreas.${sub}`}
                    render={({ field }) => (
                      <LevelRow
                        label={SUBAREA_LABELS[sub]}
                        /*
                          "Same as Settings" is only offered while the section
                          actually follows Settings. In Custom it would be a
                          fourth answer meaning "follow a value this screen is
                          no longer showing you", which is the ambiguity Custom
                          exists to remove.
                        */
                        levels={isCustom ? PERMISSION_LEVELS : SUBAREA_LEVELS}
                        labels={SUBAREA_LEVEL_LABELS}
                        value={field.value ?? 'inherit'}
                        onChange={(next) => setSubAreaLevel(sub, next)}
                        indented
                      />
                    )}
                  />
                ))}
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={isPending}>
          {role ? 'Save role' : 'Create role'}
        </Button>
      </div>
    </form>
  );
}

/**
 * What a role actually holds for Settings, as a badge should state it.
 *
 * The card read `areas.settings` straight and said "SETTINGS: NO ACCESS" for
 * a role whose Financial category was set to Full - true about the top-level
 * value and false about the role. The sub-areas are stored beside it and
 * `levelFor` resolves the pair on the server; the card has to do the same or
 * the list disagrees with the form that wrote it.
 *
 * Returns the level when the section is uniform, and `custom` when the
 * categories disagree - the same word the editor uses, so the two screens
 * describe one role the same way.
 */
function settingsSummary(role) {
  const base = role?.areas?.settings ?? 'none';

  const held = SETTINGS_SUBAREAS.map((sub) => {
    const pinned = role?.areas?.[settingsAreaKey(sub)] ?? 'inherit';
    return pinned === 'inherit' ? base : pinned;
  });

  // Uniform means every category resolves the same way, whether by inheriting
  // or by having been pinned to the same level.
  const uniform = held.every((level) => level === held[0]);
  if (uniform) return { level: held[0] ?? base, groups: [] };

  /*
    Not uniform, so the badge says Custom and the lines under it say which
    categories sit at which level.

    **Grouped by level, not listed as "reaches".** The first version named
    the categories a role could get to and stopped there, which answers
    whether but not how much: a role with Financial read-only and Users full
    read exactly like one with both full. A permission screen that cannot
    tell those apart is not saying anything worth reading.

    Closed categories are left out. The badge already says the section is
    partial, and listing what somebody CANNOT reach doubles the text to
    restate the default.
  */
  const byLevel = PERMISSION_LEVELS.filter((level) => level !== 'none').map((level) => ({
    level,
    label: PERMISSION_LEVEL_LABELS[level],
    subs: SETTINGS_SUBAREAS.filter((sub, index) => held[index] === level),
  })).filter((group) => group.subs.length);

  const name = (list) => list.map((sub) => SUBAREA_LABELS[sub] ?? sub).join(', ');

  return {
    level: SETTINGS_CUSTOM,
    groups: byLevel.map((group) => {
      /*
        A group holding nearly everything is stated by its exceptions.

        "Full: everything except System & Audit Logs" is one clause; naming
        the other six is a line that wraps twice to say the same thing. Only
        worth it when the exceptions genuinely are fewer, hence the compare.
      */
      const rest = SETTINGS_SUBAREAS.filter((sub) => !group.subs.includes(sub));

      return {
        ...group,
        names:
          rest.length && rest.length < group.subs.length
            ? `everything except ${name(rest)}`
            : name(group.subs),
      };
    }),
  };
}

function RoleCard({ role, onEdit, onDelete }) {
  // Resolved once: the badge and the lines under it are two readings of the
  // same answer and must not be computed separately.
  const settings = settingsSummary(role);

  return (
    <article className="flex flex-col rounded-lg border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-medium text-ink-900">{role.name}</h3>
            {role.isSystem && (
              <Badge tone="dark" size="sm">
                Full access
              </Badge>
            )}
            {role.isBuiltIn && !role.isSystem && (
              <Badge tone="neutral" size="sm">
                Built-in
              </Badge>
            )}
          </div>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-400">
            <Users className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
            {role.memberCount} {role.memberCount === 1 ? 'member' : 'members'}
          </p>
        </div>

        {/* The Admin role is never editable and never deletable - enforced on
            the server too, because a hidden button is a suggestion. */}
        {!role.isSystem && (
          <div className="flex shrink-0 gap-1">
            <Button variant="ghost" size="sm" onClick={() => onEdit(role)} aria-label={`Edit ${role.name}`}>
              <Pencil className="size-4" strokeWidth={2} aria-hidden="true" />
            </Button>
            {!role.isBuiltIn && (
              <Button
                variant="ghost"
                size="sm"
                className="text-danger"
                onClick={() => onDelete(role)}
                aria-label={`Delete ${role.name}`}
              >
                <Trash2 className="size-4" strokeWidth={2} aria-hidden="true" />
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="mt-3 border-t border-line pt-3">
        <div className="flex flex-wrap gap-1.5">
          {PERMISSION_AREAS.map((area) => {
            // Settings is the one area whose badge is not its stored value:
            // the categories under it can each hold their own level.
            const level = area === 'settings' ? settings.level : role.areas?.[area] ?? 'none';

            return (
              <Badge
                key={area}
                tone={level === SETTINGS_CUSTOM ? 'brand' : LEVEL_TONE[level] ?? 'neutral'}
                size="sm"
              >
                {AREA_LABELS[area]}:{' '}
                {level === SETTINGS_CUSTOM
                  ? SETTINGS_LEVEL_LABELS[SETTINGS_CUSTOM]
                  : PERMISSION_LEVEL_LABELS[level] ?? PERMISSION_LEVEL_LABELS.none}
              </Badge>
            );
          })}
        </div>

        {/* One line per level, so the reader sees how much access each part
            of Settings carries rather than only that it has some. Under the
            badges rather than beside them: the badges are a shape to scan,
            this is a sentence to read. */}
        {settings.groups.length > 0 && (
          <dl className="mt-2 space-y-0.5">
            {settings.groups.map((group) => (
              <div key={group.level} className="flex gap-1.5 text-xs leading-relaxed">
                <dt className="shrink-0 font-medium text-ink-500">{group.label}:</dt>
                <dd className="min-w-0 text-ink-400">{group.names}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </article>
  );
}

export function AdminRolesPage() {
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState(null);
  const [error, setError] = useState(null);

  const { data, isLoading } = useAdminRoles();
  const { createRole, updateRole, deleteRole } = useAdminMutations();

  const roles = data?.roles ?? [];

  async function handleCreate(values) {
    setError(null);
    try {
      await createRole.mutateAsync(values);
      setAdding(false);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleUpdate(values) {
    setError(null);
    try {
      await updateRole.mutateAsync({ id: editing.id, ...values });
      setEditing(null);
    } catch (err) {
      setError(err.message);
    }
  }

  async function confirmDelete() {
    setError(null);
    try {
      await deleteRole.mutateAsync(confirming.id);
      setConfirming(null);
    } catch (err) {
      // A role still held by somebody is refused, and the message names how
      // many hold it - reassigning them is the staff member's next move.
      setError(err.message);
    }
  }

  return (
    <>
      <PageHeader
        icon={ADMIN_PAGE.icon}
        title={ADMIN_PAGE.title}
        description={ADMIN_PAGE.description}
        action={
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-4" strokeWidth={2} aria-hidden="true" />
            Add role
          </Button>
        }
      />

      <Panel flush>
        {isLoading ? (
          <div className="p-4 text-sm text-ink-500">Loading roles…</div>
        ) : roles.length === 0 ? (
          <PanelEmpty icon={ShieldCheck} title="No roles" body="Add a role to start granting access." />
        ) : (
          <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {roles.map((role) => (
              <RoleCard key={role.id} role={role} onEdit={setEditing} onDelete={setConfirming} />
            ))}
          </div>
        )}
      </Panel>

      <Modal open={adding} onClose={() => setAdding(false)} title="Add a new role" size="lg">
        <RoleForm
          onSubmit={handleCreate}
          onCancel={() => setAdding(false)}
          isPending={createRole.isPending}
          error={error}
        />
      </Modal>

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={`Edit ${editing?.name ?? 'role'}`}
        size="lg"
      >
        {editing && (
          <RoleForm
            role={editing}
            onSubmit={handleUpdate}
            onCancel={() => setEditing(null)}
            isPending={updateRole.isPending}
            error={error}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(confirming)}
        onClose={() => {
          setConfirming(null);
          setError(null);
        }}
        onConfirm={confirmDelete}
        title={`Delete ${confirming?.name ?? 'role'}?`}
        body="Staff holding this role must be reassigned before it can be removed."
        confirmLabel="Delete role"
        loading={deleteRole.isPending}
        error={error}
      />
    </>
  );
}

export default AdminRolesPage;
