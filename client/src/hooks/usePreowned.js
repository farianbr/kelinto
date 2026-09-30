import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import api from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';

/**
 * Pre-owned phones: bought from customers at the kiosk, sold on the website.
 *
 * Staff, customer and website hooks in one place because they are three views
 * of the same two records (`Buyback`, `PreownedDevice`), and a write on one side
 * has to refresh the others: pricing a request adds stock, listing stock shows
 * it on the website, and a sale takes it off.
 */

const KEYS = {
  requests: (params) => ['admin', 'buybacks', params],
  request: (id) => ['admin', 'buybacks', 'one', id],
  stock: (params) => ['admin', 'preowned', params],
};

export function useBuybackRequests(params) {
  return useQuery({
    queryKey: KEYS.requests(params),
    queryFn: () => api.get('/admin/buybacks', params),
    placeholderData: (previous) => previous,
  });
}

export function useBuybackRequest(id) {
  return useQuery({
    queryKey: KEYS.request(id),
    queryFn: () => api.get(`/admin/buybacks/${id}`),
    enabled: Boolean(id),
  });
}

export function usePreownedStock(params) {
  return useQuery({
    queryKey: KEYS.stock(params),
    queryFn: () => api.get('/admin/preowned', params),
    placeholderData: (previous) => previous,
  });
}

export function usePreownedMutations() {
  const queryClient = useQueryClient();
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'buybacks'] });
    queryClient.invalidateQueries({ queryKey: ['admin', 'preowned'] });
    // The sidebar badge counts pending requests from the dashboard stats.
    queryClient.invalidateQueries({ queryKey: ['admin', 'stats'] });
    queryClient.invalidateQueries({ queryKey: ['preowned'] });
  };

  return {
    accept: useMutation({
      mutationFn: ({ id, ...body }) => api.post(`/admin/buybacks/${id}/accept`, body),
      onSuccess: refresh,
    }),
    decline: useMutation({
      mutationFn: ({ id, ...body }) => api.post(`/admin/buybacks/${id}/decline`, body),
      onSuccess: refresh,
    }),
    revealId: useMutation({
      mutationFn: (id) => api.post(`/admin/buybacks/${id}/reveal-id`, {}),
    }),
    updateStock: useMutation({
      mutationFn: ({ id, ...body }) => api.patch(`/admin/preowned/${id}`, body),
      onSuccess: refresh,
    }),
  };
}

/** The website's pre-owned page. Keyed on approval, because prices are gated on it. */
export function usePreownedListings() {
  const { user, isApproved } = useAuth();
  return useQuery({
    queryKey: ['preowned', user?.id ?? 'guest', isApproved],
    queryFn: () => api.get('/preowned'),
  });
}

/** "Phones you sold us", on the customer's account. */
export function useMyBuybacks() {
  return useQuery({
    queryKey: ['account', 'buybacks'],
    queryFn: () => api.get('/account/buybacks'),
  });
}
