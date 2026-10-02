import { useNavigate, useParams, useSearchParams } from 'react-router';
import { ArrowLeft } from 'lucide-react';

import cn from '@/lib/cn';
import { pressable } from '@/lib/motion';
import Skeleton from '@/components/ui/Skeleton';
import PageHeader from '@/components/admin/PageHeader';
import { ProductForm } from '@/components/admin/StockForms';
import { ADMIN_ROUTES } from '@/lib/adminRoutes';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import { useAdminInventoryItem, useAdminMutations } from '@/hooks/useAdmin';
import { useSetRecordLabel } from '@/components/admin/shell/recordLabel';

/**
 * Add or edit a product (Inventory › New product, and a product's Edit), a
 * page since 2026-10-02 (client: "new product should be on the page, not
 * modal").
 *
 * ## What it is opened for
 *
 * Putting one thing on sale, of any type. The form reads top to bottom in the
 * order the decisions are made, each a titled section that says what it is
 * for: what it is (its type first, because the type decides everything after
 * it), where it is filed (the type's own category levels), what sets it apart
 * (the type's features), its price and stock, its pictures, and whether it is
 * on the website. Save sits in a bar that stays in view.
 *
 * A new product lands on its own page, where the reorder point, cost and
 * supplier are set; an edit goes back to where it came from.
 */
export function AdminProductFormPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const editing = Boolean(id);
  const route = ADMIN_ROUTES[editing ? '/admin/inventory/:id/edit' : '/admin/inventory/new'];
  const { data, isLoading } = useAdminInventoryItem(editing ? id : null);
  const product = editing ? data?.product : null;
  const { createProduct, updateProduct } = useAdminMutations();
  useSetRecordLabel(product?.name);

  const back = () => navigate(editing ? `/admin/inventory/${id}` : '/admin/inventory');
  const mutation = editing ? updateProduct : createProduct;

  if (editing && isLoading) {
    return (
      <div className="form-page space-y-4">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="form-page">
      <button
        type="button"
        onClick={back}
        className={cn(pressable, 'mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-500 hover:text-ink-900')}
      >
        <ArrowLeft className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
        {editing ? 'Back to the product' : 'Back to Inventory'}
      </button>

      <PageHeader
        icon={adminIcon(route.icon)}
        title={editing ? `Edit ${product?.name ?? 'product'}` : 'New product'}
        description={
          editing
            ? 'Its type, category, features, price and pictures. Reorder point, cost and supplier are on its own page.'
            : 'One thing on sale, of any type. Its reorder point, cost and supplier come next, on its own page.'
        }
      />

      <ProductForm
        key={product?.id ?? 'new'}
        product={product}
        initialCategory={params.get('type') || 'parts'}
        isPending={mutation.isPending}
        error={mutation.error?.message}
        onCancel={back}
        onSubmit={(values) =>
          editing
            ? updateProduct.mutate({ id, ...values }, { onSuccess: back })
            : createProduct.mutate(values, {
                // A new product needs a reorder point and a cost before it is
                // much use, and both live on its own page.
                onSuccess: (payload) => navigate(payload?.product?.id ? `/admin/inventory/${payload.product.id}` : '/admin/inventory'),
              })
        }
      />
    </div>
  );
}

export default AdminProductFormPage;
