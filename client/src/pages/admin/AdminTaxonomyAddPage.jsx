import { useState } from 'react';
import { useNavigate } from 'react-router';
import useAdminForm from '@/hooks/useAdminForm';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, Network, Save, Tags } from 'lucide-react';

import { taxonomyCreateSchema } from '@shared/schemas/admin';
import cn from '@/lib/cn';
import { pressable } from '@/lib/motion';
import Panel from '@/components/ui/Panel';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import Button from '@/components/ui/Button';
import PageHeader from '@/components/admin/PageHeader';
import { ADMIN_ROUTES } from '@/lib/adminRoutes';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import { useAdminMutations } from '@/hooks/useAdmin';

/**
 * Add a device model (Device & Models → Add Model).
 *
 * ## Four names, not a parent picker
 *
 * The taxonomy is a tree - `deviceType › brand › series › model` - but this
 * form asks for four plain names, because that is how somebody adding "the new
 * Pixel" thinks. They do not know whether a `Google` brand node exists, and
 * making them find out first would be three screens to add one phone. The
 * server resolves each level by slug and creates what is missing, so typing
 * `Phone / Apple / iPhone 15 / iPhone 15 Pro Max` on a fresh install builds the
 * whole branch and typing it again reuses all of it.
 *
 * **Device/Series is optional.** A model with no series hangs off the brand,
 * which is what the seeded data already does for the catalogue's flatter
 * corners.
 *
 * ## Aliases are the reason this screen exists
 *
 * §6.15 is explicit that they are the valuable part: `15 PM`, `iphone15pm` and
 * `15 Pro Max` all resolving to one model is what a wholesale search box needs.
 * They are entered one per line or comma-separated, and the server lowercases
 * and deduplicates them - so the field can be typed the way a person lists
 * things rather than the way a database stores them.
 */
const ROUTE = ADMIN_ROUTES['/admin/settings/taxonomy/add'];
const ADMIN_PAGE = { ...ROUTE, icon: adminIcon(ROUTE.icon) };

export function AdminTaxonomyAddPage() {
  const navigate = useNavigate();
  const { createTaxonomyNode } = useAdminMutations();
  const [formError, setFormError] = useState(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useAdminForm({
    resolver: zodResolver(taxonomyCreateSchema),
    defaultValues: { deviceType: '', brand: '', series: '', name: '', aliases: '' },
  });

  const back = () => navigate('/admin/settings/taxonomy');

  async function onSubmit(values) {
    setFormError(null);
    try {
      await createTaxonomyNode.mutateAsync(values);
      back();
    } catch (err) {
      // The server refuses a duplicate model and an alias that already points
      // somewhere else, and both messages name the record they collided with -
      // so they are shown as written rather than replaced with a generic one.
      setFormError(err.message);
    }
  }

  return (
    <div className="form-page">
      <button
        type="button"
        onClick={back}
        className={cn(pressable, 'mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-500 hover:text-ink-900')}
      >
        <ArrowLeft className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
        Back to Device &amp; Models
      </button>

      <PageHeader
        icon={ADMIN_PAGE.icon}
        title="Add device model"
        description="A new entry for the searchable device picker on tickets, invoices and quotes."
      />

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Panel
          title="Category › Brand › Device › Model"
          description="Each level is matched to what already exists, or created. Only the model has to be new."
          icon={Network}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Category"
              required
              placeholder="Phone, Tablet, Laptop…"
              error={errors.deviceType?.message}
              {...register('deviceType')}
            />
            <Input
              label="Brand"
              required
              placeholder="Apple, Samsung, Google…"
              error={errors.brand?.message}
              {...register('brand')}
            />
            <Input
              label="Device / Series"
              placeholder="S-Series, iPhone, Galaxy Tab…"
              hint="The family level, e.g. Phone › Samsung › S-Series › S23 Ultra. Optional."
              error={errors.series?.message}
              {...register('series')}
            />
            <Input
              label="Model name"
              required
              placeholder="Samsung S23 Ultra"
              hint='Be exact - "iPhone 13 Pro Max", not "iPhone 13".'
              error={errors.name?.message}
              {...register('name')}
            />
          </div>
        </Panel>

        <Panel
          title="Aliases"
          description="What staff might type that should find this model."
          icon={Tags}
        >
          <Textarea
            aria-label="Aliases"
            rows={4}
            placeholder={'13 PM\n13 Pro Max\niphone13pm'}
            hint="One per line, or comma-separated. Matching ignores case. Without aliases, only the exact brand and model name find it in the picker."
            error={errors.aliases?.message}
            {...register('aliases')}
          />
        </Panel>

        {formError && (
          <p role="alert" className="text-sm text-danger">
            {formError}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" icon={Save} loading={isSubmitting || createTaxonomyNode.isPending}>
            Add model
          </Button>
          <Button type="button" variant="outline" onClick={back}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}

export default AdminTaxonomyAddPage;
