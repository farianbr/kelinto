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
 */
export function KelintoLogo({ size = 'md', subtitle, className }) {
  const text = { sm: 'text-xl', md: 'text-2xl', lg: 'text-3xl' }[size] ?? 'text-2xl';
  const height = { sm: 'h-6', md: 'h-7', lg: 'h-9' }[size] ?? 'h-7';
  // A logo uploaded in the console (Brand) replaces the typeset name.
  const { data: brand } = usePlatformBrand();
  return (
    <span className={cn('inline-flex items-center gap-3', className)}>
      {brand?.logoUrl ? (
        <img src={brand.logoUrl} alt="Kelinto" className={cn(height, 'w-auto')} />
      ) : (
        <span className={cn('font-kelinto font-bold leading-none tracking-tighter text-plat-text', text)}>kelinto</span>
      )}
      {subtitle && (
        <span className="border-l border-plat-line pl-3 text-xs font-semibold uppercase tracking-wider text-plat-dim">
          {subtitle}
        </span>
      )}
    </span>
  );
}

export default KelintoLogo;
