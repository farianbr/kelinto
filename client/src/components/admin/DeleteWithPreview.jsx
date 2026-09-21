import { AlertTriangle, Ban, Loader2 } from 'lucide-react';

import cn from '@/lib/cn';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useDeletePreview } from '@/hooks/useAdmin';

/**
 * A delete confirmation that says what the delete will actually do.
 *
 * ## Why
 *
 * Every delete in this system already knows its own impact, and every one of
 * them worked it out **after** the click: a staff member pressed Delete on an
 * expense category and was told it had been deactivated instead, or pressed it
 * on a device entry and was told it could not go. The facts existed; they
 * arrived after the decision.
 *
 * This asks first. `GET /admin/delete-preview/:type/:id` returns the same
 * counts the delete would compute, and the dialog renders them before anybody
 * commits.
 *
 * ## Three states, and the middle one is the point
 *
 * - **Nothing points at it** - an ordinary confirm, as before.
 * - **Something points at it and the delete still proceeds** - the rows are
 *   listed as consequences. This is the expense-category case, where the button
 *   says Delete and the record is deactivated instead.
 * - **Something blocks it** - the confirm button is gone entirely, replaced by
 *   the reason and what to do instead. Offering a button that the server will
 *   refuse is offering a decision the person does not have.
 *
 * ## The preview is advisory
 *
 * The server's own guards still run on the write, and they are the authority:
 * between opening this dialog and pressing the button, somebody else can raise
 * a ticket against the service being deleted. `error` is still rendered, so a
 * refusal that arrives anyway is shown where the button was.
 */
export function DeleteWithPreview({
  /** The registry key - `taxonomy`, `service`, `expense-category`, … */
  type,
  /** The record being deleted, or null when the dialog is closed. */
  record,
  onClose,
  onConfirm,
  loading = false,
  error,
  /** Overrides the question. Defaults to naming the record and its type. */
  title,
  confirmLabel = 'Delete',
}) {
  const open = Boolean(record);
  const { data: preview, isLoading } = useDeletePreview(type, record?.id, open);

  const impacts = preview?.impacts ?? [];
  const blocked = Boolean(preview?.blocked);

  // The record's own name, preferred from the preview because that is the
  // server's spelling of it - the row in hand may carry a label the list
  // shortened.
  const name = preview?.name ?? record?.name ?? record?.label ?? 'this record';
  const typeLabel = preview?.typeLabel ?? 'record';

  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      onConfirm={onConfirm}
      loading={loading}
      error={error}
      title={title ?? `Delete ${name}?`}
      // Blocked deletes lose the confirm button entirely rather than showing a
      // disabled one: the reason is the answer, not the button.
      confirmLabel={blocked ? null : confirmLabel}
      cancelLabel={blocked ? 'Close' : 'Cancel'}
      tone="danger"
      body={
        <span className="block space-y-3">
          {isLoading ? (
            <span className="flex items-center gap-2 text-sm text-ink-500">
              <Loader2 className="size-3.5 animate-spin" strokeWidth={2.25} aria-hidden="true" />
              Checking what this is used by…
            </span>
          ) : impacts.length === 0 ? (
            <span className="block text-sm leading-relaxed text-ink-600">
              Nothing points at this {typeLabel}, so deleting it affects nothing else.
            </span>
          ) : (
            <>
              <span className="block text-sm leading-relaxed text-ink-600">
                {blocked
                  ? `This ${typeLabel} cannot be deleted while these exist:`
                  : `Deleting this ${typeLabel} affects:`}
              </span>

              <ul className="block space-y-2">
                {impacts.map((row) => (
                  <li
                    key={row.label}
                    className={cn(
                      'flex items-start gap-2 rounded-md px-3 py-2.5 text-sm leading-relaxed',
                      row.blocks ? 'bg-danger-50 text-ink-700' : 'bg-surface-2 text-ink-700',
                    )}
                  >
                    {row.blocks ? (
                      <Ban className="mt-0.5 size-4 shrink-0 text-danger" strokeWidth={2} aria-hidden="true" />
                    ) : (
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" strokeWidth={2} aria-hidden="true" />
                    )}
                    <span className="min-w-0">
                      <span className="font-semibold text-ink-900">{row.label}</span>
                      {row.note && <span className="mt-0.5 block text-ink-500">{row.note}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </span>
      }
    />
  );
}

export default DeleteWithPreview;
