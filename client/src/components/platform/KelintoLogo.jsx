import cn from '@/lib/cn';

/**
 * Kelinto's wordmark: the name, set in DM Sans bold with tight tracking, and
 * nothing beside it.
 *
 * Earlier versions carried a stacked-layers glyph in a coloured tile, then a
 * small square; both read as decoration rather than a mark (client ruling
 * 2026-09-25). A name set well is enough of a logo, and it is the one thing
 * nobody else has. `size` scales from the text size, so there is no asset to
 * keep per placement.
 */
export function KelintoLogo({ size = 'md', subtitle, className }) {
  const text = { sm: 'text-xl', md: 'text-2xl', lg: 'text-3xl' }[size] ?? 'text-2xl';
  return (
    <span className={cn('inline-flex items-center gap-3', className)}>
      <span className={cn('font-kelinto font-bold leading-none tracking-tighter text-plat-text', text)}>kelinto</span>
      {subtitle && (
        <span className="border-l border-plat-line pl-3 text-xs font-semibold uppercase tracking-wider text-plat-dim">
          {subtitle}
        </span>
      )}
    </span>
  );
}

export default KelintoLogo;
