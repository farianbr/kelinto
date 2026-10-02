import { Link, Navigate, useLocation, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';

import api from '@/lib/api';
import { catalogFrom } from '@/lib/catalogs';
import { categoryPath } from '@shared/catalog';
import { useCatalogCategories } from '@/hooks/useCatalog';
import Skeleton from '@/components/ui/Skeleton';
import ServiceCard from '@/components/product/ServiceCard';
import CatalogPage from './CatalogPage';

/**
 * Every type's page on the website, at `/catalogue/<address>` (client ruling
 * 2026-10-03: "all of these should be under /catalogue so that it is clear
 * that these are sellable items").
 *
 * Parts, Phones, Services and every type a business adds are this one page:
 * the address names the type (its own to edit in Settings › Taxonomy), the
 * type configures the shared shop page (`CatalogPage`), and only the card
 * differs for services. A type switched off, or an address that names
 * nothing, says so rather than showing an empty catalogue that looks broken.
 */
export function CataloguePage() {
  const { address } = useParams();
  const { search } = useLocation();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['catalog-at', address],
    queryFn: () => api.get(`/catalog/at/${address}`),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) return <CatalogueSkeleton />;
  if (isError || !data?.category) return <NotOnSale />;
  // An address the type used to have: forwarded to the one it has now.
  if (data.category.address && data.category.address !== address) {
    return <Navigate to={`${categoryPath(data.category)}${search}`} replace />;
  }

  const catalog = catalogFrom(data.category);
  // Keyed on the type: moving between two must not carry one's filters into the other's tree.
  return (
    <CatalogPage
      key={catalog.slug}
      catalog={catalog}
      renderItem={catalog.kind === 'service' ? (service) => <ServiceCard key={service.id} service={service} /> : undefined}
    />
  );
}

/**
 * An address a type used to live at (`/shop`, `/pre-owned`, `/services`,
 * `/catalog/<slug>`), forwarded to its page under `/catalogue` with the query
 * intact, so every link ever shared still lands on the same filtered page.
 */
export function LegacyCatalogueRedirect({ slug: fixedSlug = null }) {
  const params = useParams();
  const { search } = useLocation();
  const slug = fixedSlug ?? params.slug;
  const { data: categories, isLoading } = useCatalogCategories();

  if (isLoading) return <CatalogueSkeleton />;
  const category = (categories ?? []).find((entry) => entry.slug === slug);
  if (!category) return <NotOnSale />;
  return <Navigate to={`${categoryPath(category)}${search}`} replace />;
}

function CatalogueSkeleton() {
  return (
    <div className="mx-auto max-w-[1400px] px-3 py-4 sm:px-4 lg:px-6 lg:py-6">
      <Skeleton className="mb-6 h-20 rounded-lg" />
      <Skeleton className="h-96 rounded-lg" />
    </div>
  );
}

function NotOnSale() {
  return (
    <div className="mx-auto max-w-lg px-4 py-20 text-center">
      <h1 className="text-2xl">That section is not on sale</h1>
      <p className="mt-3 text-md text-ink-500">It may have been switched off, or the link may be wrong.</p>
      <Link to="/" className="mt-6 inline-flex items-center gap-1.5 text-md font-semibold text-brand hover:text-brand-700">
        Back to the home page
        <ArrowRight className="size-4" strokeWidth={2} aria-hidden="true" />
      </Link>
    </div>
  );
}

export default CataloguePage;
