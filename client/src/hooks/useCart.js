import { useCallback, useEffect, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import useCartStore from '@/store/cartStore';
import { useAuth } from './useAuth';

const CART_KEY = ['cart'];

/**
 * Merge state lives at module scope, NOT in a ref.
 *
 * `useCart` is mounted by the header, the mobile header, the dropdown and every
 * product card at once. A per-instance guard lets each copy fire its own merge
 * in the same commit flush, and `mergeGuestCart` SUMS quantities - the cart
 * would come back multiplied by the number of mounted consumers.
 */
let mergeState = 'idle'; // 'idle' | 'running' | 'done'

/**
 * One cart interface for the whole app, over two backing stores.
 *
 * Guest      -> the persisted zustand store (localStorage). Survives a refresh,
 *               does not follow the user to another device.
 * Signed in  -> the server cart, mutated optimistically so a click still lands
 *               on the same frame (brief §6 requires the badge to move instantly).
 *
 * On sign-in the guest cart is merged into the account's cart exactly once, then
 * the local copy is dropped.
 */
export function useCart() {
  const { isAuthenticated: signedIn, isPanelAccount, isLoading: authLoading } = useAuth();
  // Staff viewing the website have no server cart (`denyAdmin`), so they get
  // the browser-only cart a guest gets: the page behaves, nothing is ordered.
  const isAuthenticated = signedIn && !isPanelAccount;
  const queryClient = useQueryClient();

  const local = useCartStore();

  // ---- server cart --------------------------------------------------------
  const { data, isLoading } = useQuery({
    queryKey: CART_KEY,
    queryFn: () => api.get('/cart'),
    enabled: isAuthenticated,
    staleTime: 30 * 1000,
    select: (payload) => payload.cart,
  });

  /**
   * Wraps a cart mutation so the cache is patched before the request goes out
   * and rolled back if it fails.
   */
  function optimistic(mutationFn, patch) {
    return {
      mutationFn,
      async onMutate(variables) {
        await queryClient.cancelQueries({ queryKey: CART_KEY });
        const previous = queryClient.getQueryData(CART_KEY);
        if (previous?.cart) {
          queryClient.setQueryData(CART_KEY, { cart: patch(previous.cart, variables) });
        }
        return { previous };
      },
      onError(_error, _variables, context) {
        if (context?.previous) queryClient.setQueryData(CART_KEY, context.previous);
      },
      onSettled() {
        queryClient.invalidateQueries({ queryKey: CART_KEY });
      },
    };
  }

  const recount = (cart) => ({
    ...cart,
    count: cart.items.reduce((sum, item) => sum + item.qty, 0),
    subtotal: cart.priceVisible
      ? cart.items.reduce((sum, item) => sum + (item.unitPrice ?? 0) * item.qty, 0)
      : null,
  });

  const addMutation = useMutation(
    optimistic(
      ({ productId, qty }) => api.post('/cart/items', { productId, qty }),
      (cart, { productId, qty, product }) => {
        const existing = cart.items.find((item) => item.productId === productId);
        const items = existing
          ? cart.items.map((item) =>
              item.productId === productId ? { ...item, qty: item.qty + qty } : item,
            )
          : [
              ...cart.items,
              {
                productId,
                qty,
                sku: product?.sku,
                name: product?.name,
                slug: product?.slug,
                grade: product?.grade,
                partType: product?.partType,
                partTypeLabel: product?.partTypeLabel,
                // No `stock`: the catalogue does not send a count, so the quantity
                // cap on this line arrives with the server's response a moment later.
                inStock: product?.inStock,
                priceVisible: cart.priceVisible,
                unitPrice: product?.price ?? null,
                lineTotal: (product?.price ?? 0) * qty,
              },
            ];
        return recount({ ...cart, items });
      },
    ),
  );

  const setQtyMutation = useMutation(
    optimistic(
      ({ productId, qty }) => api.patch(`/cart/items/${productId}`, { qty }),
      (cart, { productId, qty }) =>
        recount({
          ...cart,
          items:
            qty <= 0
              ? cart.items.filter((item) => item.productId !== productId)
              : cart.items.map((item) =>
                  item.productId === productId
                    ? { ...item, qty, lineTotal: (item.unitPrice ?? 0) * qty }
                    : item,
                ),
        }),
    ),
  );

  const removeMutation = useMutation(
    optimistic(
      ({ productId }) => api.delete(`/cart/items/${productId}`),
      (cart, { productId }) =>
        recount({ ...cart, items: cart.items.filter((item) => item.productId !== productId) }),
    ),
  );

  const saveMutation = useMutation({
    mutationFn: (name) => api.post('/cart/save', { name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CART_KEY }),
  });

  // ---- guest cart merge, once per sign-in ---------------------------------
  const mergeMutation = useMutation({
    mutationFn: (items) => api.post('/cart/merge', { items }),
    // A dev-server restart drops the in-flight socket; without a retry the guest
    // cart is stranded until the next sign-in.
    retry: 2,
    retryDelay: (attempt) => 500 * 2 ** attempt,
    onSuccess: (payload) => {
      mergeState = 'done';
      queryClient.setQueryData(CART_KEY, payload);
      // Drop the local copy only once the server confirms it holds the items.
      useCartStore.getState().clear();
    },
    onError: () => {
      // Back to idle, never 'done': the guest cart is still intact locally and
      // must get another chance on the next mount or sign-in.
      mergeState = 'idle';
    },
  });

  useEffect(() => {
    if (!isAuthenticated) {
      mergeState = 'idle';
      return;
    }
    if (mergeState !== 'idle') return;

    const guestItems = useCartStore.getState().items;
    if (guestItems.length === 0) {
      mergeState = 'done';
      return;
    }

    // Claim the merge before awaiting anything, so the sibling `useCart`
    // instances flushing in this same commit skip it.
    mergeState = 'running';
    mergeMutation.mutate(
      guestItems.map((item) => ({ productId: item.productId, qty: item.qty })),
    );
    // mergeMutation is stable enough for this one-shot effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  // ---- bundles and the promo code -----------------------------------------
  // No optimistic patching here. A bundle line and a discount are the pricing
  // engine's output, not arithmetic the client can predict - guessing then
  // correcting would flash a wrong total at the buyer.
  const bundleQtyMutation = useMutation({
    mutationFn: ({ offerId, qty }) => api.patch(`/cart/bundles/${offerId}`, { qty }),
    onSuccess: (payload) => queryClient.setQueryData(CART_KEY, payload),
  });

  const promoMutation = useMutation({
    mutationFn: (code) => api.post('/cart/promo', { code }),
    onSuccess: (payload) => queryClient.setQueryData(CART_KEY, payload),
  });

  const clearPromoMutation = useMutation({
    mutationFn: () => api.delete('/cart/promo'),
    onSuccess: (payload) => queryClient.setQueryData(CART_KEY, payload),
  });

  // ---- pre-owned phones -----------------------------------------------------
  // Server-only, like bundles: a phone is a priced thing, held by an approved
  // account, and the cart line is whatever the server says it is.
  const addPreownedMutation = useMutation({
    mutationFn: (deviceId) => api.post('/cart/preowned', { device: deviceId }),
    onSuccess: (payload) => queryClient.setQueryData(CART_KEY, payload),
  });

  const removePreownedMutation = useMutation({
    mutationFn: (deviceId) => api.delete(`/cart/preowned/${deviceId}`),
    onSuccess: (payload) => queryClient.setQueryData(CART_KEY, payload),
  });

  const setBundleQty = useCallback(
    (offerId, qty) => bundleQtyMutation.mutate({ offerId, qty }),
    [bundleQtyMutation],
  );

  const removeBundle = useCallback((offerId) => bundleQtyMutation.mutate({ offerId, qty: 0 }), [
    bundleQtyMutation,
  ]);

  // ---- unified surface ----------------------------------------------------
  const items = isAuthenticated
    ? (data?.items ?? [])
    : local.items.map((item) => ({
        ...item,
        unitPrice: item.price,
        lineTotal: (item.price ?? 0) * item.qty,
      }));

  const addItem = useCallback(
    (product, qty = 1) => {
      if (isAuthenticated) {
        addMutation.mutate({ productId: product.id, qty, product });
      } else {
        useCartStore.getState().addItem(product, qty);
      }
    },
    [isAuthenticated, addMutation],
  );

  const setQty = useCallback(
    (productId, qty) => {
      if (isAuthenticated) {
        setQtyMutation.mutate({ productId, qty });
      } else {
        useCartStore.getState().setQty(productId, qty);
      }
    },
    [isAuthenticated, setQtyMutation],
  );

  const removeItem = useCallback(
    (productId) => {
      if (isAuthenticated) {
        removeMutation.mutate({ productId });
      } else {
        useCartStore.getState().removeItem(productId);
      }
    },
    [isAuthenticated, removeMutation],
  );

  return useMemo(() => {
    const priceVisible = isAuthenticated ? Boolean(data?.priceVisible) : false;
    const bundles = isAuthenticated ? (data?.bundles ?? []) : [];
    const preowned = isAuthenticated ? (data?.preowned ?? []) : [];

    // Signed in, every figure is the server's: it is the only side that knows
    // about bundle pricing and which offer applied, and a second implementation
    // here would eventually disagree with the amount actually charged.
    const count = isAuthenticated
      ? (data?.count ?? 0)
      : items.reduce((sum, item) => sum + item.qty, 0);
    const subtotal = priceVisible
      ? (data?.subtotal ?? 0)
      : null;

    return {
      items,
      bundles,
      preowned,
      count,
      subtotal,
      // What the cart actually costs after bundle pricing and the one offer.
      payable: priceVisible ? (data?.payable ?? subtotal) : null,
      discount: priceVisible ? (data?.discount ?? 0) : null,
      bundleDiscount: priceVisible ? (data?.bundleDiscount ?? 0) : null,
      promoDiscount: priceVisible ? (data?.promoDiscount ?? 0) : null,
      promo: data?.promo ?? null,
      promoNotice: data?.promoNotice ?? null,
      promoCode: data?.promoCode ?? '',
      // The live ground band, for the cart's preview arithmetic. Null until the
      // cart resolves, and for an account that may not see prices at all.
      shippingPreview: priceVisible ? (data?.shippingPreview ?? null) : null,
      priceVisible,
      isLoading: isAuthenticated && isLoading,
      /**
       * True once we actually know what is in the cart.
       *
       * `items.length === 0` is ambiguous before this flips: it means "empty"
       * for a guest but "not fetched yet" for a signed-in user. Anything that
       * acts on emptiness - the checkout page's redirect, for one - must wait
       * for this rather than trusting the first render.
       */
      isReady: authLoading ? false : !isAuthenticated || data !== undefined,
      // Any line whose quantity now exceeds stock - blocks checkout.
      hasStockIssue:
        items.some((item) => item.exceedsStock) ||
        bundles.some((bundle) => !bundle.available) ||
        preowned.some((line) => !line.available),
      addItem,
      // Per-consumer: every product card mounts its own useCart, so this is that
      // card's add in flight, not any add anywhere.
      isAdding: addMutation.isPending,
      setQty,
      removeItem,
      saveForLater: (name) => saveMutation.mutate(name),
      isSaving: saveMutation.isPending,

      setBundleQty,
      removeBundle,
      addPreowned: addPreownedMutation.mutateAsync,
      isAddingPreowned: addPreownedMutation.isPending,
      removePreowned: (deviceId) => removePreownedMutation.mutate(deviceId),
      applyPromo: promoMutation.mutateAsync,
      clearPromo: () => clearPromoMutation.mutate(),
      isApplyingPromo: promoMutation.isPending,
    };
  }, [
    items,
    isAuthenticated,
    authLoading,
    data,
    isLoading,
    addItem,
    addMutation.isPending,
    setQty,
    removeItem,
    saveMutation,
    setBundleQty,
    removeBundle,
    addPreownedMutation,
    removePreownedMutation,
    promoMutation,
    clearPromoMutation,
  ]);
}

export default useCart;
