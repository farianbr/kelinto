import { matchPath, useLocation } from 'react-router';
import { WEBSITE_PAGES } from '@shared/websitePages';
import { useGoogleReviews, usePageSections } from '@/hooks/useContent';
import { useCatalogCategories } from '@/hooks/useCatalog';
import ProductArticle from '@/components/product/ProductArticle';
import ProductFaq from '@/components/product/ProductFaq';
import GoogleReviewsSection from '@/components/website/GoogleReviewsSection';
import LocationSection from '@/components/website/LocationSection';
import ContactSection from '@/components/website/ContactSection';
import { openContactForm } from '@/components/website/ContactForm';

/**
 * The five sections every website page ends with (client ruling 2026-09-30):
 * Article, FAQ, Google reviews, Location and hours, Contact form, in that order.
 *
 * Rendered ONCE, by `RootLayout`, under whatever page the route drew - not by
 * each page. The page is found by matching the address against the registry
 * (`shared/websitePages.js`), which also says which sections that page can take;
 * the server then says which of those the owner left switched on. So a page
 * cannot forget its sections, and a new page gets them by one line in the
 * registry rather than five imports.
 *
 * A section with nothing in it draws nothing. Nothing here renders until the
 * page's answer arrives: these sit below the page's own content, where waiting
 * a moment costs no layout shift anybody is looking at.
 */

/**
 * A type's page under `/catalogue/<address>` (2026-10-03) takes the sections
 * written for it when it lived at its old address: Parts the Shop page's,
 * Phones the Pre-owned page's, Services the Services page's. The address is
 * the type's to change, so it is looked up, not matched.
 */
const SECTIONS_OF_TYPE = { parts: 'shop', phones: 'preowned', services: 'services' };

function useCurrentPage() {
  const { pathname } = useLocation();
  const catalogue = matchPath({ path: '/catalogue/:address', end: true }, pathname);
  const { data: categories = [] } = useCatalogCategories();
  if (catalogue) {
    const type = categories.find((entry) => entry.address === catalogue.params.address);
    const key = SECTIONS_OF_TYPE[type?.slug];
    return key ? (WEBSITE_PAGES.find((page) => page.key === key) ?? null) : null;
  }
  return WEBSITE_PAGES.find((page) => matchPath({ path: page.path, end: true }, pathname)) ?? null;
}

export function PageSections() {
  const page = useCurrentPage();
  const { data } = usePageSections(page?.key);
  const sections = data?.sections ?? [];
  const reviews = useGoogleReviews(sections.includes('reviews'));

  if (!page || !data) return null;

  const shows = (section) => sections.includes(section);
  const hasContact = shows('contact');

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-10 px-3 pb-10 pt-6 sm:px-4 lg:gap-14 lg:px-6 lg:pb-14 lg:pt-8">
      {shows('article') && data.article && (
        <ProductArticle article={data.article} eyebrow="In depth" headingId="page-article" />
      )}

      {shows('faq') && (
        <ProductFaq
          faqs={data.faqs}
          headingId="page-faq"
          eyebrow="FAQ"
          title="Common questions"
          askBody="Ask us directly and a person from our team replies."
          askLabel="Ask a question"
          // The form is further down this page when the page has one.
          onAsk={hasContact ? () => openContactForm({ topic: 'other' }) : null}
        />
      )}

      {shows('reviews') && <GoogleReviewsSection data={reviews.data} />}

      {shows('location') && <LocationSection />}

      {hasContact && <ContactSection />}
    </div>
  );
}

export default PageSections;
