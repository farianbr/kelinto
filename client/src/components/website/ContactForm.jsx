import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { AlertCircle, Check, Send } from 'lucide-react';
import cn from '@/lib/cn';
import api from '@/lib/api';
import scrollToSection from '@/lib/scrollToSection';
import { contactSchema, CONTACT_TOPICS } from '@shared/schemas/contact';
import Input from '@/components/ui/Input';
import PhoneField from '@/components/ui/PhoneField';
import SelectField from '@/components/ui/SelectField';
import Textarea from '@/components/ui/Textarea';
import Button from '@/components/ui/Button';
import { useAuth } from '@/hooks/useAuth';

/**
 * The website's contact form: the /contact page's, and the Contact section at
 * the foot of every other page (`PageSections`). One component, so the two can
 * never disagree about what they ask or where it goes: every message lands in
 * the same inbox, ERP › Sales › Web Quotes.
 *
 * It carries the anchor id `contact-form`, and there is never more than one on
 * a page (the contact page takes no Contact section, `shared/websitePages.js`),
 * so anything on the page can send the reader to it - see `openContactForm`.
 */

const ANCHOR_ID = 'contact-form';
const PREFILL_EVENT = 'website:contact-prefill';

/**
 * Send the reader to this page's contact form with a topic chosen, when the
 * page has one. Returns false when it does not, and the caller links to
 * /contact instead.
 *
 * An event rather than a URL parameter: writing `?topic=` into the address
 * would land on top of the Shop page's own filter parameters, which ARE the
 * page there.
 */
export function openContactForm({ topic } = {}) {
  if (typeof document === 'undefined' || !document.getElementById(ANCHOR_ID)) return false;
  window.dispatchEvent(new CustomEvent(PREFILL_EVENT, { detail: { topic } }));
  scrollToSection(ANCHOR_ID, { updateHash: false });
  return true;
}

/**
 * Reads a question that was started somewhere else.
 *
 * The product page links to /contact carrying the SKU it was on, so a buyer
 * asking about a part does not have to go back and find the part number. Only
 * the two parameters below are honoured, and the message is composed here
 * rather than taken from the URL - a link that can type into a form somebody
 * else submits is not a link worth accepting.
 */
function usePrefill() {
  const [params] = useSearchParams();
  const sku = (params.get('sku') ?? '').trim().slice(0, 40);
  const requested = params.get('topic') ?? '';
  const topic = CONTACT_TOPICS.some((option) => option.value === requested) ? requested : 'other';

  return {
    topic,
    message: sku ? `I have a question about ${sku}:\n\n` : '',
  };
}

export function ContactForm({ className }) {
  const { user } = useAuth();
  const prefill = usePrefill();
  const [sent, setSent] = useState(null);

  const {
    register,
    handleSubmit,
    watch,
    reset,
    control,
    setValue,
    setFocus,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(contactSchema),
    // Autofill from the account when there is one - same courtesy as checkout.
    values: {
      name: user?.contactName ?? '',
      business: user?.businessName ?? '',
      email: user?.email ?? '',
      phone: user?.phone ?? '',
      topic: prefill.topic,
      orderNumber: '',
      message: prefill.message,
    },
  });

  // "Get a quote" elsewhere on the page picks the topic and brings the reader
  // here; focus lands on the first field they still have to fill.
  useEffect(() => {
    function onPrefill(event) {
      const topic = event.detail?.topic;
      if (CONTACT_TOPICS.some((option) => option.value === topic)) setValue('topic', topic);
      setFocus(user ? 'message' : 'name');
    }
    window.addEventListener(PREFILL_EVENT, onPrefill);
    return () => window.removeEventListener(PREFILL_EVENT, onPrefill);
  }, [setValue, setFocus, user]);

  const topic = watch('topic');

  const submit = useMutation({
    mutationFn: (payload) => api.post('/contact', payload),
    onSuccess: (response) => {
      setSent(response.message);
      reset({ ...watch(), message: '', orderNumber: '' });
    },
  });

  return (
    <form
      id={ANCHOR_ID}
      onSubmit={handleSubmit((values) => submit.mutate(values))}
      className={cn('scroll-mt-32 rounded-xl border border-line bg-surface-2 p-5 sm:p-7', className)}
    >
      {sent && (
        <p className="mb-5 flex items-start gap-2.5 rounded-lg border-l-2 border-ok bg-surface px-4 py-3 text-md text-ink-700">
          <Check className="mt-0.5 size-4 shrink-0 text-ok" strokeWidth={2} aria-hidden="true" />
          {sent}
        </p>
      )}

      {submit.isError && (
        <p className="mb-5 flex items-start gap-2.5 rounded-lg border-l-2 border-danger bg-surface px-4 py-3 text-md text-ink-700">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" strokeWidth={2} aria-hidden="true" />
          {submit.error.message}
        </p>
      )}

      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Your name" error={errors.name?.message} {...register('name')} />
          <Input label="Business" placeholder="Optional" {...register('business')} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Email"
            type="email"
            autoComplete="email"
            error={errors.email?.message}
            {...register('email')}
          />
          <Controller
            name="phone"
            control={control}
            render={({ field }) => (
              <PhoneField
                label="Phone"
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                hint="Optional."
              />
            )}
          />
        </div>

        <SelectField control={control} name="topic" label="What is this about?" options={CONTACT_TOPICS} />

        {/* Only asked for when it is actually relevant. */}
        {topic === 'order' && (
          <Input label="Order number" className="font-mono" {...register('orderNumber')} />
        )}

        <Textarea
          // Stable id rather than the generated one: the screenshot runner
          // waits on this field to know the form has painted.
          id="contact-message"
          label="Message"
          rows={6}
          placeholder="What you need, and for which device…"
          error={errors.message?.message}
          {...register('message')}
        />

        <Button type="submit" size="lg" icon={Send} loading={submit.isPending} fullWidth>
          Send message
        </Button>
      </div>
    </form>
  );
}

export default ContactForm;
