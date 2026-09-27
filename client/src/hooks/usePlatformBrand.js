import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';

const KEY = ['platform', 'brand'];

/**
 * Kelinto's own logo and favicon (`GET /platform/brand`), as set in the
 * console. Empty strings mean the built-in wordmark and the placeholder icon.
 */
export function usePlatformBrand() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => api.get('/platform/brand'),
    staleTime: 10 * 60 * 1000,
  });
}

/** The console's writes: upload a file to R2, then point the brand at it. */
export function usePlatformBrandMutations() {
  const queryClient = useQueryClient();
  const upload = useMutation({
    mutationFn: ({ file, kind }) => api.upload('/superadmin/assets', file, { kind }),
  });
  const save = useMutation({
    mutationFn: (patch) => api.patch('/superadmin/brand', patch),
    onSuccess: (brand) => queryClient.setQueryData(KEY, brand),
  });
  return { upload, save };
}

export default usePlatformBrand;
