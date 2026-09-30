import cn from '@/lib/cn';
import ContactForm from '@/components/website/ContactForm';

/**
 * The contact form at the foot of a website page: the last section, because it
 * is what a reader who got this far without finding their answer does next.
 *
 * The same form as /contact (`ContactForm`), writing to the same inbox. The
 * heading column is short on purpose: the reader has just passed the address,
 * phone and hours in the Location section, so repeating them here would be the
 * third time on one screen.
 */
export function ContactSection({ className }) {
  return (
    <section
      aria-labelledby="page-contact"
      className={cn('rounded-xl border border-line bg-surface px-5 py-8 sm:px-8 sm:py-10 lg:px-12 lg:py-12', className)}
    >
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:gap-14">
        <div>
          <p className="eyebrow mb-2 inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-ink-400">
            <span className="size-1 rounded-full bg-brand" aria-hidden="true" />
            Contact us
          </p>
          <h2 id="page-contact" className="text-2xl tracking-[-0.03em] sm:text-3xl">
            Send us a message
          </h2>
          <p className="mt-3 max-w-md text-md leading-relaxed text-ink-500">
            A question, a quote or a problem with something you bought. It goes straight to our
            team, and the reply comes to your email.
          </p>
        </div>

        <ContactForm className="min-w-0" />
      </div>
    </section>
  );
}

export default ContactSection;
