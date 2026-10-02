import { Link } from 'react-router';
import { SlidersHorizontal } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { count as formatCount } from '@/lib/format';
import { CatalogProvider } from '@/lib/catalogs';
import SelectMenu from '@/components/ui/SelectMenu';
import Button from '@/components/ui/Button';
import Drawer from '@/components/ui/Drawer';
import TabWizard from '@/components/filters/TabWizard';
import SidebarFilter from '@/components/filters/SidebarFilter';
import ActiveFilterChips from '@/components/filters/ActiveFilterChips';
import ProductGrid from '@/components/product/ProductGrid';
import Pagination from '@/components/ui/Pagination';
import { useProducts } from '@/hooks/useCatalog';
import useDocumentTitle from '@/hooks/useDocumentTitle';
import useFilterUrlSync from '@/hooks/useFilterUrlSync';
import useFilterLabelSync from '@/hooks/useFilterLabelSync';
import useFilterStore from '@/store/filterStore';
import useUiStore from '@/store/uiStore';

/**
 * One shop page, for any catalogue (2026-10-01).
 *
 * The Parts page, generalised: Parts, Phones, Services and every category a
 * business adds are this page with a different `catalog` (`lib/catalogs.js`)
 * and a different card. The client asked for all three to be "the same like
 * the parts page", and the honest way to keep them the same is for them to be
 * one component: a fix to the rail or the grid lands on every shop page at
 * once rather than on whichever one somebody remembered.
 *
 * No hero, no marketing block (brief §3): a buyer lands on filterable stock.
 */
export function CatalogPage({ catalog, renderItem, notice = null }) {
  // A type switched off in Settings › Taxonomy has no page, whichever it is.
  if (!catalog) {
    return (
      <div className="mx-auto max-w-lg px-4 py-20 text-center">
        <h1 className="text-2xl">That section is not on sale</h1>
        <p className="mt-3 text-md text-ink-500">It may have been switched off, or the link may be wrong.</p>
        <Link to="/" className="mt-6 inline-flex items-center gap-1.5 text-md font-semibold text-brand hover:text-brand-700">
          Back to the home page
        </Link>
      </div>
    );
  }
  return (
    <CatalogProvider catalog={catalog}>
      <CatalogBody catalog={catalog} renderItem={renderItem} notice={notice} />
    </CatalogProvider>
  );
}

function CatalogBody({ catalog, renderItem, notice }) {
  // Under the provider, so both read this catalogue's tree.
  useFilterUrlSync();
  useFilterLabelSync();
  // Every type is under /catalogue now, so the route has no label of its own to fall back on.
  useDocumentTitle(catalog.slug === 'parts' ? 'Shop all parts' : catalog.title);

  const { data, isLoading, isFetching, error } = useProducts();

  const { sort, setSort, page, setPage } = useFilterStore(
    useShallow((s) => ({ sort: s.sort, setSort: s.setSort, page: s.page, setPage: s.setPage })),
  );

  const mobileFiltersOpen = useUiStore((s) => s.mobileFiltersOpen);
  const openMobileFilters = useUiStore((s) => s.openMobileFilters);
  const closeMobileFilters = useUiStore((s) => s.closeMobileFilters);

  const total = data?.total ?? 0;
  const items = data?.[catalog.itemsKey] ?? [];

  return (
    <div className="mx-auto max-w-[1400px] px-3 py-4 sm:px-4 lg:px-6 lg:py-6">
      {/* ---- guided tab wizard ------------------------------------------- */}
      <div className="mb-4 lg:mb-6">
        <TabWizard />
      </div>

      <div className="lg:grid lg:grid-cols-[264px_minmax(0,1fr)] lg:gap-6">
        {/* ---- sidebar (desktop) ----------------------------------------- */}
        <div className="hidden lg:block">
          {/* pb-4 inside the scroller: the rail is taller than this box on most
              screens, so scrolling it to the end used to butt its rounded bottom
              border straight against the clip edge with nothing under it. */}
          <div className="sticky top-[calc(var(--chrome-h,158px)+16px)] max-h-[calc(100vh-var(--chrome-h,158px)-36px)] overflow-y-auto pb-4 scroll-slim">
            <SidebarFilter facets={data?.facets} />
          </div>
        </div>

        {/* ---- results ---------------------------------------------------- */}
        <section aria-label={catalog.title} className="min-w-0">
          <div className="mb-3 flex min-w-0 flex-wrap items-center gap-2.5">
            <h1 className="font-display text-lg font-bold sm:text-xl">
              {catalog.title}
              <span className="tnum ml-2 text-md font-medium text-ink-400">
                {isLoading ? '-' : `${formatCount(total)} results`}
              </span>
            </h1>

            {/* Below sm these two take a row of their own and split it evenly.
                Squeezed onto the heading's row the sort control could not fit
                its longest label and the text ran under the chevron. Sort is a
                `SelectMenu`, not a native `<select>`: the browser draws a native
                popup wider than its trigger and lets it run off the right edge
                of a narrow window. */}
            <div className="ml-auto flex w-full min-w-0 items-center gap-2 sm:w-auto">
              <Button
                variant="outline"
                size="sm"
                icon={SlidersHorizontal}
                onClick={openMobileFilters}
                className="min-w-0 flex-1 basis-0 sm:flex-none sm:basis-auto lg:hidden"
              >
                Filters
              </Button>

              <SelectMenu
                size="sm"
                options={catalog.sortOptions}
                value={sort}
                onChange={setSort}
                srLabel={`Sort ${catalog.nouns}`}
                align="right"
                className="min-w-0 flex-1 basis-0 sm:w-[170px] sm:flex-none sm:basis-auto"
              />
            </div>
          </div>

          <div className="mb-3">
            <ActiveFilterChips facetMeta={data?.facets} />
          </div>

          {notice}

          <ProductGrid
            products={items}
            isLoading={isLoading}
            isFetching={isFetching && !isLoading}
            error={error}
            renderItem={renderItem}
          />

          {data?.pages > 1 && (
            <Pagination
              page={page}
              pages={data.pages}
              onChange={(next) => {
                setPage(next);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="mt-8"
            />
          )}
        </section>
      </div>

      {/* ---- sidebar (mobile, as a drawer) -------------------------------- */}
      <Drawer
        open={mobileFiltersOpen}
        onClose={closeMobileFilters}
        side="left"
        title="Filters"
        width="w-[88vw] max-w-[340px]"
        footer={
          <div className="p-3">
            <Button fullWidth onClick={closeMobileFilters}>
              Show {formatCount(total)} results
            </Button>
          </div>
        }
      >
        <SidebarFilter facets={data?.facets} className="rounded-none border-0" />
      </Drawer>
    </div>
  );
}

export default CatalogPage;
