import { useId, useRef, useState } from 'react';
import { AlertCircle, ImageOff, Upload, VideoOff, X } from 'lucide-react';
import cn from '@/lib/cn';
import api from '@/lib/api';
import { uploadThumb } from '@/lib/media';
import Button from '@/components/ui/Button';
import { useDensity, labelSize, hintSize } from '@/components/ui/density';

/**
 * One uploaded file on a form: a logo, a favicon, a product picture or video.
 *
 * Choosing a file uploads it straight away. The server optimises it before
 * storing it (resized, re-encoded, metadata stripped; see
 * `server/src/services/mediaProcessor.js`), and the field takes the address of
 * the finished file. **Saving the form** is what attaches it to the record,
 * exactly like typing into any other field.
 *
 * Until then it is tracked in the form's `session` (`useUploadSession`): picking
 * another file or pressing Remove deletes the unsaved one at once, and leaving
 * the form without saving deletes whatever is left. A file that WAS saved is
 * only emptied here; the save that stops using it deletes it.
 *
 * @param endpoint `identity` (logos, favicon), `catalogue` (product media) or
 *   `marketing` (a Google reviewer's photo).
 * @param kind the upload slot: `logo`, `footer-logo`, `favicon`,
 *   `product-image`, `product-video`.
 * @param shape how the preview is drawn: `wide` for a logo, `square` for an
 *   icon or product picture, `video`.
 * @param onChange `(url, { poster })` - a video's poster frame comes with it.
 */
const ACCEPT = {
  logo: 'image/png,image/jpeg,image/webp,image/gif,image/avif',
  'footer-logo': 'image/png,image/jpeg,image/webp,image/gif,image/avif',
  favicon: 'image/png,image/x-icon,image/vnd.microsoft.icon,image/webp,image/gif',
  'product-image': 'image/png,image/jpeg,image/webp,image/gif,image/avif',
  'product-video': 'video/mp4,video/quicktime,video/webm',
  'review-photo': 'image/png,image/jpeg,image/webp,image/gif,image/avif',
};

const PREVIEW = {
  wide: 'h-16 w-40',
  square: 'size-16',
  video: 'h-24 w-40',
};

export function AssetUpload({
  label,
  hint,
  value,
  poster,
  onChange,
  endpoint,
  kind,
  shape = 'square',
  placeholder,
  session,
  className,
}) {
  const density = useDensity();
  const input = useRef(null);
  const id = useId();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const isVideo = shape === 'video';

  async function pick(event) {
    const file = event.target.files?.[0];
    // Cleared so choosing the same file again after an error still fires.
    event.target.value = '';
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const result = await api.upload(`/admin/assets/${endpoint}`, file, { kind });
      // The file this one replaces, if it was never saved, goes now.
      session?.drop(value);
      session?.track(result.url);
      onChange(result.url, { poster: result.poster ?? '' });
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  function remove() {
    session?.drop(value);
    onChange('', { poster: '' });
  }

  const Empty = isVideo ? VideoOff : ImageOff;

  return (
    <div className={cn('w-full', className)}>
      <p id={`${id}-label`} className={cn(labelSize(density), 'block font-medium text-ink-700')}>
        {label}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <div
          className={cn(
            'flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-line bg-surface-2',
            PREVIEW[shape],
          )}
        >
          {value ? (
            isVideo ? (
              // The poster only: a preview tile has no reason to download the video.
              poster ? (
                <img src={poster} alt="" className="size-full object-cover" decoding="async" />
              ) : (
                <video src={value} className="size-full object-cover" muted playsInline preload="metadata" />
              )
            ) : (
              <img src={uploadThumb(value)} alt="" className="size-full object-contain p-1.5" decoding="async" />
            )
          ) : (
            <span className="flex flex-col items-center gap-1 px-2 text-center text-xs text-ink-400">
              <Empty className="size-4" strokeWidth={1.75} aria-hidden="true" />
              {placeholder ?? 'None yet'}
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            icon={Upload}
            loading={uploading}
            aria-describedby={`${id}-label`}
            onClick={() => input.current?.click()}
          >
            {value ? 'Replace' : 'Upload'}
          </Button>
          {value && !uploading && (
            <Button size="sm" variant="ghost" icon={X} onClick={remove}>
              Remove
            </Button>
          )}
        </div>

        <input ref={input} type="file" accept={ACCEPT[kind]} className="hidden" onChange={pick} tabIndex={-1} />
      </div>

      {error ? (
        <p className={cn(hintSize(density), 'flex items-center gap-1.5 text-danger')}>
          <AlertCircle className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
          {error}
        </p>
      ) : uploading ? (
        <p className={cn(hintSize(density), 'text-ink-400')} aria-live="polite">
          {isVideo ? 'Uploading and compressing the video. This can take a minute.' : 'Uploading and optimising…'}
        </p>
      ) : hint ? (
        <p className={cn(hintSize(density), 'text-ink-400')}>{hint}</p>
      ) : null}
    </div>
  );
}

export default AssetUpload;
