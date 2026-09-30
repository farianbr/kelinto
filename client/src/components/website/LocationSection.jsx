import { useNavigate } from 'react-router';
import { MessageCircle, Phone, Mail, FileText } from 'lucide-react';
import cn from '@/lib/cn';
import { pressable } from '@/lib/motion';
import Button from '@/components/ui/Button';
import useBusinessInfo from '@/hooks/useBusinessInfo';
import { openContactForm } from '@/components/website/ContactForm';

/**
 * Name, address, phone and hours, beside the business's Google map, at the foot
 * of every website page (the client's reference: a NAP card left, map right).
 *
 * What it is opened for: "where are they, and are they open?" The business
 * name is the heading because it is what a person searches the map for; the
 * address sits straight under it; the hours are the one table on the card.
 * The two buttons are the two things a person does next, so they come before
 * the list of ways to write.
 *
 * Everything is from Settings › Business info. A field left empty drops its
 * line, and the whole section goes when there is nothing to say, so a business
 * that has not filled the form in yet does not show a card of blanks.
 */

function addressLines(address) {
  const locality = [address.city, [address.region, address.postal].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');
  return [address.line1, address.line2, locality, address.country].filter(Boolean);
}

export function LocationSection({ className }) {
  const info = useBusinessInfo();
  const navigate = useNavigate();

  const lines = addressLines(info.address ?? {});
  const hours = info.hours ?? [];
  const emails = [info.email, info.supportEmail].filter((value, index, all) => value && all.indexOf(value) === index);
  const whatsapp = info.whatsapp ? `https://wa.me/${info.whatsapp.replace(/[^\d]/g, '')}` : '';
  const map = info.mapEmbedUrl;

  if (!lines.length && !info.phone && !hours.length && !map) return null;

  // The page's own contact form when it has one, with the topic already set;
  // otherwise the contact page, which reads the same topic from the address.
  function getQuote() {
    if (!openContactForm({ topic: 'quote' })) navigate('/contact?topic=quote');
  }

  const hoursTable = hours.length > 0 && (
    <div>
      <h3 className="eyebrow mb-3 text-ink-400">Store hours</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-md">
        {hours.map((row) => (
          <div key={`${row.days}-${row.time}`} className="contents">
            <dt className="text-ink-500">{row.days}</dt>
            <dd className="tnum font-medium text-ink-900">{row.time}</dd>
          </div>
        ))}
      </dl>
    </div>
  );

  return (
    <section
      aria-labelledby="page-location"
      className={cn('grid gap-3', map && 'lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]', className)}
    >
      <div className="rounded-xl border border-line bg-surface p-6 sm:p-8">
        <div className={cn(!map && hours.length > 0 && 'md:grid md:grid-cols-[minmax(0,1fr)_auto] md:gap-12')}>
          <div className="min-w-0">
            {info.tagline && <p className="eyebrow mb-3 text-ink-400">{info.tagline}</p>}
            <h2 id="page-location" className="text-2xl tracking-[-0.03em] sm:text-3xl">
              {info.name}
            </h2>

            {lines.length > 0 && (
              <address className="mt-3 text-md not-italic leading-relaxed text-ink-500">
                {lines.map((line) => (
                  <span key={line} className="block">
                    {line}
                  </span>
                ))}
              </address>
            )}

            <div className="mt-6 flex flex-wrap gap-2">
              <Button icon={FileText} onClick={getQuote}>
                Get a quote
              </Button>
              {whatsapp && (
                // A link, not `Button`, because it leaves the site; styled as the
                // outline variant so the pair reads as one row of actions.
                <a
                  href={whatsapp}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    pressable,
                    'inline-flex h-11 items-center justify-center gap-2 rounded-md border border-line-strong bg-surface px-5 font-display text-md font-semibold text-ink-700 hover:border-ink-300 hover:bg-surface-2',
                  )}
                >
                  <MessageCircle className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
                  WhatsApp us
                </a>
              )}
            </div>

            {(info.phone || emails.length > 0) && (
              <ul className="mt-6 space-y-2">
                {info.phone && (
                  <li>
                    <a
                      href={`tel:${info.phone.replace(/[^\d+]/g, '')}`}
                      className={cn(pressable, 'inline-flex items-center gap-2.5 text-md font-semibold text-ink-900 hover:text-brand')}
                    >
                      <Phone className="size-4 text-ink-400" strokeWidth={1.75} aria-hidden="true" />
                      {info.phone}
                    </a>
                  </li>
                )}
                {emails.map((email) => (
                  <li key={email}>
                    <a
                      href={`mailto:${email}`}
                      className={cn(pressable, 'inline-flex min-w-0 items-center gap-2.5 text-md font-medium text-ink-700 hover:text-brand')}
                    >
                      <Mail className="size-4 shrink-0 text-ink-400" strokeWidth={1.75} aria-hidden="true" />
                      <span className="truncate">{email}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}

            {map && hoursTable && <div className="mt-6 border-t border-line pt-6">{hoursTable}</div>}
          </div>

          {/* Without a map the hours take the right-hand column the map would
              have had, rather than stacking under everything else. */}
          {!map && hoursTable && <div className="mt-6 border-t border-line pt-6 md:mt-0 md:border-t-0 md:pt-0">{hoursTable}</div>}
        </div>
      </div>

      {map && (
        <div className="min-h-80 overflow-hidden rounded-xl border border-line bg-surface-2">
          <iframe
            src={map}
            title={`Map showing ${info.name}`}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            allowFullScreen
            className="block h-full min-h-80 w-full border-0"
          />
        </div>
      )}
    </section>
  );
}

export default LocationSection;
