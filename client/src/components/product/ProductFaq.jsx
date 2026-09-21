import { Link } from 'react-router';
import { ArrowUpRight, Headphones } from 'lucide-react';
import cn from '@/lib/cn';
import useBusinessInfo from '@/hooks/useBusinessInfo';
import Accordion from '@/components/ui/Accordion';
import { pressable } from '@/lib/motion';

/**
 * Per-product FAQ.
 *
 * The entries arrive with the product payload (`GET /api/products/:slug`) rather
 * than in a second request, so the section is present on first paint and cannot
 * shift the page under someone who has started reading. The server picks them:
 * an entry targeted at this part type outranks a catalogue-wide one, and the
 * placeholders are already filled with this product's names.
 *
 * The rows are the shared `Accordion` - the same numbered pills the help centre
 * uses, so a buyer who has read one page knows how the other behaves. The first
 * entry opens on mount: on a product page the question at the top is the one
 * almost everyone is here for, and an all-closed stack makes them click to find
 * that out.
 *
 * The last column is the escape hatch: nothing here answers it, so ask a person,
 * with the SKU already attached to the message.
 */
export function ProductFaq({ faqs = [], product = null, className }) {
  // Above the early return: a hook cannot be called conditionally.
  const info = useBusinessInfo();

  if (!faqs.length) return null;

  const askHref = product
    ? `/contact?topic=stock&sku=${encodeURIComponent(product.sku)}`
    : '/contact';

  return (
    <section aria-labelledby="product-faq" className={cn('min-w-0', className)}>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div>
          <p className="eyebrow mb-2 inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-ink-400">
            <span className="size-1 rounded-full bg-brand" aria-hidden="true" />
            Before you order
          </p>
          <h2 id="product-faq" className="text-2xl tracking-[-0.03em] sm:text-3xl">
            Questions about this part
          </h2>
        </div>

        <Link
          to="/faq"
          className={cn(pressable, 'inline-flex items-center gap-0.5 text-sm font-semibold text-brand hover:text-brand-700')}
        >
          The full FAQ
          <ArrowUpRight className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px] lg:gap-6">
        <Accordion className="min-w-0" items={faqs} defaultOpenId={faqs[0]?.id ?? null} />

        {/* ---- ask a person ------------------------------------------------ */}
        <aside className="lg:sticky lg:top-[calc(var(--chrome-h,158px)+16px)] lg:self-start">
          <div className="overflow-hidden rounded-xl border border-line bg-surface-2 p-5">
            <span className="mb-3 flex size-9 items-center justify-center rounded-md bg-surface text-brand shadow-card">
              <Headphones className="size-[18px]" strokeWidth={1.75} aria-hidden="true" />
            </span>

            <p className="font-display text-md font-bold text-ink-900">Not answered here?</p>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-500">
              Fitment, cross-references and lead times on unlisted parts go straight to the sales
              desk.
              {product && ' Your message starts with this SKU already in it.'}
            </p>

            <Link
              to={askHref}
              className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-full bg-brand-gradient font-display text-md font-semibold text-white transition-[filter] hover:brightness-110"
            >
              Ask about this part
            </Link>

            {/* No number on file, no button - an empty pill reading nothing is
                worse than the one action above it standing alone. */}
            {info.phone && (
              <a
                href={`tel:${info.phone.replace(/[^\d+]/g, '')}`}
                className={cn(pressable, 'mt-2 flex h-11 w-full items-center justify-center rounded-full border border-line-strong bg-surface font-display text-sm font-semibold text-ink-700 hover:border-ink-300')}
              >
                {info.phone}
              </a>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}

export default ProductFaq;
