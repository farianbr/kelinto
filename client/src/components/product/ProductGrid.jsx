import { PackageSearch } from 'lucide-react';
import cn from '@/lib/cn';
import ProductCard from './ProductCard';
import Skeleton from '@/components/ui/Skeleton';
import Button from '@/components/ui/Button';
import useFilterStore from '@/store/filterStore';
import { useCatalogConfig } from '@/lib/catalogs';

/**
 * The grid. 2 / 3 / 4 per row (brief §6) - the only thing on the shop page that
 * re-renders when a filter changes.
 *
 * While a refetch is in flight the previous results stay mounted under a veil
 * rather than being replaced by skeletons; that is what makes filtering read as
 * instant instead of as a page reload.
 */
export function ProductGrid({
  products = [],
  isLoading,
  isFetching,
  error,
  // The empty state is overridable because this grid now serves pages with no
  // filters at all. "No parts match those filters" and a Clear all filters
  // button are the wrong answer on the clearance page, where there is nothing
  // to clear - the list is simply empty today.
  emptyTitle,
  emptyBody,
  /**
   * How one item is drawn. Defaults to the part card; the Phones and Services
   * pages pass their own, and everything else about the grid (skeletons, the
   * veil while refetching, the empty state) stays this one implementation.
   */
  renderItem = (product) => <ProductCard key={product.id} product={product} />,
}) {
  const resetAll = useFilterStore((s) => s.resetAll);
  const catalog = useCatalogConfig();

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-danger/20 bg-danger-50 px-6 py-14 text-center">
        <h3 className="text-lg">Could not load {catalog.nouns}</h3>
        <p className="max-w-sm text-md text-ink-500">{error.message}</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 xl:grid-cols-4">
        {Array.from({ length: 12 }).map((_, index) => (
          <div
            key={index}
            className="overflow-hidden rounded-lg border border-line bg-surface"
          >
            <Skeleton className="aspect-4/3 rounded-none" />
            <div className="space-y-2.5 p-4">
              <Skeleton className="h-2.5 w-16" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-6 w-24" />
              <Skeleton className="h-9 w-full" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-line bg-surface px-6 py-16 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-surface-2 text-ink-300">
          <PackageSearch className="size-7" strokeWidth={1.5} />
        </span>
        <div>
          <h3 className="text-lg">{emptyTitle ?? `No ${catalog.nouns} match those filters`}</h3>
          <p className="mx-auto mt-1.5 max-w-sm text-md text-ink-500">
            {emptyBody ??
              (catalog.kind === 'part'
                ? 'Try widening the model or clearing a grade.'
                : 'Try another device or repair type, or ask us for a quote.')}
          </p>
        </div>
        {!emptyTitle && (
          <Button variant="outline" size="sm" onClick={resetAll}>
            Clear all filters
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      {/* 2 up on phones, 3 through tablet, 4 only from xl. At lg the 264px
          sidebar reappears, so a fourth column there left each card under
          200px - narrower than the same card gets on a phone. */}
      <div
        className={cn(
          'grid grid-cols-2 gap-3 transition-opacity duration-snap md:grid-cols-3 md:gap-4 xl:grid-cols-4',
          isFetching && 'opacity-60',
        )}
      >
        {products.map((product) => renderItem(product))}
      </div>

      {isFetching && (
        <div
          className="pointer-events-none absolute inset-x-0 -top-1 h-0.5 overflow-hidden rounded-full bg-line"
          role="status"
          aria-label="Updating results"
        >
          <div className="h-full w-1/3 animate-[loading_1.1s_ease-in-out_infinite] bg-brand-gradient" />
        </div>
      )}
    </div>
  );
}

export default ProductGrid;
