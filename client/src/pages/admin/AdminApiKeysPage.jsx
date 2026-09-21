import { useState } from 'react';
import { Lock, ShieldCheck, Trash2 } from 'lucide-react';

import cn from '@/lib/cn';
import Panel from '@/components/ui/Panel';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/admin/PageHeader';
import { ADMIN_ROUTES } from '@/lib/adminRoutes';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import { useAdminCredentials, useAdminMutations } from '@/hooks/useAdmin';
import { pressable } from '@/lib/motion';

/**
 * API Keys (§6.15, category 7, phase 11c).
 *
 * **A stored secret never comes back to this screen.** The server returns
 * `configured`, a `source` and a masked preview - nothing else - so there is no
 * value here to reveal, and the reveal toggle below unmasks **what the admin
 * has just typed into the field**, which is what CellShoppe's own toggle does.
 * That is the entire meaning of "write-only through the API" (§6.15), and it is
 * why an empty field beside a `CONFIGURED` chip is correct rather than a bug.
 *
 * **`source: 'env'` is the case worth showing loudly.** An environment variable
 * wins over anything typed here, so a screen that quietly accepted a key which
 * would then be ignored would have a staff member changing a value, seeing nothing
 * happen, and having no way to find out why.
 */
const ADMIN_PAGE = { ...ADMIN_ROUTES['/admin/settings/api-keys'], icon: adminIcon('KeyRound') };

/** One provider's card: its fields, its state, and one save for the group. */
function ProviderCard({ provider }) {
  const [values, setValues] = useState({});
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const { saveCredentials, clearCredentials } = useAdminMutations();

  const dirty = Object.values(values).some((value) => value !== undefined);
  const lockedByEnv = provider.fields.every((field) => field.source === 'env');

  async function save(event) {
    event.preventDefault();
    setError(null);
    setSaved(false);

    try {
      await saveCredentials.mutateAsync({ provider: provider.provider, ...values });
      // Cleared immediately: the typed secret has been sent, and holding it in
      // component state afterwards is a copy of a credential sitting in memory
      // for no reason.
      setValues({});
      setSaved(true);
    } catch (err) {
      setError(err.message);
    }
  }

  async function clearAll() {
    setError(null);
    setSaved(false);
    try {
      await clearCredentials.mutateAsync(provider.provider);
      setValues({});
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Panel
      title={
        <span className="flex flex-wrap items-center gap-2">
          {provider.label}
          {provider.configured ? (
            <Badge tone="ok">Configured</Badge>
          ) : provider.partial ? (
            <Badge tone="warn">Incomplete</Badge>
          ) : (
            <Badge tone="neutral">Not set</Badge>
          )}
        </span>
      }
      description={provider.description}
      action={
        provider.fields.some((field) => field.source === 'stored') && (
          <button
            type="button"
            onClick={clearAll}
            className={cn(pressable, 'inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-sm font-medium text-ink-500 hover:border-danger hover:bg-danger-50 hover:text-danger')}
          >
            <Trash2 className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
            Remove keys
          </button>
        )
      }
    >
      {/* An incomplete provider looks like progress and behaves like nothing,
          so it is called out rather than left to be inferred from the chip. */}
      {provider.partial && (
        <p className="mb-4 rounded-md border border-warn/25 bg-warn-50 px-3 py-2.5 text-sm leading-relaxed text-ink-700">
          Some fields are set and some are not. This provider stays off until every field below has
          a value.
        </p>
      )}

      <form onSubmit={save}>
        <div className="grid gap-4 sm:grid-cols-2">
          {provider.fields.map((field) => {
            const typed = values[field.key];
            const fromEnv = field.source === 'env';

            return (
              <div key={field.key} className={cn(field.secret && 'sm:col-span-2')}>
                <Input
                  label={field.label}
                  // `Input` carries its own reveal toggle for password fields,
                  // and what it unmasks is the box's own contents - which here
                  // is only ever what this admin has just typed, never a
                  // stored value. That is exactly §6.15's rule, so there is no
                  // second toggle to build.
                  type={field.secret && !fromEnv ? 'password' : 'text'}
                  value={typed ?? ''}
                  disabled={fromEnv}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => {
                    setValues((current) => ({ ...current, [field.key]: event.target.value }));
                    setSaved(false);
                  }}
                  /**
                   * An unconfigured field used to put `field.hint` in the
                   * placeholder AND below the field, so every empty row said
                   * "Starts with AC." twice - once in grey inside the box and
                   * again in grey underneath it. Repeating a line does not make
                   * it clearer; it makes the reader check whether the two say
                   * something different, and they never did.
                   *
                   * The hint stays below the field, which is where it can be
                   * read while typing. Empty placeholder here.
                   */
                  placeholder={
                    fromEnv
                      ? 'Set by an environment variable'
                      : field.configured
                        ? `${field.preview} - type to replace`
                        : ''
                  }
                  hint={
                    fromEnv ? (
                      <>
                        Set by <code className="font-mono">{field.envName}</code> and cannot be
                        changed here. An environment variable always wins.
                      </>
                    ) : field.configured ? (
                      `Currently ${field.preview}. Leave empty to keep it; clear and save to remove it.`
                    ) : (
                      (field.hint ?? null)
                    )
                  }
                />
              </div>
            );
          })}
        </div>

        {!lockedByEnv && (
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <Button type="submit" size="sm" loading={saveCredentials.isPending} disabled={!dirty}>
              Save keys
            </Button>

            <p aria-live="polite" className="min-w-0 text-sm">
              {saved && !error && <span className="text-ok">Saved. Keys are stored encrypted.</span>}
              {error && (
                <span role="alert" className="text-danger">
                  {error}
                </span>
              )}
            </p>
          </div>
        )}
      </form>
    </Panel>
  );
}

export function AdminApiKeysPage() {
  const { data, isLoading } = useAdminCredentials();

  if (isLoading) return <p className="text-sm text-ink-500">Loading providers…</p>;

  return (
    <div className="form-page">
      <PageHeader
        icon={ADMIN_PAGE.icon}
        title={ADMIN_PAGE.title}
        description={ADMIN_PAGE.description}
      />

      {/* The security posture, stated on the screen rather than only in a doc.
          A staff member who does not know a key cannot be read back will keep
          looking for the button that reads it. */}
      <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-info/20 bg-info-50 px-3.5 py-3 text-sm leading-relaxed text-ink-700">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-info" strokeWidth={2} aria-hidden="true" />
        <span>
          <strong className="font-semibold">Keys are write-only.</strong> They are encrypted before
          being stored and are never sent back to this screen - not even to an administrator. A
          configured field shows only its last four characters, and the eye toggle reveals what you
          have just typed, nothing more. To change a key, type the new one; to remove it, clear the
          field and save.
        </span>
      </div>

      <div className=" space-y-4">
        {(data?.providers ?? []).map((provider) => (
          <ProviderCard key={provider.provider} provider={provider} />
        ))}
      </div>

      <p className="mt-5 flex items-start gap-2 text-sm leading-relaxed text-ink-500">
        <Lock className="mt-0.5 size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
        <span>
          Only an administrator can view or set these - a role with full Settings access cannot.
          Every change is recorded in the security log with who made it and from where, never with
          the value.
        </span>
      </p>
    </div>
  );
}

export default AdminApiKeysPage;
