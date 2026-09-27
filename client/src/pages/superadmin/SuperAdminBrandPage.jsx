import { useRef, useState } from 'react';
import { RotateCcw, Upload } from 'lucide-react';
import { PlatformButton, PlatformHeader, PlatformPageSkeleton, PlatformPanel } from '@/components/superadmin/PlatformUI';
import { PlatformConfirm, PlatformError, PlatformNotice } from '@/components/superadmin/PlatformForm';
import KelintoLogo from '@/components/platform/KelintoLogo';
import { usePlatformBrand, usePlatformBrandMutations } from '@/hooks/usePlatformBrand';
import { toast } from '@/store/toastStore';
import useUploadSession from '@/hooks/useUploadSession';

/**
 * Kelinto's own logo and browser-tab icon.
 *
 * These are Kelinto's files, not any business's: they appear on kelinto.com,
 * the shared ERP sign-in and this console, and live in R2 under `platform/`.
 * A business's own logo and icon are set by that business in its ERP.
 *
 * Picking a file uploads it first and then asks: the new mark goes public on
 * three sites the moment it is saved, so it is shown and confirmed rather than
 * applied on the file picker's click.
 */
const SLOTS = [
  {
    field: 'logoUrl',
    kind: 'logo',
    label: 'Logo',
    where: 'kelinto.com, the ERP sign-in and this console',
    fallback: 'The "kelinto" wordmark set in type.',
    accept: 'image/png,image/jpeg,image/webp,image/gif,image/avif',
  },
  {
    field: 'faviconUrl',
    kind: 'favicon',
    label: 'Icon',
    where: 'the browser tab on kelinto.com, the ERP sign-in and this console',
    fallback: 'A neutral placeholder icon.',
    accept: 'image/png,image/x-icon,image/vnd.microsoft.icon,image/webp,image/gif',
  },
];

export function SuperAdminBrandPage() {
  const { data, isLoading } = usePlatformBrand();
  const { upload, save } = usePlatformBrandMutations();
  // `{ slot, url }`: a file uploaded and waiting for the operator to confirm it,
  // or `{ slot, url: '' }` for a reset to the default.
  const [pending, setPending] = useState(null);
  const [error, setError] = useState(null);
  // The file waiting on the confirmation is deleted if it is not confirmed.
  const uploads = useUploadSession({ discardPath: '/superadmin/assets/discard' });

  if (isLoading) return <PlatformPageSkeleton />;

  async function choose(slot, file) {
    setError(null);
    try {
      const { url } = await upload.mutateAsync({ file, kind: slot.kind });
      uploads.track(url);
      setPending({ slot, url });
    } catch (err) {
      setError(err.message);
    }
  }

  async function confirm() {
    try {
      await save.mutateAsync({ [pending.slot.field]: pending.url });
      uploads.settle();
      toast.ok(`${pending.slot.label} ${pending.url ? 'updated' : 'reset to the default'}`);
      setPending(null);
    } catch {
      // Shown in the dialog.
    }
  }

  return (
    <>
      <PlatformHeader
        crumbs={[{ label: 'Overview', to: '/superadmin' }, { label: 'Brand' }]}
        title="Kelinto brand"
        description="Kelinto's own logo and browser-tab icon. Each business sets its own in its ERP, under Settings."
      />

      {data?.uploads === false && (
        <div className="mb-4">
          <PlatformNotice>
            File storage is not set up on this installation, so nothing can be uploaded yet. Set the R2 values in the
            server&apos;s environment and restart.
          </PlatformNotice>
        </div>
      )}
      {error && (
        <div className="mb-4">
          <PlatformError>{error}</PlatformError>
        </div>
      )}

      <div className="space-y-4">
        {SLOTS.map((slot) => (
          <BrandSlot
            key={slot.field}
            slot={slot}
            value={data?.[slot.field] ?? ''}
            busy={upload.isPending && upload.variables?.kind === slot.kind}
            disabled={data?.uploads === false}
            onFile={(file) => choose(slot, file)}
            onReset={() => setPending({ slot, url: '' })}
          />
        ))}
      </div>

      <PlatformConfirm
        open={Boolean(pending)}
        onClose={() => {
          // Not confirmed: the file was uploaded for nothing, so it goes.
          uploads.drop(pending?.url);
          setPending(null);
        }}
        onConfirm={confirm}
        isPending={save.isPending}
        error={save.error?.message}
        title={pending?.url ? `Use this as Kelinto's ${pending?.slot.label.toLowerCase()}?` : `Reset Kelinto's ${pending?.slot.label.toLowerCase()}?`}
        confirmLabel={pending?.url ? 'Use it' : 'Reset'}
      >
        {pending?.url ? (
          <>
            <img src={pending.url} alt="" className="max-h-24 rounded-md border border-plat-line bg-plat-bg object-contain p-2" />
            <p>It replaces the current one on {pending.slot.where}, straight away.</p>
          </>
        ) : (
          <p>
            {pending?.slot.where} go back to the default: {pending?.slot.fallback.toLowerCase()} The current file is
            deleted.
          </p>
        )}
      </PlatformConfirm>
    </>
  );
}

function BrandSlot({ slot, value, busy, disabled, onFile, onReset }) {
  const input = useRef(null);
  return (
    <PlatformPanel title={slot.label} description={`Shown on ${slot.where}.`}>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex h-16 min-w-40 items-center justify-center rounded-lg border border-plat-line bg-plat-bg px-3">
          {value ? (
            <img src={value} alt="" className="max-h-12 object-contain" />
          ) : slot.kind === 'logo' ? (
            <KelintoLogo size="sm" />
          ) : (
            <img src="/placeholder-favicon.svg" alt="" className="size-8" />
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <PlatformButton variant="primary" icon={Upload} loading={busy} disabled={disabled} onClick={() => input.current?.click()}>
            {value ? 'Replace' : 'Upload'}
          </PlatformButton>
          {value && (
            <PlatformButton variant="secondary" icon={RotateCcw} onClick={onReset}>
              Use the default
            </PlatformButton>
          )}
        </div>
        <input
          ref={input}
          type="file"
          accept={slot.accept}
          className="hidden"
          tabIndex={-1}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) onFile(file);
          }}
        />
      </div>
      {!value && <p className="mt-3 text-sm text-plat-muted">Not set: {slot.fallback}</p>}
    </PlatformPanel>
  );
}

export default SuperAdminBrandPage;
