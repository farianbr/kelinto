import PageHeader from '@/components/admin/PageHeader';
import { ADMIN_ROUTES } from '@/lib/adminRoutes';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import { CatalogCategoriesSection } from '@/pages/admin/AdminCatalogCategoriesPage';

const ROUTE = ADMIN_ROUTES['/admin/settings/taxonomy'];

/**
 * Settings › Taxonomy (client rulings, 2026-10-02).
 *
 * ## What it is opened for
 *
 * "Set up what the website sells." One list of every catalogue type: Parts,
 * Phones, Services and any a business adds. A row opens the type's name, its
 * category levels, grades and features; its Category tree button
 * opens the type's tree.
 *
 * The Services tree is also the device list a ticket, a quote, an invoice
 * and the kiosk pick from: Serviced items, a second list of the same devices,
 * was retired on 2026-10-03 (client: it overlapped the category tree).
 */
export function AdminTaxonomyHubPage() {
  return (
    <>
      <PageHeader icon={adminIcon('Network')} title={ROUTE.title} description={ROUTE.description} />
      <CatalogCategoriesSection
        kinds={['part', 'phone', 'service']}
        title="Types"
        description="Open a type to rename it and set its category levels, grades and features. Its tree holds the entries."
        addLabel="Add product type"
      />
    </>
  );
}

export default AdminTaxonomyHubPage;
