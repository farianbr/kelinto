import { useState } from 'react';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import useAdminForm from '@/hooks/useAdminForm';
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Pencil,
  Plus,
  Power,
  Smartphone,
  Trash2,
} from 'lucide-react';

import { DEVICE_KIND_LABELS } from '@shared/schemas/admin';
import { count as formatCount } from '@/lib/format';
import cn from '@/lib/cn';
import Panel, { PanelEmpty } from '@/components/ui/Panel';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Input from '@/components/ui/Input';
import Checkbox from '@/components/ui/Checkbox';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/admin/PageHeader';
import { ADMIN_ROUTES } from '@/lib/adminRoutes';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import { useAdminDevices, useAdminMutations } from '@/hooks/useAdmin';
import { pressable } from '@/lib/motion';

const ADMIN_PAGE = {
  ...ADMIN_ROUTES['/admin/settings/devices'],
  icon: adminIcon('Smartphone'),
};

/** What a node's children are called, so the add button says the right word. */
const CHILD_LABEL = {
  deviceType: 'brand',
  brand: 'device / series',
  series: 'model',
  model: null,
};

/** What this form holds, as opposed to what the route receives. */
const deviceFormSchema = z.object({
  name: z.string().trim().min(1, 'Give the device a name.').max(120),
  aliases: z.string().trim().max(600).optional(),
  order: z.coerce.number().int().min(0).max(10_000),
  isActive: z.boolean(),
});

function DeviceForm({ node, parentKind, onSubmit, onCancel, isPending, error }) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useAdminForm({
    /*
      The FORM's shape, not the API's.

      `deviceCatalogSchema` types `aliases` as an array, because that is what
      the route receives - but this form holds it as the comma-separated string
      a person types, and converts it on submit. Validating the API shape here
      would fail every submit on a field the user filled in correctly, so the
      one field that differs is restated and the rest matches.
    */
    resolver: zodResolver(deviceFormSchema),
    defaultValues: {
      name: node?.name ?? '',
      aliases: (node?.aliases ?? []).join(', '),
      order: node?.order ?? 0,
      isActive: node?.isActive ?? true,
    },
  });

  const level = node
    ? DEVICE_KIND_LABELS[node.kind]
    : parentKind
      ? DEVICE_KIND_LABELS[
          { deviceType: 'brand', brand: 'series', series: 'model' }[parentKind]
        ]
      : DEVICE_KIND_LABELS.deviceType;

  return (
    <form
      onSubmit={handleSubmit((values) =>
        onSubmit({
          name: values.name,
          aliases: String(values.aliases ?? '')
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean),
          order: Number(values.order) || 0,
          isActive: Boolean(values.isActive),
        }),
      )}
      className="space-y-4"
    >
      {error && (
        <p className="flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {error}
        </p>
      )}

      <p className="text-xs text-ink-400">
        Level: <span className="font-medium text-ink-600">{level}</span>
      </p>

      <Input
        label="Name"
        placeholder="e.g. iPhone 15 Pro Max"
        required
        error={errors.name?.message}
        {...register('name')}
      />

      <Input
        label="Also known as"
        placeholder="15 pm, SM-S911B - comma separated"
        error={errors.aliases?.message}
        {...register('aliases')}
      />
      <p className="text-xs leading-snug text-ink-400">
        What a customer or a serial sticker calls it. The pickers search these as well as the name,
        so the counter finds the device whichever way it is typed.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Sort order" type="number" min="0" {...register('order')} />
      </div>

      <Checkbox label="Active - offered on tickets and estimates" {...register('isActive')} />

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={isPending}>
          {node ? 'Save device' : 'Add device'}
        </Button>
      </div>
    </form>
  );
}

/**
 * One row of the tree, and its children beneath it.
 *
 * Rendered as a **tree rather than a table** because that is what it is: a
 * flat list of 400 models with a Brand column makes the reader reconstruct the
 * hierarchy in their head, and the hierarchy is the whole content here.
 */
function DeviceRow({ node, depth, onAdd, onEdit, onToggle, onDelete }) {
  const [open, setOpen] = useState(depth < 1);
  const hasChildren = node.children.length > 0;
  const childLabel = CHILD_LABEL[node.kind];

  return (
    <>
      <div
        className={cn(
          'flex items-center gap-2 border-b border-line px-3 py-2 sm:px-4',
          !node.isActive && 'opacity-55',
        )}
        style={{ paddingLeft: `${depth * 20 + 12}px` }}
      >
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-label={open ? 'Collapse' : 'Expand'}
          // Kept in the layout even with no children, so names stay aligned
          // down a column rather than stepping in and out by a chevron's width.
          className={cn(
            'inline-flex size-5 shrink-0 items-center justify-center rounded text-ink-400',
            !hasChildren && 'invisible',
          )}
        >
          {open ? (
            <ChevronDown className="size-4" strokeWidth={2} aria-hidden="true" />
          ) : (
            <ChevronRight className="size-4" strokeWidth={2} aria-hidden="true" />
          )}
        </button>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-ink-900">{node.name}</span>
          {node.aliases.length > 0 && (
            <span className="block truncate text-2xs text-ink-400">
              {node.aliases.join(' · ')}
            </span>
          )}
        </span>

        <Badge tone="neutral" size="sm">
          {DEVICE_KIND_LABELS[node.kind]}
        </Badge>

        {!node.isActive && (
          <Badge tone="warn" size="sm">
            inactive
          </Badge>
        )}

        <span className="flex shrink-0 items-center gap-1">
          {childLabel && (
            <button
              type="button"
              onClick={() => onAdd(node)}
              title={`Add a ${childLabel}`}
              aria-label={`Add a ${childLabel} under ${node.name}`}
              className={cn(
                pressable,
                'inline-flex size-8 items-center justify-center rounded-md border border-line bg-surface text-ink-500 hover:border-brand hover:text-brand',
              )}
            >
              <Plus className="size-3.5" strokeWidth={2} aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            onClick={() => onEdit(node)}
            aria-label={`Edit ${node.name}`}
            className={cn(
              pressable,
              'inline-flex size-8 items-center justify-center rounded-md border border-line bg-surface text-ink-500 hover:border-ink-300',
            )}
          >
            <Pencil className="size-3.5" strokeWidth={2} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => onToggle(node)}
            aria-label={node.isActive ? `Deactivate ${node.name}` : `Reactivate ${node.name}`}
            className={cn(
              pressable,
              'inline-flex size-8 items-center justify-center rounded-md border border-line bg-surface text-ink-500 hover:border-ink-300',
            )}
          >
            <Power className="size-3.5" strokeWidth={2} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => onDelete(node)}
            aria-label={`Delete ${node.name}`}
            className={cn(
              pressable,
              'inline-flex size-8 items-center justify-center rounded-md border border-line bg-surface text-ink-400 hover:border-danger hover:text-danger',
            )}
          >
            <Trash2 className="size-3.5" strokeWidth={2} aria-hidden="true" />
          </button>
        </span>
      </div>

      {open &&
        node.children.map((child) => (
          <DeviceRow
            key={child.id}
            node={child}
            depth={depth + 1}
            onAdd={onAdd}
            onEdit={onEdit}
            onToggle={onToggle}
            onDelete={onDelete}
          />
        ))}
    </>
  );
}

/**
 * The devices this shop takes in (Sales § Devices).
 *
 * **Not the catalogue taxonomy.** That tree is the storefront's: every read of
 * it counts products and prunes any branch with none, which is right for a
 * filter and fatal for a repair list - a shop stocks parts for almost nothing it
 * repairs, so its whole device list would prune itself away. This one is never
 * pruned and never counted.
 *
 * It feeds the Category, Brand, Device and Model pickers on the ticket and
 * estimate forms, and the kiosk's device questions.
 */
export function AdminDevicesPage() {
  const [adding, setAdding] = useState(null);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  // Everything, including retired rows: this is the screen where a retired
  // device is brought back, so hiding them would hide the thing being managed.
  const { data, isLoading } = useAdminDevices({ status: 'all' });
  const { createDevice, updateDevice, deleteDevice } = useAdminMutations();

  const tree = data?.tree ?? [];

  return (
    <>
      <PageHeader
        icon={ADMIN_PAGE.icon}
        title={ADMIN_PAGE.title}
        description={ADMIN_PAGE.description}
        action={
          <Button onClick={() => setAdding({ parent: null })} icon={Plus}>
            Add category
          </Button>
        }
      />

      <Panel flush>
        <div className="border-b border-line px-3 py-2 sm:px-4">
          <p className="text-xs text-ink-400">
            {formatCount(data?.total ?? 0)} device{(data?.total ?? 0) === 1 ? '' : 's'} in four
            levels: category, brand, device or series, then model. Add a level with the{' '}
            <Plus className="inline size-3" strokeWidth={2} aria-hidden="true" /> on its parent.
          </p>
        </div>

        {isLoading ? (
          <p className="px-4 py-8 text-center text-sm text-ink-400">Loading devices…</p>
        ) : tree.length === 0 ? (
          <PanelEmpty
            icon={Smartphone}
            title="No devices yet"
            body="A ticket picks its device from this list. Start with a category: Phone, Laptop, Tablet."
            action={
              <Button onClick={() => setAdding({ parent: null })} icon={Plus} size="sm">
                Add category
              </Button>
            }
          />
        ) : (
          <div>
            {tree.map((node) => (
              <DeviceRow
                key={node.id}
                node={node}
                depth={0}
                onAdd={(parent) => setAdding({ parent })}
                onEdit={setEditing}
                onToggle={(target) =>
                  updateDevice.mutate({ id: target.id, isActive: !target.isActive })
                }
                onDelete={setDeleting}
              />
            ))}
          </div>
        )}
      </Panel>

      <Modal
        open={Boolean(adding)}
        onClose={() => setAdding(null)}
        title={adding?.parent ? `Add under ${adding.parent.name}` : 'Add a category'}
        size="md"
        align="top"
      >
        {adding && (
          <DeviceForm
            parentKind={adding.parent?.kind}
            isPending={createDevice.isPending}
            error={createDevice.error?.message}
            onCancel={() => setAdding(null)}
            onSubmit={(values) =>
              createDevice.mutate(
                { ...values, parent: adding.parent?.id },
                { onSuccess: () => setAdding(null) },
              )
            }
          />
        )}
      </Modal>

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={`Edit ${editing?.name ?? 'device'}`}
        size="md"
        align="top"
      >
        {editing && (
          <DeviceForm
            node={editing}
            isPending={updateDevice.isPending}
            error={updateDevice.error?.message}
            onCancel={() => setEditing(null)}
            onSubmit={(values) =>
              updateDevice.mutate(
                { id: editing.id, ...values },
                { onSuccess: () => setEditing(null) },
              )
            }
          />
        )}
      </Modal>

      {/*
        The server refuses to delete a node with children or one any ticket
        names, and says which - so this dialog names the record and the
        consequence rather than trying to predict the answer.
      */}
      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Delete this device?"
        body={
          deleting
            ? `${deleting.name} will be removed from the device list. If it has anything under it, ` +
              'or any ticket or estimate names it, the delete is refused and you will be asked to retire it instead.'
            : ''
        }
        confirmLabel="Delete device"
        tone="danger"
        loading={deleteDevice.isPending}
        error={deleteDevice.error?.message}
        onConfirm={() =>
          deleteDevice.mutate(deleting.id, { onSuccess: () => setDeleting(null) })
        }
      />
    </>
  );
}

export default AdminDevicesPage;
