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

export function usePreownedMutations() {
  const queryClient = useQueryClient();
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'buybacks'] });
    // Accepting one adds stock to a phone product, so Inventory and the website move too.
    queryClient.invalidateQueries({ queryKey: ['admin', 'inventory'] });
    queryClient.invalidateQueries({ queryKey: ['admin', 'stats'] });
    queryClient.invalidateQueries({ queryKey: ['catalog'] });
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
  };
}


/** "Phones you sold us", on the customer's account. */
export function useMyBuybacks() {
  return useQuery({
    queryKey: ['account', 'buybacks'],
    queryFn: () => api.get('/account/buybacks'),
  });
}
