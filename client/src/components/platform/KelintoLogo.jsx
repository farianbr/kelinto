import cn from '@/lib/cn';
import { usePlatformBrand } from '@/hooks/usePlatformBrand';

/**
 * Kelinto's wordmark: the name, set in DM Sans bold with tight tracking, and
 * nothing beside it.
 *
 * Earlier versions carried a stacked-layers glyph in a coloured tile, then a
 * small square; both read as decoration rather than a mark (client ruling
 * 2026-09-25). A name set well is enough of a logo, and it is the one thing
 * nobody else has. `size` scales from the text size, so there is no asset to
 * keep per placement.
 *
 * `stacked` centres the mark and sets the subtitle underneath it instead of
 * beside it, for a screen where the logo stands alone above a form (the
 * sign-in pages) rather than at the start of a row.
 */
export function KelintoLogo({ size = 'md', subtitle, stacked = false, className }) {
  const text = { sm: 'text-xl', md: 'text-2xl', lg: 'text-3xl' }[size] ?? 'text-2xl';
  const height = { sm: 'h-6', md: 'h-7', lg: 'h-9' }[size] ?? 'h-7';
  // A logo uploaded in the console (Brand) replaces the typeset name.
  const { data: brand } = usePlatformBrand();
  // Block-level `flex`, not `inline-flex`: an inline box sits on its parent's
  // text baseline and keeps the descender space below it, which left a strip
  // under the logo that nothing else in a header row has. `w-fit max-w-full`
  // keeps it no wider than its content, and never wider than its container.
  return (
    <span
      className={cn(
        'flex w-fit min-w-0 max-w-full',
        stacked ? 'mx-auto flex-col items-center gap-2' : 'items-center gap-3',
        className,
      )}
    >
      {brand?.logoUrl ? (
        // An uploaded logo is whatever width its artwork is. It shrinks to the
        // space left beside the subtitle (object-contain keeps its proportions)
        // rather than pushing the subtitle out of a 240px rail.
        <img
          src={brand.logoUrl}
          alt="Kelinto"
          className={cn(height, 'block w-auto min-w-0 max-w-full object-contain', stacked ? 'object-center' : 'object-left')}
        />
      ) : (
        <span className={cn('font-kelinto font-bold leading-none tracking-tighter text-plat-text', text)}>kelinto</span>
      )}
      {subtitle && (
        <span
          className={cn(
            'shrink-0 text-xs font-semibold uppercase tracking-wider text-plat-dim',
            !stacked && 'border-l border-plat-line pl-3',
          )}
        >
          {subtitle}
        </span>
      )}
    </span>
  );
}

export default KelintoLogo;
