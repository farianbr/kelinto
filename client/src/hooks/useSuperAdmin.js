import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';

/**
 * The super-admin console's data layer (SAAS_PLATFORM §4.5).
 *
 * **Its own query-key namespace**, kept clear of `['admin']` and
 * `['supplier-portal']`. The three sessions are separate on the server and the
 * cache follows: signing out of one must not drop another's data, and an
 * `invalidateQueries({ queryKey: ['admin'] })` from the business switcher has
 * no business touching the console.
 */

const ME = ['superadmin', 'me'];

export function useSuperAdminSession() {
  const { data, isLoading } = useQuery({
    queryKey: ME,
    // Answers 200 with `admin: null` when signed out, so there is no 401 to
    // catch - an error here is a real one and should surface.
    queryFn: () => api.get('/superadmin/me'),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  return {
    admin: data?.admin ?? null,
    isLoading,
    isAuthenticated: Boolean(data?.admin),
  };
}

export function useTenants() {
  const { isAuthenticated } = useSuperAdminSession();
  return useQuery({
    queryKey: ['superadmin', 'tenants'],
    queryFn: () => api.get('/superadmin/tenants'),
    enabled: isAuthenticated,
    staleTime: 15 * 1000,
  });
}

export function usePlans() {
  const { isAuthenticated } = useSuperAdminSession();
  return useQuery({
    queryKey: ['superadmin', 'plans'],
    queryFn: () => api.get('/superadmin/plans'),
    enabled: isAuthenticated,
    staleTime: 60 * 1000,
  });
}

/**
 * Support sessions - the history, and who is inside a business right now.
 *
 * `live` narrows it to open grants. Polled rather than left stale: a staff member
 * elsewhere entering or leaving a business is exactly the kind of change this
 * screen exists to show, and a console that needed a manual refresh to notice
 * would be answering yesterday's question.
 */
export function useImpersonations({ live } = {}) {
  const { isAuthenticated } = useSuperAdminSession();
  return useQuery({
    queryKey: ['superadmin', 'impersonation', { live: Boolean(live) }],
    queryFn: () => api.get('/superadmin/impersonation', live ? { live: 1 } : undefined),
    enabled: isAuthenticated,
    staleTime: 10 * 1000,
    refetchInterval: 30 * 1000,
  });
}

/** Every tenant's support conversation, newest activity first. */
export function useSupportThreads() {
  const { isAuthenticated } = useSuperAdminSession();
  return useQuery({
    queryKey: ['superadmin', 'support'],
    queryFn: () => api.get('/superadmin/support'),
    enabled: isAuthenticated,
    staleTime: 10 * 1000,
    // A tenant writing to us is the one thing here that arrives unprompted, so
    // the list checks for itself rather than waiting to be reloaded.
    refetchInterval: 30 * 1000,
  });
}

/** One tenant's conversation. Fetching it marks it read for the platform. */
export function useSupportThread(tenantId) {
  return useQuery({
    queryKey: ['superadmin', 'support', tenantId],
    queryFn: () => api.get(`/superadmin/support/${tenantId}`),
    enabled: Boolean(tenantId),
    refetchInterval: 20 * 1000,
  });
}

/** One business's feature grid - every key, its answer, and where it came from. */
export function useBusinessFeatures(businessId) {
  return useQuery({
    queryKey: ['superadmin', 'businesses', businessId, 'features'],
    queryFn: () => api.get(`/superadmin/businesses/${businessId}/features`),
    enabled: Boolean(businessId),
  });
}

export function useSuperAdminMutations() {
  const queryClient = useQueryClient();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['superadmin'] });

  return {
    signIn: useMutation({
      mutationFn: (body) => api.post('/superadmin/login', body),
      onSuccess: (result) => {
        queryClient.setQueryData(ME, { admin: result.admin });
        invalidate();
      },
    }),
    signOut: useMutation({
      mutationFn: () => api.post('/superadmin/logout', {}),
      onSuccess: () => {
        queryClient.setQueryData(ME, { admin: null });
        // Cleared rather than refetched: the next staff member to sign in on this
        // browser must not see the previous one's tenants for even a frame.
        queryClient.removeQueries({ queryKey: ['superadmin', 'tenants'] });
      },
    }),

    createTenant: useMutation({
      mutationFn: (body) => api.post('/superadmin/tenants', body),
      onSuccess: invalidate,
    }),
    updateTenant: useMutation({
      mutationFn: ({ id, ...body }) => api.patch(`/superadmin/tenants/${id}`, body),
      onSuccess: invalidate,
    }),
    setSlots: useMutation({
      mutationFn: ({ id, slots }) => api.patch(`/superadmin/tenants/${id}/slots`, { slots }),
      onSuccess: invalidate,
    }),
    createBusiness: useMutation({
      mutationFn: ({ id, ...body }) => api.post(`/superadmin/tenants/${id}/businesses`, body),
      onSuccess: invalidate,
    }),
    assignBusiness: useMutation({
      mutationFn: ({ id, tenant }) =>
        api.patch(`/superadmin/businesses/${id}/tenant`, { tenant }),
      onSuccess: invalidate,
    }),

    /**
     * `enabled: null` clears the override rather than switching the feature
     * off - a different act, and the only way back to a plan or type default.
     */
    setFeature: useMutation({
      mutationFn: ({ id, key, enabled }) =>
        api.patch(`/superadmin/businesses/${id}/features`, { key, enabled }),
      onSuccess: invalidate,
    }),

    createPlan: useMutation({
      mutationFn: (body) => api.post('/superadmin/plans', body),
      onSuccess: invalidate,
    }),
    updatePlan: useMutation({
      mutationFn: ({ id, ...body }) => api.patch(`/superadmin/plans/${id}`, body),
      onSuccess: invalidate,
    }),
    /** `enabled: null` clears the default rather than switching the feature off. */
    setPlanFeature: useMutation({
      mutationFn: ({ id, key, enabled }) =>
        api.patch(`/superadmin/plans/${id}/features`, { key, enabled }),
      onSuccess: invalidate,
    }),

    /** A tenant's requested address. Approving makes it live immediately. */
    approveAddressRequest: useMutation({
      mutationFn: ({ id }) => api.post(`/superadmin/businesses/${id}/address-request/approve`, {}),
      onSuccess: invalidate,
    }),
    rejectAddressRequest: useMutation({
      mutationFn: ({ id, note }) =>
        api.post(`/superadmin/businesses/${id}/address-request/reject`, { note }),
      onSuccess: invalidate,
    }),
    /**
     * Slug, storefront domain and panel domain. Changing the slug breaks links
     * to the old one. All three travel every time: the server reads a missing
     * field as "clear it", so dropping one here would wipe it on every save.
     */
    setBusinessAddress: useMutation({
      mutationFn: ({ id, slug, domain, panelDomain }) =>
        api.patch(`/superadmin/businesses/${id}/address`, { slug, domain, panelDomain }),
      onSuccess: invalidate,
    }),
    setBusinessStatus: useMutation({
      mutationFn: ({ id, status }) =>
        api.patch(`/superadmin/businesses/${id}/status`, { status }),
      onSuccess: invalidate,
    }),
    /** Soft - the slot stays spent through the retention window. */
    deleteBusiness: useMutation({
      mutationFn: ({ id }) => api.delete(`/superadmin/businesses/${id}`),
      onSuccess: invalidate,
    }),
    restoreBusiness: useMutation({
      mutationFn: ({ id }) => api.post(`/superadmin/businesses/${id}/restore`, {}),
      onSuccess: invalidate,
    }),

    /**
     * Step into a business.
     *
     * **The whole React Query cache is cleared on success**, not merely the
     * console's namespace. The next screen is the tenant's admin panel reading
     * through `['admin']` keys, and anything already cached there was fetched
     * as somebody else - a stale list rendered for one frame under a support
     * session is exactly the confusion the banner exists to prevent.
     */
    enterBusiness: useMutation({
      mutationFn: ({ id, ...body }) =>
        api.post(`/superadmin/businesses/${id}/impersonate`, body),
      onSuccess: () => queryClient.clear(),
    }),

    /** Leave. Clears for the same reason entering does, in the other direction. */
    leaveBusiness: useMutation({
      mutationFn: () => api.post('/superadmin/impersonation/leave', {}),
      onSuccess: () => queryClient.clear(),
    }),

    revokeImpersonation: useMutation({
      mutationFn: ({ id }) => api.post(`/superadmin/impersonation/${id}/revoke`, {}),
      onSuccess: invalidate,
    }),

    replyToThread: useMutation({
      mutationFn: ({ id, ...body }) => api.post(`/superadmin/support/${id}/reply`, body),
      onSuccess: invalidate,
    }),
    resolveThread: useMutation({
      mutationFn: ({ id }) => api.post(`/superadmin/support/${id}/resolve`, {}),
      onSuccess: invalidate,
    }),

    /** The tenant's own administrator. Sets no password - they are invited. */
    createOwner: useMutation({
      mutationFn: ({ id, ...body }) => api.post(`/superadmin/tenants/${id}/owner`, body),
      onSuccess: invalidate,
    }),
    resendOwnerInvite: useMutation({
      mutationFn: ({ id }) => api.post(`/superadmin/owners/${id}/invite`, {}),
    }),
  };
}
