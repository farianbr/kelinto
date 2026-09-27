import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuth } from './useAuth';

/**
 * An approved CUSTOMER. Staff viewing the website are signed in and may be
 * `approved`, but have no buyer side (`denyAdmin`), so nothing here is asked
 * for on their behalf.
 */
function useIsBuyer() {
  const { isApproved, isPanelAccount } = useAuth();
  return isApproved && !isPanelAccount;
}

/** Dashboard payload: recent orders, credit, invoice totals, quick reorder. */
export function useAccountSummary() {
  const isApproved = useIsBuyer();
  return useQuery({
    queryKey: ['account', 'summary'],
    queryFn: () => api.get('/account/summary'),
    enabled: isApproved,
    staleTime: 60 * 1000,
  });
}

export function useOrders() {
  const isApproved = useIsBuyer();
  return useQuery({
    queryKey: ['orders'],
    queryFn: () => api.get('/orders'),
    enabled: isApproved,
    select: (payload) => payload.orders,
    staleTime: 60 * 1000,
  });
}

export function useOrder(orderNumber) {
  return useQuery({
    queryKey: ['orders', orderNumber],
    queryFn: () => api.get(`/orders/${orderNumber}`),
    select: (payload) => payload.order,
    enabled: Boolean(orderNumber),
  });
}

export function useInvoices() {
  const isApproved = useIsBuyer();
  return useQuery({
    queryKey: ['invoices'],
    queryFn: () => api.get('/invoices'),
    enabled: isApproved,
    staleTime: 60 * 1000,
  });
}

/**
 * The store-credit statement: balance plus the movements behind it.
 *
 * Separate query from the account summary, which carries only the balance - the
 * statement is a page, the balance is a number several pages want.
 */
export function useStoreCredit() {
  const isApproved = useIsBuyer();
  return useQuery({
    queryKey: ['store-credit'],
    queryFn: () => api.get('/account/store-credit'),
    enabled: isApproved,
    staleTime: 30 * 1000,
  });
}

/**
 * Line-of-credit movements - the draws and repayments behind the balance.
 * Separate from useStoreCredit: two instruments, two statements.
 */
export function useCreditActivity() {
  const isApproved = useIsBuyer();
  return useQuery({
    queryKey: ['credit-activity'],
    queryFn: () => api.get('/account/credit-activity'),
    enabled: isApproved,
    staleTime: 60 * 1000,
  });
}

/**
 * The account's own history - orders, invoices, payments and credit movements
 * merged into one feed. The same feed the account rep sees on the admin side.
 */
export function useAccountActivity() {
  const isApproved = useIsBuyer();
  return useQuery({
    queryKey: ['activity'],
    queryFn: () => api.get('/account/activity'),
    enabled: isApproved,
    select: (payload) => payload.activity,
    staleTime: 60 * 1000,
  });
}

/**
 * The activity page's feed: the same history, filtered by kind and date and cut
 * into pages by the server.
 *
 * `placeholderData` keeps the previous page on screen while the next one loads,
 * so paging does not collapse the list to a skeleton and bounce the scroll
 * position back to the top on every click.
 */
export function useActivityHistory({ kind = 'all', from = null, to = null, page = 1, limit = 20 } = {}) {
  const isApproved = useIsBuyer();

  return useQuery({
    queryKey: ['activity', 'history', { kind, from, to, page, limit }],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (kind && kind !== 'all') params.set('kind', kind);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      return api.get(`/account/activity/history?${params}`);
    },
    enabled: isApproved,
    placeholderData: (previous) => previous,
    staleTime: 60 * 1000,
  });
}

/** Referral code, rate, referred accounts and what they have earned. */
export function useReferrals() {
  const isApproved = useIsBuyer();
  return useQuery({
    queryKey: ['referrals'],
    queryFn: () => api.get('/account/referrals'),
    enabled: isApproved,
    staleTime: 60 * 1000,
  });
}

export function useSavedCarts() {
  const isApproved = useIsBuyer();
  return useQuery({
    queryKey: ['cart', 'saved'],
    queryFn: () => api.get('/cart/saved'),
    enabled: isApproved,
    select: (payload) => payload.carts,
  });
}

/**
 * Everything a payment or a credit movement makes stale.
 *
 * Paying an invoice touches more than the invoice: it repays the line of
 * credit, may spend store credit, can settle a `due` record into a real
 * invoice, and lands on the activity feed. Listed once here because a caller
 * that forgets one of them leaves a screen quietly showing money that has
 * already moved.
 */
function afterMoneyMoved(queryClient) {
  for (const key of [
    ['invoices'],
    ['store-credit'],
    ['credit-activity'],
    ['activity'],
    ['account', 'summary'],
    // The checkout quote carries what credit can cover, so it is stale now.
    ['quote'],
    // Commission is earned on payment, so a referrer's standing can change.
    ['referrals'],
  ]) {
    queryClient.invalidateQueries({ queryKey: key });
  }
}

/**
 * Account mutations.
 *
 * Every one of these returns the updated user, so they all write straight into
 * the auth cache - the header, checkout autofill and address list stay in step
 * without a refetch round-trip.
 */
export function useAccountMutations() {
  const queryClient = useQueryClient();

  const writeUser = (payload) => {
    if (payload?.user) queryClient.setQueryData(['auth', 'me'], { user: payload.user });
    queryClient.invalidateQueries({ queryKey: ['account', 'summary'] });
  };

  return {
    updateProfile: useMutation({
      mutationFn: (data) => api.patch('/account/profile', data),
      onSuccess: writeUser,
    }),
    addAddress: useMutation({
      mutationFn: (data) => api.post('/account/addresses', data),
      onSuccess: writeUser,
    }),
    updateAddress: useMutation({
      mutationFn: ({ id, ...data }) => api.patch(`/account/addresses/${id}`, data),
      onSuccess: writeUser,
    }),
    removeAddress: useMutation({
      mutationFn: (id) => api.delete(`/account/addresses/${id}`),
      onSuccess: writeUser,
    }),
    addPaymentMethod: useMutation({
      mutationFn: (data) => api.post('/account/payment-methods', data),
      onSuccess: writeUser,
    }),
    removePaymentMethod: useMutation({
      mutationFn: (id) => api.delete(`/account/payment-methods/${id}`),
      onSuccess: writeUser,
    }),
    changePassword: useMutation({
      mutationFn: (data) => api.post('/account/password', data),
    }),
    rechargeStoreCredit: useMutation({
      mutationFn: (data) => api.post('/account/store-credit/recharge', data),
      onSuccess: () => {
        afterMoneyMoved(queryClient);
      },
    }),

    /**
     * Pay one invoice in full.
     *
     * No amount is sent: the balance is the server's own fact and §5.3 keeps
     * the client out of deciding what money moves. `useStoreCredit` asks for
     * credit to be drawn first, and how much that covers is decided server-side
     * too.
     */
    payInvoice: useMutation({
      mutationFn: ({ number, ...data }) => api.post(`/invoices/${number}/pay`, data),
      onSuccess: () => afterMoneyMoved(queryClient),
    }),

    /** Clear the whole line of credit in one charge, oldest amounts first. */
    payOffCredit: useMutation({
      mutationFn: (data) => api.post('/account/credit/payoff', data),
      onSuccess: () => afterMoneyMoved(queryClient),
    }),
    bulkAdd: useMutation({
      mutationFn: (lines) => api.post('/cart/bulk', { lines }),
      onSuccess: (payload) => {
        queryClient.setQueryData(['cart'], { cart: payload.cart });
      },
    }),
    restoreSavedCart: useMutation({
      mutationFn: (id) => api.post(`/cart/saved/${id}/restore`),
      onSuccess: (payload) => {
        queryClient.setQueryData(['cart'], { cart: payload.cart });
        queryClient.invalidateQueries({ queryKey: ['cart', 'saved'] });
        queryClient.invalidateQueries({ queryKey: ['account', 'summary'] });
      },
    }),
    deleteSavedCart: useMutation({
      mutationFn: (id) => api.delete(`/cart/saved/${id}`),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['cart', 'saved'] });
        queryClient.invalidateQueries({ queryKey: ['account', 'summary'] });
      },
    }),
  };
}
