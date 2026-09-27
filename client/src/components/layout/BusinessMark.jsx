import cn from '@/lib/cn';
import useBusinessInfo from '@/hooks/useBusinessInfo';

/**
 * The website's mark: the logo this business uploaded in the ERP (Settings ›
 * Business info), or its name set as a wordmark until it has one.
 *
 * One component for the header, the phone header and the drawer, so the three
 * cannot disagree about what a business looks like. There is no bundled
 * fallback artwork any more: a file shipped with the app is one company's
 * mark, and it used to appear on every other business's website.
 *
 * @param size `lg` (desktop header), `md` (phone header), `sm` (drawer).
 */
const LOGO_HEIGHT = { lg: 'h-9', md: 'h-8', sm: 'h-7' };
const WORDMARK = { lg: 'text-xl', md: 'text-lg', sm: 'text-lg' };

export function BusinessMark({ size = 'lg', className }) {
  const info = useBusinessInfo();

  if (info.logoUrl) {
    // First thing painted on every page, so fetched early and decoded off the
    // main thread. The file itself is already optimised on upload.
    return (
      <img
        src={info.logoUrl}
        alt={info.name}
        fetchPriority={size === 'sm' ? undefined : 'high'}
        decoding="async"
        className={cn(LOGO_HEIGHT[size], 'w-auto', className)}
      />
    );
  }
  return (
    <span className={cn('block truncate font-display font-bold text-ink-900', WORDMARK[size], className)}>
      {info.name}
    </span>
  );
}

export default BusinessMark;
