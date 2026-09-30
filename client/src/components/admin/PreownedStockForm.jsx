import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';

import { preownedUpdateSchema } from '@shared/schemas/admin';
import useAdminForm from '@/hooks/useAdminForm';
import useUploadSession from '@/hooks/useUploadSession';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import SelectField from '@/components/ui/SelectField';
import Button from '@/components/ui/Button';
import AssetUpload from '@/components/admin/AssetUpload';
import { usePreownedMutations } from '@/hooks/usePreowned';

export const PREOWNED_GRADE_OPTIONS = [
  { value: 'like_new', label: 'Like new' },
  { value: 'excellent', label: 'Excellent' },
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
];

/** Four photo slots: front, back, sides. Enough to show wear without a gallery. */
const PHOTO_SLOTS = 4;

/**
 * Edit one pre-owned phone in stock: its price, grade, the words and photos the
 * website shows.
 *
 * The form is the confirmation (Instructions §3.0.1): it was opened on purpose
 * and filled in. Photos go through the same upload session as every other
 * form, so a photo uploaded and then abandoned is deleted rather than left in
 * the bucket.
 */
export function PreownedStockForm({ device, onCancel, onSaved }) {
  const { updateStock } = usePreownedMutations();
  const uploads = useUploadSession();
  const [photos, setPhotos] = useState(() =>
    Array.from({ length: PHOTO_SLOTS }, (_, index) => device.photos[index] ?? ''),
  );

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useAdminForm({
    resolver: zodResolver(preownedUpdateSchema),
    defaultValues: {
      sellingPriceDollars: (device.priceCents / 100).toFixed(2),
      grade: device.grade,
      description: device.description ?? '',
    },
  });

  async function onSubmit(values) {
    try {
      await updateStock.mutateAsync({
        id: device.id,
        ...values,
        photos: photos.filter(Boolean),
      });
      uploads.settle();
      onSaved?.();
    } catch (error) {
      setError('root', { message: error.message });
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Selling price"
          required
          inputMode="decimal"
          suffix="CAD"
          placeholder="349.00"
          hint={`Bought for ${(device.costCents / 100).toFixed(2)}.`}
          error={errors.sellingPriceDollars?.message}
          {...register('sellingPriceDollars')}
        />
        <SelectField control={control} name="grade" label="Grade" options={PREOWNED_GRADE_OPTIONS} />
      </div>

      <Textarea
        rows={3}
        counter={1000}
        label="What the website says"
        hint="Wear, battery health, what is in the box. Customers read this before buying."
        placeholder="Light scratches on the back. Battery health 89%. Charger not included."
        error={errors.description?.message}
        {...register('description')}
      />

      <div>
        <p className="mb-1 text-xs font-medium text-ink-700">Photos</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {photos.map((url, index) => (
            <AssetUpload
              key={index}
              value={url}
              endpoint="catalogue"
              kind="product-image"
              placeholder={index === 0 ? 'Main photo' : 'Photo'}
              session={uploads}
              onChange={(next) =>
                setPhotos((current) => current.map((value, at) => (at === index ? next : value)))
              }
            />
          ))}
        </div>
      </div>

      {errors.root && (
        <p role="alert" className="border-l-2 border-danger pl-3 text-sm text-danger">
          {errors.root.message}
        </p>
      )}

      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button
          variant="outline"
          onClick={() => {
            uploads.discardAll();
            onCancel?.();
          }}
        >
          Cancel
        </Button>
        <Button type="submit" loading={isSubmitting || updateStock.isPending}>
          Save
        </Button>
      </div>
    </form>
  );
}

export default PreownedStockForm;
