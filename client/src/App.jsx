import { Suspense, lazy } from 'react';
import Toaster from '@/components/ui/Toaster';
import { Navigate, Route, Routes } from 'react-router';
import RootLayout from '@/components/layout/RootLayout';
import RouteProgress from '@/components/layout/RouteProgress';
import useEarlyBusinessTheme from '@/hooks/useEarlyBusinessTheme';
import ShopPage from '@/pages/ShopPage';
import HomeOrShop from '@/components/layout/HomeOrShop';
import RouteFallback from '@/components/layout/RouteFallback';
import GoToPanel, { GoToHost } from '@/components/layout/GoToPanel';
import { superAdminHost, panelBusiness, panelHost, surface } from '@/lib/surface';

/**
 * The Shop page owns "/" and is the landing surface for every visitor, so it
 * ships in the main bundle. Everything else is split: a guest browsing the
 * catalogue should never download the account dashboard.
 */
const ProductDetailPage = lazy(() => import('@/pages/ProductDetailPage'));
const CartPage = lazy(() => import('@/pages/CartPage'));
const CheckoutPage = lazy(() => import('@/pages/CheckoutPage'));
const ThankYouPage = lazy(() => import('@/pages/ThankYouPage'));
const PaymentFailedPage = lazy(() => import('@/pages/PaymentFailedPage'));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'));
const AboutPage = lazy(() => import('@/pages/AboutPage'));
const ResetPasswordPage = lazy(() => import('@/pages/ResetPasswordPage'));
const PanelSignInPage = lazy(() => import('@/pages/PanelSignInPage'));
const PlatformLandingPage = lazy(() => import('@/pages/PlatformLandingPage'));
const ContactPage = lazy(() => import('@/pages/ContactPage'));
const BlogPage = lazy(() => import('@/pages/BlogPage'));
const BlogPostPage = lazy(() => import('@/pages/BlogPostPage'));
const FaqPage = lazy(() => import('@/pages/FaqPage'));
const OffersPage = lazy(() => import('@/pages/OffersPage'));
const DealPage = lazy(() => import('@/pages/DealPage'));
const ClearancePage = lazy(() => import('@/pages/ClearancePage'));
// Public and outside RootLayout: somebody arriving here is leaving, and the
// shop header would be reading the moment badly (phase 9, §6.13).
const UnsubscribePage = lazy(() => import('@/pages/UnsubscribePage'));
const CustomerPortalPage = lazy(() => import('@/pages/CustomerPortalPage'));
const KioskPage = lazy(() => import('@/pages/KioskPage'));

const SupplierPortalLayout = lazy(() => import('@/components/supplier/SupplierPortalLayout'));
const SupplierDashboardPage = lazy(() => import('@/pages/supplier/SupplierDashboardPage'));
const SupplierPurchaseOrderPage = lazy(() => import('@/pages/supplier/SupplierPurchaseOrderPage'));
const SupplierOrdersPage = lazy(() => import('@/pages/supplier/SupplierOrdersPage'));
const SupplierProformasPage = lazy(() => import('@/pages/supplier/SupplierProformasPage'));
const SupplierDeliveriesPage = lazy(() => import('@/pages/supplier/SupplierDeliveriesPage'));
const SupplierProfilePage = lazy(() => import('@/pages/supplier/SupplierProfilePage'));
const SupplierAgreementPage = lazy(() => import('@/pages/supplier/SupplierAgreementPage'));
const SupplierBusinessesPage = lazy(() => import('@/pages/supplier/SupplierBusinessesPage'));
const SupplierResetPage = lazy(() => import('@/pages/supplier/SupplierResetPage'));
const SuperAdminLayout = lazy(() => import('@/components/superadmin/SuperAdminLayout'));
const SuperAdminTenantsPage = lazy(() => import('@/pages/superadmin/SuperAdminTenantsPage'));
const SuperAdminPlansPage = lazy(() => import('@/pages/superadmin/SuperAdminPlansPage'));
const SuperAdminSupportPage = lazy(() => import('@/pages/superadmin/SuperAdminSupportPage'));

const AccountLayout = lazy(() => import('@/components/account/AccountLayout'));
const AccountOverviewPage = lazy(() => import('@/pages/account/AccountOverviewPage'));
const AccountOrdersPage = lazy(() => import('@/pages/account/AccountOrdersPage'));
const AccountOrderDetailPage = lazy(() => import('@/pages/account/AccountOrderDetailPage'));
const AccountInvoicesPage = lazy(() => import('@/pages/account/AccountInvoicesPage'));
const AccountCreditPage = lazy(() => import('@/pages/account/AccountCreditPage'));
const AccountActivityPage = lazy(() => import('@/pages/account/AccountActivityPage'));
const AccountReferralsPage = lazy(() => import('@/pages/account/AccountReferralsPage'));
const AccountQuickOrderPage = lazy(() => import('@/pages/account/AccountQuickOrderPage'));
const AccountAddressesPage = lazy(() => import('@/pages/account/AccountAddressesPage'));
const AccountPaymentMethodsPage = lazy(() => import('@/pages/account/AccountPaymentMethodsPage'));
const AccountCompanyPage = lazy(() => import('@/pages/account/AccountCompanyPage'));

// The ERP panel is a separate application with its own shell - it mounts
// outside RootLayout so it never carries the shop header, mega menu or footer.
const AdminShell = lazy(() => import('@/components/admin/shell/AdminShell'));
const AdminOverviewPage = lazy(() => import('@/pages/admin/AdminOverviewPage'));
const AdminApprovalsPage = lazy(() => import('@/pages/admin/AdminApprovalsPage'));
const AdminOrdersPage = lazy(() => import('@/pages/admin/AdminOrdersPage'));
const AdminProductsPage = lazy(() => import('@/pages/admin/AdminProductsPage'));
const AdminCustomersPage = lazy(() => import('@/pages/admin/AdminCustomersPage'));
const AdminOffersPage = lazy(() => import('@/pages/admin/AdminOffersPage'));
const AdminOfferFormPage = lazy(() => import('@/pages/admin/AdminOfferFormPage'));
const AdminBlogPage = lazy(() => import('@/pages/admin/AdminBlogPage'));
const AdminProductArticlesPage = lazy(() => import('@/pages/admin/AdminProductArticlesPage'));
const AdminReviewsPage = lazy(() => import('@/pages/admin/AdminReviewsPage'));
const AdminProductArticleEditPage = lazy(
  () => import('@/pages/admin/AdminProductArticleEditPage'),
);
const AdminFaqPage = lazy(() => import('@/pages/admin/AdminFaqPage'));
const AdminInvoicesPage = lazy(() => import('@/pages/admin/AdminInvoicesPage'));
const AdminClientProfilePage = lazy(() => import('@/pages/admin/AdminClientProfilePage'));
const AdminCustomerEditPage = lazy(() => import('@/pages/admin/AdminCustomerEditPage'));
const AdminSupplierReturnsPage = lazy(() => import('@/pages/admin/AdminSupplierReturnsPage'));
const AdminSupplierServicesPage = lazy(() => import('@/pages/admin/AdminSupplierServicesPage'));
const AdminSuppliersPage = lazy(() => import('@/pages/admin/AdminSuppliersPage'));
const AdminSupplierProfilePage = lazy(() => import('@/pages/admin/AdminSupplierProfilePage'));
const AdminPurchaseOrdersPage = lazy(() => import('@/pages/admin/AdminPurchaseOrdersPage'));
const AdminPurchaseOrderDetailPage = lazy(
  () => import('@/pages/admin/AdminPurchaseOrderDetailPage'),
);
const AdminPurchaseOrderCreatePage = lazy(
  () => import('@/pages/admin/AdminPurchaseOrderCreatePage'),
);
const AdminExpensesPage = lazy(() => import('@/pages/admin/AdminExpensesPage'));
const AdminExpenseCategoriesPage = lazy(
  () => import('@/pages/admin/AdminExpenseCategoriesPage'),
);
const AdminInventoryDetailPage = lazy(() => import('@/pages/admin/AdminInventoryDetailPage'));
const AdminReportsPage = lazy(() => import('@/pages/admin/AdminReportsPage'));
const AdminBusinessReportPage = lazy(() => import('@/pages/admin/AdminBusinessReportPage'));
const AdminQuotesPage = lazy(() => import('@/pages/admin/AdminQuotesPage'));
const AdminWebQuotesPage = lazy(() => import('@/pages/admin/AdminWebQuotesPage'));
const AdminQuoteDetailPage = lazy(() => import('@/pages/admin/AdminQuoteDetailPage'));
const AdminServicesPage = lazy(() => import('@/pages/admin/AdminServicesPage'));
const AdminServiceImportPage = lazy(() => import('@/pages/admin/AdminServiceImportPage'));
const AdminDevicesPage = lazy(() => import('@/pages/admin/AdminDevicesPage'));
const AdminServiceQuoteFormPage = lazy(() => import('@/pages/admin/AdminServiceQuoteFormPage'));
const AdminTicketsPage = lazy(() => import('@/pages/admin/AdminTicketsPage'));
const AdminTicketFormPage = lazy(() => import('@/pages/admin/AdminTicketFormPage'));
const AdminTicketDetailPage = lazy(() => import('@/pages/admin/AdminTicketDetailPage'));
const AdminRmaPage = lazy(() => import('@/pages/admin/AdminRmaPage'));
const AdminRmaDetailPage = lazy(() => import('@/pages/admin/AdminRmaDetailPage'));
const AdminBusinessesPage = lazy(() => import('@/pages/admin/AdminBusinessesPage'));
const AdminBusinessFormPage = lazy(() => import('@/pages/admin/AdminBusinessFormPage'));
const AdminBusinessDetailPage = lazy(() => import('@/pages/admin/AdminBusinessDetailPage'));
const AdminUsersPage = lazy(() => import('@/pages/admin/AdminUsersPage'));
const AdminRolesPage = lazy(() => import('@/pages/admin/AdminRolesPage'));
const AdminSmsPage = lazy(() => import('@/pages/admin/AdminSmsPage'));
const AdminWhatsappPage = lazy(() => import('@/pages/admin/AdminWhatsappPage'));
const AdminCallsPage = lazy(() => import('@/pages/admin/AdminCallsPage'));
const AdminEmailPage = lazy(() => import('@/pages/admin/AdminEmailPage'));
const AdminReferralsPage = lazy(() => import('@/pages/admin/AdminReferralsPage'));
const AdminSettingsPage = lazy(() => import('@/pages/admin/AdminSettingsPage'));
const AdminBusinessInfoPage = lazy(() => import('@/pages/admin/AdminBusinessInfoPage'));
const AdminSaleSettingsPage = lazy(() => import('@/pages/admin/AdminSaleSettingsPage'));
const AdminShippingSettingsPage = lazy(() => import('@/pages/admin/AdminShippingSettingsPage'));
const AdminPaymentMethodsPage = lazy(() => import('@/pages/admin/AdminPaymentMethodsPage'));
const AdminInventorySettingsPage = lazy(() => import('@/pages/admin/AdminInventorySettingsPage'));
const AdminKioskSettingsPage = lazy(() => import('@/pages/admin/AdminKioskSettingsPage'));
const AdminAgreementsPage = lazy(() => import('@/pages/admin/AdminAgreementsPage'));
const AdminActivityLogPage = lazy(() => import('@/pages/admin/AdminActivityLogPage'));
const AdminSupportPage = lazy(() => import('@/pages/admin/AdminSupportPage'));
const AdminSecurityLogPage = lazy(() => import('@/pages/admin/AdminSecurityLogPage'));
const AdminApiKeysPage = lazy(() => import('@/pages/admin/AdminApiKeysPage'));
const AdminThirdPartyPage = lazy(() => import('@/pages/admin/AdminThirdPartyPage'));
const AdminTaxonomyPage = lazy(() => import('@/pages/admin/AdminTaxonomyPage'));
const AdminTaxonomyAddPage = lazy(() => import('@/pages/admin/AdminTaxonomyAddPage'));
const AdminTaxonomyImportPage = lazy(() => import('@/pages/admin/AdminTaxonomyImportPage'));
const AdminInvoiceLabelsPage = lazy(() => import('@/pages/admin/AdminInvoiceLabelsPage'));
const AdminEmailSettingsPage = lazy(() => import('@/pages/admin/AdminEmailSettingsPage'));
const AdminTemplatesPage = lazy(() => import('@/pages/admin/AdminTemplatesPage'));
const AdminCalendarPage = lazy(() => import('@/pages/admin/AdminCalendarPage'));
const AdminAppointmentsPage = lazy(() => import('@/pages/admin/AdminAppointmentsPage'));
const AdminProfilePage = lazy(() => import('@/pages/admin/AdminProfilePage'));
const AdminOrderDetailPage = lazy(() => import('@/pages/admin/AdminOrderDetailPage'));
const AdminInvoiceDetailPage = lazy(() => import('@/pages/admin/AdminInvoiceDetailPage'));
const AdminServiceInvoiceFormPage = lazy(() => import('@/pages/admin/AdminServiceInvoiceFormPage'));

/**
 * There is no stub list any more.
 *
 * From phase 1 to phase 12 this held the routes whose screens had not been
 * built, so the nav could be walked end to end ahead of the work. Every one of
 * them is now a real screen - `AdminStubPage` is kept for the next time a route
 * lands ahead of its page, and is deliberately not deleted.
 */

/**
 * The admin panel's route tree, held as a value so both route sets below can
 * mount it: the full set (every host, before the split) and the panel host's
 * own. One tree, so a screen added here cannot exist on one host and be missing
 * on the other.
 *
 * Outside RootLayout by design (§4) - it owns the whole viewport. AdminShell is
 * also the UI half of the guard; requireAdmin enforces it server-side.
 */
const adminRoutes = (
  <Route
    path="admin"
    element={
      <Suspense fallback={<RouteFallback />}>
        <AdminShell />
      </Suspense>
    }
  >
    <Route index element={<AdminOverviewPage />} />
    <Route path="clients" element={<AdminCustomersPage />} />
    <Route path="clients/:id" element={<AdminClientProfilePage />} />
    <Route path="clients/:id/edit" element={<AdminCustomerEditPage />} />
    <Route path="orders" element={<AdminOrdersPage />} />
    <Route path="inventory" element={<AdminProductsPage />} />
    <Route path="inventory/:id" element={<AdminInventoryDetailPage />} />
    <Route path="invoices" element={<AdminInvoicesPage />} />

    {/* Purchase (phase 5). */}
    <Route path="suppliers" element={<AdminSuppliersPage />} />
    <Route path="suppliers/:id" element={<AdminSupplierProfilePage />} />
    <Route path="supplier-returns" element={<AdminSupplierReturnsPage />} />
    <Route path="supplier-services" element={<AdminSupplierServicesPage mode="service" />} />
    <Route path="supplier-subscriptions" element={<AdminSupplierServicesPage mode="subscription" />} />
    {/* Supplier bidding lives on the purchase order itself (§6.8a) - the
        separate `/admin/rfqs` screens folded in on 2026-09-11, and
        `ADMIN_LEGACY_REDIRECTS` forwards the old path. */}
    <Route path="purchase-orders" element={<AdminPurchaseOrdersPage />} />
    {/* Before `:id`, or the dynamic route matches "create" as an order id
        and the page renders "purchase order not found". */}
    <Route path="purchase-orders/create" element={<AdminPurchaseOrderCreatePage />} />
    <Route path="purchase-orders/:id" element={<AdminPurchaseOrderDetailPage />} />
    <Route path="expenses" element={<AdminExpensesPage />} />
    {/* Categories live under Settings - the expense screen links there, and
        the old `/admin/expenses/categories` path still redirects to it. */}
    <Route path="settings/expense-categories" element={<AdminExpenseCategoriesPage />} />

    {/* Reports (phase 6). `business` is registered ahead of the tabbed
        screen so the literal path cannot be swallowed. */}
    {/* Quotes & RMA (phase 7). */}
    <Route path="quotes" element={<AdminQuotesPage />} />
    {/* Enquiries from the storefront contact form, before anybody prices them. */}
    <Route path="web-quotes" element={<AdminWebQuotesPage />} />
    {/* The estimate builder. Declared BEFORE "quotes/:id" so "create"
        is matched as a literal rather than swallowed as an id. */}
    <Route path="quotes/create" element={<AdminServiceQuoteFormPage />} />
    <Route path="quotes/:id/edit" element={<AdminServiceQuoteFormPage />} />
    <Route path="quotes/:id" element={<AdminQuoteDetailPage />} />
    {/* The labour price list the quote and ticket pickers read. */}
    {/* Before the bare list route is irrelevant here (no `:id`), but kept
        adjacent so the pair reads as one screen and its importer. */}
    <Route path="services" element={<AdminServicesPage />} />
    <Route path="services/import" element={<AdminServiceImportPage />} />
    <Route path="rma" element={<AdminRmaPage />} />
    <Route path="rma/:id" element={<AdminRmaDetailPage />} />

    {/* Repair tickets. The detail screen DOES exist - see `tickets/:id`
        below. The note that used to sit here said it did not, and two links
        on the customer profile were still routing to `?q=<number>` to work
        around that, which dropped the staff member on a filtered list instead
        of the ticket they clicked. */}
    <Route path="tickets" element={<AdminTicketsPage />} />
    {/* Intake is a full screen, not a modal - see the page for why. */}
    <Route path="tickets/new" element={<AdminTicketFormPage />} />
    <Route path="tickets/:id/edit" element={<AdminTicketFormPage />} />
    <Route path="tickets/:id" element={<AdminTicketDetailPage />} />

    <Route path="reports/business" element={<AdminBusinessReportPage />} />
    <Route path="reports" element={<AdminReportsPage />} />
    <Route path="marketing/offers" element={<AdminOffersPage />} />
    {/* `new` before `:id`, or the parameter swallows the literal and the
        create screen opens as an edit for an offer called "new". */}
    <Route path="marketing/offers/new" element={<AdminOfferFormPage />} />
    <Route path="marketing/offers/:id" element={<AdminOfferFormPage />} />
    <Route path="marketing/blog" element={<AdminBlogPage />} />
    <Route path="marketing/faq" element={<AdminFaqPage />} />
    <Route path="marketing/articles" element={<AdminProductArticlesPage />} />
    <Route path="marketing/articles/:productId" element={<AdminProductArticleEditPage />} />
    <Route path="marketing/reviews" element={<AdminReviewsPage />} />

    {/* Marketing channels (phase 9). SMS, WhatsApp and Calls share one
        component - same MessageLog, different channel. Only email sends
        today; the other two log and say so (§6b U3–U5). */}
    <Route path="marketing/sms" element={<AdminSmsPage />} />
    <Route path="marketing/whatsapp" element={<AdminWhatsappPage />} />
    <Route path="marketing/calls" element={<AdminCallsPage />} />
    <Route path="marketing/email" element={<AdminEmailPage />} />
    {/* Referral commission (phase 10). Admin-only server-side - this pays
        real money on an automatic trigger (§6.13). */}
    <Route path="marketing/referrals" element={<AdminReferralsPage />} />

    {/* Business, staff & roles (phase 8). `add` and `:id/edit` share one
        form component - the same fields with a different verb. */}
    <Route path="businesses" element={<AdminBusinessesPage />} />
    <Route path="businesses/add" element={<AdminBusinessFormPage />} />
    <Route path="businesses/:id/edit" element={<AdminBusinessFormPage />} />
    <Route path="businesses/:id" element={<AdminBusinessDetailPage />} />
    <Route path="settings/users" element={<AdminUsersPage />} />
    <Route path="settings/roles" element={<AdminRolesPage />} />

    {/* Settings - the summary and every category landing are one screen,
        separated by `?cat=`, so they share a route (§6.15). */}
    <Route path="settings" element={<AdminSettingsPage />} />
    <Route path="settings/business-info" element={<AdminBusinessInfoPage />} />
    <Route path="settings/sale" element={<AdminSaleSettingsPage />} />
    <Route path="settings/shipping" element={<AdminShippingSettingsPage />} />
    <Route path="settings/payment-methods" element={<AdminPaymentMethodsPage />} />
    <Route path="settings/inventory" element={<AdminInventorySettingsPage />} />
    <Route path="settings/agreements" element={<AdminAgreementsPage />} />
    <Route path="settings/activity-log" element={<AdminActivityLogPage />} />
    {/* The tenant's line to the platform. No feature gate: reaching us is
        not a capability a tenant buys (SAAS_PLATFORM §4.5). */}
    <Route path="support" element={<AdminSupportPage />} />
    <Route path="settings/security-log" element={<AdminSecurityLogPage />} />
    <Route path="settings/api-keys" element={<AdminApiKeysPage />} />
    <Route path="settings/third-party" element={<AdminThirdPartyPage />} />
    {/* Reference data a staff member sets up once, so it sits beside the parts
        taxonomy in Settings rather than in the daily Sales list. */}
    <Route path="settings/devices" element={<AdminDevicesPage />} />
    <Route path="settings/kiosk" element={<AdminKioskSettingsPage />} />
    <Route path="settings/taxonomy" element={<AdminTaxonomyPage />} />
    <Route path="settings/taxonomy/add" element={<AdminTaxonomyAddPage />} />
    <Route path="settings/taxonomy/import" element={<AdminTaxonomyImportPage />} />
    <Route path="settings/invoice-labels" element={<AdminInvoiceLabelsPage />} />
    <Route path="settings/email" element={<AdminEmailSettingsPage />} />
    <Route path="settings/templates" element={<AdminTemplatesPage />} />
    <Route path="settings/calendar" element={<AdminCalendarPage />} />
    <Route path="settings/appointments" element={<AdminAppointmentsPage />} />
    <Route path="profile" element={<AdminProfilePage />} />
    <Route path="orders/:orderNumber" element={<AdminOrderDetailPage />} />
    {/* Declared before ":number" so "create" is matched as a literal
        rather than read as an invoice number. */}
    <Route path="invoices/create" element={<AdminServiceInvoiceFormPage />} />
    {/* The same form as "create", with the record loaded - see the note on
        the component. A distinct path rather than a flag, so the edit
        screen is linkable and Back behaves. */}
    <Route path="invoices/:number/edit" element={<AdminServiceInvoiceFormPage />} />
    <Route path="invoices/:number" element={<AdminInvoiceDetailPage />} />

    {/* Approvals is the Clients screen filtered, and keeps its own screen
        until phase 2 folds it in as a status filter. */}
    <Route path="approvals" element={<AdminApprovalsPage />} />


    {/* Old flat-admin URLs stay alive as redirects rather than 404s (§4). */}
    <Route path="products" element={<Navigate to="/admin/inventory" replace />} />
    <Route path="customers" element={<Navigate to="/admin/clients" replace />} />
    <Route path="offers" element={<Navigate to="/admin/marketing/offers" replace />} />
    <Route path="blog" element={<Navigate to="/admin/marketing/blog" replace />} />
    <Route path="faqs" element={<Navigate to="/admin/marketing/faq" replace />} />
    <Route
      path="expenses/categories"
      element={<Navigate to="/admin/settings/expense-categories" replace />}
    />
    {/* Invoice messages became a tab on Invoice statuses (2026-09-21). */}
    <Route
      path="settings/invoice-status"
      element={<Navigate to="/admin/settings/invoice-labels" replace />}
    />

    <Route path="*" element={<Navigate to="/admin" replace />} />
  </Route>
);

/**
 * The supplier portal's route tree (§6.8a), shared by both route sets like
 * `adminRoutes`. On the admin host it is `app.<platform>/supplier`: one
 * supplier account signs in there and works with every business it supplies.
 *
 * Outside RootLayout for the same reason the admin panel is: a supplier is not
 * a customer, and the shop header, mega menu, cart and price gate all belong to
 * a buyer's session. Its layout handles the signed-out case by rendering
 * sign-in in place, so an emailed request link survives the login.
 */
const supplierRoutes = (
  <Route
    path="supplier"
    element={
      <Suspense fallback={<RouteFallback />}>
        <SupplierPortalLayout />
      </Suspense>
    }
  >
    <Route index element={<SupplierDashboardPage />} />
    {/* `orders` before `orders/:id`, or the dynamic route matches the list
        path as an id and the page renders "order not found". */}
    <Route path="orders" element={<SupplierOrdersPage />} />
    <Route path="orders/:id" element={<SupplierPurchaseOrderPage />} />
    <Route path="proformas" element={<SupplierProformasPage />} />
    <Route path="deliveries" element={<SupplierDeliveriesPage />} />
    <Route path="agreement" element={<SupplierAgreementPage />} />
    <Route path="profile" element={<SupplierProfilePage />} />
    <Route path="businesses" element={<SupplierBusinessesPage />} />
    <Route path="*" element={<Navigate to="/supplier" replace />} />
  </Route>
);

/**
 * Where a supplier's reset email lands. A sibling of the portal rather than a
 * child, because the portal's layout answers a signed-out visitor with sign-in.
 */
const supplierResetRoute = (
  <Route
    path="supplier/reset"
    element={
      <Suspense fallback={<RouteFallback />}>
        <SupplierResetPage />
      </Suspense>
    }
  />
);

/**
 * The super admin panel's route tree (SAAS_PLATFORM §4.5), shared the same way
 * as `adminRoutes`.
 *
 * A third application on a third session - outside RootLayout and outside
 * AdminShell, because a super admin belongs to neither population and must not
 * carry either one's chrome. In production it is `/superadmin` on the admin
 * host (`PANEL_HOST`); the path form is also what keeps it reachable in
 * development without a DNS entry.
 */
const superAdminRoutes = (
  <Route
    path="superadmin"
    element={
      <Suspense fallback={<RouteFallback />}>
        <SuperAdminLayout />
      </Suspense>
    }
  >
    <Route index element={<SuperAdminTenantsPage />} />
    <Route path="plans" element={<SuperAdminPlansPage />} />
    <Route path="support" element={<SuperAdminSupportPage />} />
    <Route path="*" element={<Navigate to="/superadmin" replace />} />
  </Route>
);

/**
 * Every route, on every host that is not the admin host.
 *
 * Before the split (`PANEL_HOST` unset) and in development this is the whole
 * application, exactly as it always was. On a storefront host the panel and the
 * super admin forward to the admin host instead - see the two conditionals below.
 */
function SiteRoutes() {
  return (
    <Routes>
      {/* The ERP panel - see `adminRoutes`. On a storefront host it lives on
          the admin host instead, so the path forwards there. */}
      {surface === 'storefront' && panelHost ? (
        <Route path="admin/*" element={<GoToPanel />} />
      ) : (
        adminRoutes
      )}

      {/* Outside RootLayout on purpose (§6.13): a person following the
          unsubscribe link from an email is opting out, and meeting them with
          the shop header, mega menu and footer would be reading the moment
          badly. Public - CASL requires the mechanism to work without a
          sign-in. */}
      <Route
        path="unsubscribe"
        element={
          <Suspense fallback={<RouteFallback />}>
            <UnsubscribePage />
          </Suspense>
        }
      />

      {/* The customer portal (§6.13a).
          Outside RootLayout for the same reason unsubscribe is: the shop
          header, mega menu and footer belong to a storefront this customer's
          business may not have at all, and a repair customer checking whether
          their phone is ready should not arrive inside a parts catalogue.
          Public - the HMAC in the link is the credential, and the page only
          reads. */}
      <Route
        path="portal/:business/:token"
        element={
          <Suspense fallback={<RouteFallback />}>
            <CustomerPortalPage />
          </Suspense>
        }
      />

      {/* The self-service check-in tablet (Sales § Kiosk).

          Outside RootLayout, like the portal and for a stronger reason: it owns
          the whole viewport and runs under Guided Access on a device a customer
          holds. The shop header, the mega menu and the footer are all doors out
          of a screen that is supposed to have none.

          Public at the route level - the PIN gate lives inside the page, and
          the lock screen has to be able to draw itself before anybody is let
          in. */}
      <Route
        path="kiosk"
        element={
          <Suspense fallback={<RouteFallback />}>
            <KioskPage />
          </Suspense>
        }
      />

      {/* The super admin panel - see `superAdminRoutes`. Once it has a host of
          its own, the path forwards there from every other named host. */}
      {surface === 'storefront' && superAdminHost ? (
        <Route path="superadmin/*" element={<GoToHost to="superadmin" />} />
      ) : (
        superAdminRoutes
      )}

      {/* The supplier portal - see `supplierRoutes`. It belongs to the admin
          host once there is one, so the path forwards there. */}
      {surface === 'storefront' && panelHost ? (
        <Route path="supplier/*" element={<GoToPanel />} />
      ) : (
        supplierRoutes
      )}
      {surface === 'storefront' && panelHost ? null : supplierResetRoute}

      <Route element={<RootLayout />}>
        {/* '/' is the homepage, EXCEPT when it carries catalogue parameters -
            every filtered link ever shared points at '/?deviceType=...', and
            those forward to /shop with the query intact. See HomeOrShop. */}
        <Route index element={<HomeOrShop />} />
        <Route path="shop" element={<ShopPage />} />

        <Route
          path="clearance"
          element={
            <Suspense fallback={<RouteFallback />}>
              <ClearancePage />
            </Suspense>
          }
        />

        <Route
          path="deals/:slug"
          element={
            <Suspense fallback={<RouteFallback />}>
              <DealPage />
            </Suspense>
          }
        />

        <Route
          path="product/:slug"
          element={
            <Suspense fallback={<RouteFallback />}>
              <ProductDetailPage />
            </Suspense>
          }
        />

        <Route
          path="cart"
          element={
            <Suspense fallback={<RouteFallback />}>
              <CartPage />
            </Suspense>
          }
        />
        <Route
          path="checkout"
          element={
            <Suspense fallback={<RouteFallback />}>
              <CheckoutPage />
            </Suspense>
          }
        />
        <Route
          path="thank-you/:orderNumber"
          element={
            <Suspense fallback={<RouteFallback />}>
              <ThankYouPage />
            </Suspense>
          }
        />

        {/* Reached from checkout when the charge is refused. Nothing has been
            written at that point, so the cart is still intact. */}
        <Route
          path="payment-failed"
          element={
            <Suspense fallback={<RouteFallback />}>
              <PaymentFailedPage />
            </Suspense>
          }
        />

        {/* AccountLayout is also the auth gate for everything beneath it. */}
        <Route
          path="account"
          element={
            <Suspense fallback={<RouteFallback />}>
              <AccountLayout />
            </Suspense>
          }
        >
          <Route index element={<AccountOverviewPage />} />
          <Route path="orders" element={<AccountOrdersPage />} />
          <Route path="orders/:orderNumber" element={<AccountOrderDetailPage />} />
          <Route path="invoices" element={<AccountInvoicesPage />} />
          <Route path="credit" element={<AccountCreditPage />} />
          <Route path="activity" element={<AccountActivityPage />} />
          <Route path="referrals" element={<AccountReferralsPage />} />
          <Route path="quick-order" element={<AccountQuickOrderPage />} />
          <Route path="addresses" element={<AccountAddressesPage />} />
          <Route path="payment-methods" element={<AccountPaymentMethodsPage />} />
          <Route path="company" element={<AccountCompanyPage />} />
        </Route>

        {/* Where an emailed reset link lands. Public: the whole point is that
            nobody is signed in yet. */}
        <Route
          path="reset-password"
          element={
            <Suspense fallback={<RouteFallback />}>
              <ResetPasswordPage />
            </Suspense>
          }
        />

        <Route
          path="about"
          element={
            <Suspense fallback={<RouteFallback />}>
              <AboutPage />
            </Suspense>
          }
        />
        <Route
          path="contact"
          element={
            <Suspense fallback={<RouteFallback />}>
              <ContactPage />
            </Suspense>
          }
        />

        <Route
          path="offers"
          element={
            <Suspense fallback={<RouteFallback />}>
              <OffersPage />
            </Suspense>
          }
        />
        <Route
          path="blog"
          element={
            <Suspense fallback={<RouteFallback />}>
              <BlogPage />
            </Suspense>
          }
        />
        <Route
          path="blog/:slug"
          element={
            <Suspense fallback={<RouteFallback />}>
              <BlogPostPage />
            </Suspense>
          }
        />
        <Route
          path="faq"
          element={
            <Suspense fallback={<RouteFallback />}>
              <FaqPage />
            </Suspense>
          }
        />

        <Route
          path="*"
          element={
            <Suspense fallback={<RouteFallback />}>
              <NotFoundPage />
            </Suspense>
          }
        />
      </Route>
    </Routes>
  );
}

/**
 * The admin host (`PANEL_HOST`): the panel and the door in. The super admin is here
 * only until it has a host of its own (`SUPERADMIN_HOST`).
 *
 * Nothing of a storefront is here. The shop, the account area, the supplier
 * portal and the kiosk all belong to a business, and this host belongs to none -
 * a path meant for one of them is sent to the sign-in page rather than served
 * against whichever business happened to be the default.
 */
function PanelRoutes() {
  return (
    <Routes>
      {adminRoutes}
      {supplierRoutes}
      {supplierResetRoute}
      {/* The super admin lives on its own host once it has one - never here, on
          the host every tenant's staff sign in on. And never on a business's
          own panel domain at all: that host belongs to the business. */}
      {superAdminHost ? (
        <Route path="superadmin/*" element={<GoToHost to="superadmin" />} />
      ) : panelBusiness ? null : (
        superAdminRoutes
      )}

      {/* The link in a staff password-reset email lands here. */}
      <Route
        path="reset-password"
        element={
          <Suspense fallback={<RouteFallback />}>
            <ResetPasswordPage />
          </Suspense>
        }
      />

      <Route
        index
        element={
          <Suspense fallback={<RouteFallback />}>
            <PanelSignInPage />
          </Suspense>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

/**
 * The super admin host (`SUPERADMIN_HOST`): the super admin panel and nothing else.
 *
 * Kelinto's own operations live apart from every tenant's - no panel, no
 * storefront, no sign-in for anybody but an operator - so anything else asked
 * of this host lands on the super admin, which signs its own people in.
 */
function SuperAdminRoutes() {
  return (
    <Routes>
      {superAdminRoutes}
      <Route path="*" element={<Navigate to="/superadmin" replace />} />
    </Routes>
  );
}

/**
 * The bare platform domain: Kelinto's front page.
 *
 * The panel and the supplier portal live on the admin host and the super admin on
 * its own, so their paths forward there rather than 404ing - an old bookmark to
 * `kelinto.com/admin` still reaches the panel. Anything else is the front page.
 */
function PlatformRoutes() {
  return (
    <Routes>
      <Route
        index
        element={
          <Suspense fallback={<RouteFallback />}>
            <PlatformLandingPage />
          </Suspense>
        }
      />
      {panelHost && <Route path="admin/*" element={<GoToPanel />} />}
      {panelHost && <Route path="supplier/*" element={<GoToPanel />} />}
      {superAdminHost && <Route path="superadmin/*" element={<GoToHost to="superadmin" />} />}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App() {
  /**
   * The panel's accent, from the moment the app starts.
   *
   * `RouteProgress` below is mounted outside `<Routes>`, so on a reload it
   * draws before `AdminShell` exists to declare which business is on screen.
   * Without this it fell back to the Cellvix ramp baked into the gradient
   * utility, and a CellShoppe admin saw a red bar on every page load. See
   * `hooks/useEarlyBusinessTheme.js`.
   */
  useEarlyBusinessTheme();

  return (
    <>
      {/* Mounted once, outside the routes: a toast outlives the screen that
          raised it - an email sent from an invoice should still confirm after
          the staff member has navigated on. */}
      <Toaster />

      {/* Same reasoning, and the same place: one bar for the whole app rather
          than one per shell. It reports every in-flight request, so a route
          change, a filter and a background refetch all say so the same way. */}
      <RouteProgress />

      {/* Which set is decided by the host, once (`lib/surface.js`). */}
      {surface === 'platform' ? (
        <PlatformRoutes />
      ) : surface === 'superadmin' ? (
        <SuperAdminRoutes />
      ) : surface === 'panel' ? (
        <PanelRoutes />
      ) : (
        <SiteRoutes />
      )}
    </>
  );
}

export default App;
