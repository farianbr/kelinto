import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';

/**
 * The supplier portal's session and data (§6.8a).
 *
 * Deliberately **not** part of `useAuth`. That context is the buyer/admin
 * session, and folding a supplier into it would mean every consumer of
 * `useAuth` - the header, the price gate, the cart, the admin shell - gained a
 * fourth kind of user it was never written to reason about. A supplier signs in
 * against a different cookie and a different collection on the server (see
 * `middleware/supplierAuth.js`); keeping the client split the same way is what
 * makes that separation visible rather than incidental.
 *
 * A plain hook rather than a provider: the portal is four screens, and the one
 * query below is cached by React Query anyway, so a context would add a
 * subscription boundary for nothing.
 */

const ME = ['supplier-portal', 'me'];

export function useSupplierSession() {
  const { data, isLoading } = useQuery({
    queryKey: ME,
    // Answers 200 with `supplier: null` when signed out, so there is no 401 to
    // swallow - an error here is a real one and should surface.
    queryFn: () => api.get('/supplier-portal/me'),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  return {
    /**
     * The platform-wide login. Present whenever somebody is signed in, even
     * before any business is chosen - an account holding only invitations is
     * signed in, just not working anywhere yet.
     */
    account: data?.account ?? null,
    /** That business's record of them, for the business being worked in. */
    supplier: data?.supplier ?? null,
    // Whose portal this is - the business being worked in, or on a business's
    // own host the one the host names. It paints the shell and names the
    // business on the sign-in page.
    business: data?.business ?? null,
    /** Every business the account is active with, to switch between. */
    businesses: data?.businesses ?? [],
    /** Businesses that have invited this account and are waiting for an answer. */
    invitations: data?.invitations ?? [],
    isLoading,
    isAuthenticated: Boolean(data?.account),
    /**
     * Signed in AND working inside a business. Every order, agreement and
     * proforma query waits on this, not on `isAuthenticated`: an account with
     * no business chosen has nothing of any business to ask for.
     */
    canWork: Boolean(data?.supplier),
  };
}

export function useSupplierOrders() {
  const { canWork } = useSupplierSession();
  return useQuery({
    queryKey: ['supplier-portal', 'orders'],
    queryFn: () => api.get('/supplier-portal/orders'),
    enabled: canWork,
    staleTime: 30 * 1000,
  });
}

/**
 * One order.
 *
 * Fetching it marks the bid `viewed` server-side, which is why this is not
 * prefetched with the list: "opened it and has not answered" is a fact the
 * purchasing team acts on, and it would stop being true if merely loading the
 * dashboard marked every order read.
 */
export function useSupplierOrder(id) {
  return useQuery({
    queryKey: ['supplier-portal', 'orders', id],
    queryFn: () => api.get(`/supplier-portal/orders/${id}`),
    enabled: Boolean(id),
  });
}

/**
 * The master agreement: what this supplier still owes us, and what they signed.
 *
 * Fetched on every portal screen rather than only on the agreement page,
 * because the *warning* is the point - a supplier who has not signed needs to
 * be told wherever they are, not only once they find the right page.
 */
export function useSupplierAgreement() {
  const { canWork } = useSupplierSession();
  return useQuery({
    queryKey: ['supplier-portal', 'agreement'],
    queryFn: () => api.get('/supplier-portal/agreement'),
    enabled: canWork,
    staleTime: 60 * 1000,
  });
}

export function useSupplierPortalMutations() {
  const queryClient = useQueryClient();

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['supplier-portal'] });

  /** Drop every per-business query, then ask for the session again. */
  const resetBusinessData = () => {
    queryClient.removeQueries({
      queryKey: ['supplier-portal'],
      predicate: (query) => query.queryKey[1] !== 'me',
    });
    invalidate();
  };

  return {
    signIn: useMutation({
      mutationFn: (body) => api.post('/supplier-portal/login', body),
      // The answer says only which business it landed in; the session query
      // carries everything else, so it is simply asked again.
      onSuccess: resetBusinessData,
    }),

    /**
     * Change which business the account works in - and with it, whose orders,
     * agreements and proformas every screen shows.
     *
     * Everything the portal has cached belonged to the business being left, so
     * it is dropped rather than refetched: showing one business's purchase
     * orders under another's name for even a frame is the one thing a switcher
     * must never do.
     */
    switchBusiness: useMutation({
      mutationFn: (business) => api.post('/supplier-portal/switch', { business }),
      onSuccess: resetBusinessData,
    }),
    /** Accepting moves straight into that business, as switching does. */
    acceptInvitation: useMutation({
      mutationFn: (business) => api.post(`/supplier-portal/invitations/${business}/accept`, {}),
      onSuccess: resetBusinessData,
    }),
    declineInvitation: useMutation({
      mutationFn: (business) => api.post(`/supplier-portal/invitations/${business}/decline`, {}),
      onSuccess: invalidate,
    }),
    signOut: useMutation({
      mutationFn: () => api.post('/supplier-portal/logout', {}),
      onSuccess: () => {
        queryClient.setQueryData(ME, { account: null, supplier: null, businesses: [], invitations: [] });
        // Cleared rather than refetched: the next supplier to sign in on this
        // browser must not see the previous one's orders for even a frame.
        queryClient.removeQueries({
          queryKey: ['supplier-portal'],
          predicate: (query) => query.queryKey[1] !== 'me',
        });
      },
    }),
    forgotPassword: useMutation({
      mutationFn: (body) => api.post('/supplier-portal/forgot-password', body),
    }),
    resetPassword: useMutation({
      mutationFn: (body) => api.post('/supplier-portal/reset-password', body),
    }),
    changePassword: useMutation({
      mutationFn: (body) => api.post('/supplier-portal/password', body),
    }),
    /**
     * Sign the master agreement.
     *
     * Invalidates everything under `supplier-portal`, not just the agreement:
     * the dashboard banner, the order pages' "you cannot quote yet" state and
     * the profile all read this answer, and a stale one of them would tell a
     * supplier they still owe a signature they have just given.
     */
    signAgreement: useMutation({
      mutationFn: (body) => api.post('/supplier-portal/agreement/sign', body),
      onSuccess: invalidate,
    }),
    submitQuote: useMutation({
      mutationFn: ({ id, ...body }) => api.post(`/supplier-portal/orders/${id}/quote`, body),
      onSuccess: invalidate,
    }),
    declineQuote: useMutation({
      mutationFn: ({ id, ...body }) => api.post(`/supplier-portal/orders/${id}/decline`, body),
      onSuccess: invalidate,
    }),
    // The supplier's own proforma invoice. Every figure on it is computed
    // server-side from the prices they already sent.
    submitProforma: useMutation({
      mutationFn: ({ id, ...body }) => api.post(`/supplier-portal/orders/${id}/proforma`, body),
      onSuccess: invalidate,
    }),
    // Only the confirmed supplier may report this, and it never moves stock.
    setDeliveryStatus: useMutation({
      mutationFn: ({ id, ...body }) => api.post(`/supplier-portal/orders/${id}/delivery`, body),
      onSuccess: invalidate,
    }),
  };
}
