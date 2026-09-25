import {
  BarChart3,
  BatteryFull,
  Camera,
  PlugZap,
  Smartphone,
  Check,
  ClipboardList,
  FileText,
  Lock,
  Package,
  ShoppingBag,
  Truck,
  Users,
  Wrench,
} from 'lucide-react';

import cn from '@/lib/cn';

/**
 * Product illustrations for kelinto.com, drawn in markup rather than shipped as
 * screenshots.
 *
 * **Why markup.** A screenshot goes stale the week a screen changes and blurs
 * on every display it was not taken for; these are built from the same tokens
 * as the product, stay sharp at any density, and follow the product's palette
 * automatically. They are illustrations of real screens (a ticket, a purchase
 * order, the panel's home), so every label in them is a thing Kelinto does.
 *
 * The sample rows are illustrative, not claims: no figure here is presented as
 * a customer's result, and every mock is `aria-hidden` because the copy beside
 * it says what it shows.
 */

/** A window frame: the traffic lights and an address, so the eye reads "app". */
export function WindowFrame({ address, children, className }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'overflow-hidden rounded-xl border border-plat-text/10 bg-plat-surface shadow-flyout',
        className,
      )}
    >
      <div className="flex items-center gap-3 border-b border-plat-text/5 bg-plat-raised/60 px-4 py-2.5">
        <span className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-plat-text/15" />
          <span className="size-2.5 rounded-full bg-plat-text/15" />
          <span className="size-2.5 rounded-full bg-plat-text/15" />
        </span>
        {address && (
          <span className="mx-auto flex min-w-0 items-center gap-1.5 rounded-md bg-plat-bg/70 px-3 py-1 font-mono text-2xs text-plat-muted">
            <Lock className="size-3 shrink-0 text-plat-ok" strokeWidth={2.25} />
            <span className="truncate">{address}</span>
          </span>
        )}
        <span className="w-10" />
      </div>
      {children}
    </div>
  );
}

const NAV = [
  { icon: BarChart3, label: 'Overview', active: true },
  { icon: Users, label: 'Customers' },
  { icon: Wrench, label: 'Tickets' },
  { icon: ShoppingBag, label: 'Orders' },
  { icon: FileText, label: 'Invoices' },
  { icon: Truck, label: 'Purchase orders' },
  { icon: Package, label: 'Inventory' },
];

/** The ERP's home: the hero illustration. */
export function PanelMock() {
  const bars = [38, 52, 44, 61, 57, 72, 66, 80, 74, 88, 83, 95];
  return (
    <WindowFrame address="app.yourbusiness.com" className="w-full">
      <div className="grid grid-cols-[9.5rem_1fr] sm:grid-cols-[11rem_1fr]">
        <div className="hidden border-r border-plat-text/5 bg-plat-bg/40 p-3 min-[480px]:block">
          <div className="mb-4 flex items-center gap-2 px-1.5">
            <span className="size-4 rounded-sm bg-plat-bright" />
            <span className="text-xs font-semibold text-plat-text">Your business</span>
          </div>
          <ul className="space-y-0.5">
            {NAV.map((item) => (
              <li
                key={item.label}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2 py-1.5 text-2xs',
                  item.active ? 'bg-plat-mark text-plat-accent-soft' : 'text-plat-dim',
                )}
              >
                <item.icon className="size-3.5 shrink-0" strokeWidth={2} />
                <span className="truncate">{item.label}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="col-span-2 p-4 min-[480px]:col-span-1 sm:p-5">
          <div className="flex items-baseline justify-between">
            <span className="text-md font-semibold text-plat-text">Good morning</span>
            <span className="text-2xs text-plat-dim">Today</span>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {[
              ['Sales', '$8,420'],
              ['Open tickets', '14'],
              ['To reorder', '6'],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-plat-text/5 bg-plat-raised/50 p-2.5">
                <p className="text-2xs text-plat-dim">{label}</p>
                <p className="tnum mt-1 text-lg font-semibold text-plat-text">{value}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 rounded-lg border border-plat-text/5 bg-plat-raised/30 p-3">
            <p className="text-2xs text-plat-dim">Revenue, last 12 weeks</p>
            <div className="mt-3 flex h-20 items-end gap-1.5">
              {bars.map((height, index) => (
                <span
                  key={index}
                  className={cn('flex-1 rounded-sm', index === bars.length - 1 ? 'bg-plat-bright' : 'bg-plat-bright/20')}
                  style={{ height: `${height}%` }}
                />
              ))}
            </div>
          </div>
          <ul className="mt-3 divide-y divide-plat-text/5 rounded-lg border border-plat-text/5">
            {[
              ['Screen replacement', 'Ready for pickup', 'ok'],
              ['Order 10482', 'Shipped', 'accent'],
              ['Battery, Pixel 8', 'In repair', 'warn'],
            ].map(([title, state, tone]) => (
              <li key={title} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="truncate text-xs text-plat-muted">{title}</span>
                <span
                  className={cn(
                    'shrink-0 rounded-full px-2 py-0.5 text-2xs',
                    tone === 'ok' && 'bg-plat-ok/15 text-plat-ok',
                    tone === 'accent' && 'bg-plat-mark text-plat-accent-soft',
                    tone === 'warn' && 'bg-plat-warn/15 text-plat-warn',
                  )}
                >
                  {state}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </WindowFrame>
  );
}

/** A product on the website, the thing a customer actually sees. */
export function StorefrontMock() {
  return (
    <WindowFrame address="shop.yourbusiness.com">
      <div className="grid grid-cols-2 gap-3 p-4">
        {[
          ['Display assembly', '$129.00', true, Smartphone],
          ['Battery, OEM grade', '$42.00', true, BatteryFull],
          ['Charging port', '$18.50', false, PlugZap],
          ['Rear camera', '$64.00', true, Camera],
        ].map(([name, price, inStock, Icon]) => (
          <div key={name} className="rounded-lg border border-plat-text/5 bg-plat-raised/40 p-2.5">
            {/* A part's silhouette where its photo would be: an empty grey
                box reads as a page still loading, not as a product. */}
            <div className="flex aspect-4/3 items-center justify-center rounded-md bg-linear-to-br from-plat-text/10 to-plat-text/2">
              <Icon className="size-8 text-plat-muted" strokeWidth={1.25} />
            </div>
            <p className="mt-2 truncate text-xs font-medium text-plat-text">{name}</p>
            <div className="mt-1 flex items-center justify-between">
              <span className="tnum text-xs text-plat-text">{price}</span>
              <span className={cn('text-2xs', inStock ? 'text-plat-ok' : 'text-plat-dim')}>
                {inStock ? 'In stock' : 'Out of stock'}
              </span>
            </div>
          </div>
        ))}
      </div>
    </WindowFrame>
  );
}

/** A repair ticket moving through its stages. */
export function TicketMock() {
  const steps = ['Checked in', 'Diagnosed', 'In repair', 'Ready', 'Picked up'];
  const at = 2;
  return (
    <WindowFrame>
      <div className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-mono text-2xs text-plat-dim">TICKET 4182</p>
            <p className="mt-0.5 text-md font-semibold text-plat-text">iPhone 15 Pro, cracked screen</p>
          </div>
          <span className="rounded-full bg-plat-warn/15 px-2 py-0.5 text-2xs text-plat-warn">In repair</span>
        </div>
        <ol className="mt-4 flex items-center">
          {steps.map((step, index) => (
            <li key={step} className="flex flex-1 items-center last:flex-none">
              <span
                className={cn(
                  'flex size-5 shrink-0 items-center justify-center rounded-full text-2xs',
                  index < at && 'bg-plat-accent text-white',
                  index === at && 'bg-plat-mark text-plat-accent-soft ring-2 ring-plat-accent',
                  index > at && 'bg-plat-text/10 text-plat-dim',
                )}
              >
                {index < at ? <Check className="size-3" strokeWidth={3} /> : index + 1}
              </span>
              {index < steps.length - 1 && (
                <span className={cn('mx-1 h-0.5 flex-1 rounded-full', index < at ? 'bg-plat-accent' : 'bg-plat-text/10')} />
              )}
            </li>
          ))}
        </ol>
        <div className="mt-4 space-y-2">
          {[
            ['Screen assembly', '$189.00'],
            ['Labour', '$45.00'],
            ['Deposit taken', '-$50.00'],
          ].map(([label, amount]) => (
            <div key={label} className="flex justify-between text-xs">
              <span className="text-plat-muted">{label}</span>
              <span className="tnum text-plat-text">{amount}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-plat-raised/60 px-3 py-2">
          <span className="size-1.5 rounded-full bg-plat-ok" />
          <span className="text-2xs text-plat-muted">Customer texted: “Your device is being repaired.”</span>
        </div>
      </div>
    </WindowFrame>
  );
}

/** A purchase order with suppliers bidding on it. */
export function PurchaseOrderMock() {
  return (
    <WindowFrame>
      <div className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-mono text-2xs text-plat-dim">PO 2291</p>
            <p className="mt-0.5 text-md font-semibold text-plat-text">48 screens, 3 models</p>
          </div>
          <span className="rounded-full bg-plat-mark px-2 py-0.5 text-2xs text-plat-accent-soft">Bidding</span>
        </div>
        <ul className="mt-4 space-y-2">
          {[
            ['Supplier A', '$4,212.00', 'Best complete bid', true],
            ['Supplier B', '$4,380.00', 'Priced 46 of 48', false],
            ['Supplier C', '$4,455.00', 'Priced all', false],
          ].map(([name, total, note, best]) => (
            <li
              key={name}
              className={cn(
                'flex items-center justify-between gap-3 rounded-lg border px-3 py-2',
                best ? 'border-plat-accent bg-plat-mark' : 'border-plat-text/5 bg-plat-raised/40',
              )}
            >
              <span className="min-w-0">
                <span className="block text-xs font-medium text-plat-text">{name}</span>
                <span className="block text-2xs text-plat-dim">{note}</span>
              </span>
              <span className="tnum text-xs font-semibold text-plat-text">{total}</span>
            </li>
          ))}
        </ul>
      </div>
    </WindowFrame>
  );
}

/** The business on its own address. */
export function AddressMock() {
  return (
    <div aria-hidden="true" className="space-y-3">
      {[
        ['yourbusiness.com', 'Website', 'Your customers shop here'],
        ['app.yourbusiness.com', 'ERP', 'Your staff sign in here'],
      ].map(([host, label, note]) => (
        <div key={host} className="flex items-center gap-3 rounded-xl border border-plat-text/10 bg-plat-surface px-4 py-3.5">
          <Lock className="size-4 shrink-0 text-plat-ok" strokeWidth={2.25} />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-mono text-md text-plat-text">{host}</span>
            <span className="block text-xs text-plat-dim">{note}</span>
          </span>
          <span className="rounded-full bg-plat-text/5 px-2 py-0.5 text-2xs text-plat-muted">{label}</span>
        </div>
      ))}
    </div>
  );
}

/** Pillar icons, reused as small section marks. */
export const PILLAR_ICONS = { sell: ShoppingBag, service: ClipboardList, buy: Truck };
