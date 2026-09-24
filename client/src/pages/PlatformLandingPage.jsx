import {
  ArrowRight,
  ClipboardList,
  Layers,
  PackageSearch,
  ShoppingBag,
  Store,
  Truck,
  UserRound,
} from 'lucide-react';
import { panelUrl } from '@/lib/surface';
import useDocumentTitle from '@/hooks/useDocumentTitle';

/**
 * kelinto.com - the platform's own front door.
 *
 * **Who arrives here, and what for.** Almost nobody lands on a platform's apex
 * to be sold to: it is an owner who typed the name to sign in, a supplier
 * following an invoice footer, a customer who dropped a business's subdomain.
 * So the page leads with the two doors (the business panel and the supplier
 * portal) and says in one line where customers go instead, and only then
 * describes the product - which it does from what is built, in the three verbs
 * a business actually does with it: sell, service, buy.
 *
 * **Nothing invented.** No customer logos, no counts, no quotes. The platform
 * has none to show yet, and a landing page is the first place a reader decides
 * whether the rest of what a company says is true.
 *
 * Dressed in the console's palette, the only identity the platform has; see
 * the note in PROGRESS.md about the type scale topping out at 28px.
 */
const PILLARS = [
  {
    icon: ShoppingBag,
    title: 'Sell',
    lines: [
      'A storefront on your own address, with your catalogue and your prices',
      'Wholesale pricing that stays locked until you approve a buyer',
      'Orders, returns, clearance and offers, invoiced from the same place',
    ],
  },
  {
    icon: ClipboardList,
    title: 'Service',
    lines: [
      'Repair tickets from quote to pickup, with every status sent to the customer',
      'A check-in tablet customers fill in themselves at the counter',
      'Deposits, tips and payments carried straight onto the invoice',
    ],
  },
  {
    icon: PackageSearch,
    title: 'Buy',
    lines: [
      'Purchase orders your suppliers price and bid on in their own portal',
      'Proformas, supplier agreements and deliveries in one thread per order',
      'Stock received against the order, and reorder levels that notice',
    ],
  },
];

const DOORS = [
  {
    icon: Store,
    who: 'Owners and staff',
    where: 'The business panel',
    href: panelUrl('/'),
    action: 'Sign in',
  },
  {
    icon: Truck,
    who: 'Suppliers',
    where: 'One login for every business you supply',
    href: panelUrl('/supplier'),
    action: 'Supplier portal',
  },
];

export function PlatformLandingPage() {
  useDocumentTitle('Kelinto');

  return (
    <div className="min-h-dvh bg-plat-bg text-plat-text">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-5 sm:px-6">
        <span className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-lg bg-plat-accent">
            <Layers className="size-5 text-white" strokeWidth={2.25} aria-hidden="true" />
          </span>
          <span className="text-lg font-semibold">Kelinto</span>
        </span>
        <a
          href={panelUrl('/')}
          className="rounded-lg px-3 py-2 text-sm font-medium text-plat-muted active:scale-[0.97] hover:text-plat-text"
        >
          Sign in
        </a>
      </header>

      <main className="mx-auto max-w-5xl px-4 sm:px-6">
        <section className="pb-12 pt-10 sm:pb-16 sm:pt-20">
          <p className="text-sm font-medium text-plat-accent-soft">
            For repair shops, parts wholesalers and retailers
          </p>
          <h1 className="mt-3 max-w-2xl text-3xl font-semibold leading-tight tracking-tight text-plat-text">
            Run the counter, the workshop and the storefront from one place.
          </h1>
          <p className="mt-4 max-w-xl text-lg leading-relaxed text-plat-muted">
            Kelinto is the operations system behind a business that sells parts, fixes devices, or
            both. Customers buy from your storefront; your staff run everything else from one panel.
          </p>

          {/* The two doors, first. Most people on this page came to go through
              one of them, and should not have to scroll past a pitch to find it. */}
          <ul className="mt-8 grid gap-3 sm:grid-cols-2">
            {DOORS.map(({ icon: Icon, who, where, href, action }) => (
              <li key={who}>
                <a
                  href={href}
                  className="group flex items-center gap-4 rounded-xl border border-plat-line bg-plat-surface p-4 transition-colors duration-fast active:scale-[0.97] hover:border-plat-accent/50"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-plat-raised">
                    <Icon className="size-5 text-plat-accent-soft" strokeWidth={2} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-md font-semibold">{who}</span>
                    <span className="block text-sm text-plat-muted">{where}</span>
                  </span>
                  <span className="flex items-center gap-1 text-sm font-medium text-plat-accent-soft">
                    {action}
                    <ArrowRight className="size-4" strokeWidth={2} aria-hidden="true" />
                  </span>
                </a>
              </li>
            ))}
          </ul>

          <p className="mt-4 flex items-start gap-2 text-sm text-plat-dim">
            <UserRound className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
            {/* One text run, so the example address wraps with the sentence
                instead of standing apart as its own column. */}
            <span>
              Shopping with a business? Use its own address, like{' '}
              <span className="font-mono text-plat-muted">yourshop.kelinto.com</span>.
            </span>
          </p>
        </section>

        <section className="border-t border-plat-line-soft py-12 sm:py-16">
          <h2 className="text-2xl font-semibold tracking-tight text-plat-text">What it runs</h2>
          <p className="mt-2 max-w-xl text-md text-plat-muted">
            Every business gets the whole system. Whatever it does not need is switched off, so the
            panel shows only what that business actually does.
          </p>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {PILLARS.map(({ icon: Icon, title, lines }) => (
              <div key={title} className="rounded-xl border border-plat-line bg-plat-surface p-5">
                <Icon className="size-5 text-plat-accent-soft" strokeWidth={2} aria-hidden="true" />
                <h3 className="mt-3 text-lg font-semibold text-plat-text">{title}</h3>
                <ul className="mt-3 space-y-2.5">
                  {lines.map((line) => (
                    <li key={line} className="text-sm leading-relaxed text-plat-muted">
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="mx-auto max-w-5xl px-4 sm:px-6">
        {/* The rule on the inner box, so it spans the same width as the section
            rules above rather than running out into the gutter. */}
        <div className="border-t border-plat-line-soft py-6 text-xs text-plat-dim">Kelinto</div>
      </footer>
    </div>
  );
}

export default PlatformLandingPage;
