import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

/**
 * Blog, FAQ and offers.
 *
 * All three are editorial: they change a few times a week at most, so they carry
 * a long `staleTime` and never refetch on focus. The offers query is the one
 * exception that matters - it is keyed on whether the viewer can see pricing, so
 * signing in swaps a gated bundle price for a real one without a manual refetch.
 */

const FIVE_MINUTES = 5 * 60 * 1000;

export function useBlogPosts(params = {}) {
  return useQuery({
    queryKey: ['blog', params],
    queryFn: () => api.get('/blog', params),
    staleTime: FIVE_MINUTES,
    placeholderData: (previous) => previous,
  });
}

export function useBlogPost(slug) {
  return useQuery({
    queryKey: ['blog', 'post', slug],
    queryFn: () => api.get(`/blog/${slug}`),
    enabled: Boolean(slug),
    staleTime: FIVE_MINUTES,
    retry: false,
  });
}

export function useFaqs(params = {}) {
  return useQuery({
    queryKey: ['faq', params],
    queryFn: () => api.get('/faq', params),
    staleTime: FIVE_MINUTES,
  });
}

export function useOffers(priceVisible = false) {
  return useQuery({
    // Pricing is part of the key: the same URL returns a gated payload to a
    // guest and a priced one to an approved buyer.
    queryKey: ['offers', { priceVisible }],
    queryFn: () => api.get('/offers'),
    staleTime: FIVE_MINUTES,
  });
}

/**
 * The live exclusive deal, or null. `/offers` answers grouped, so all three
 * buckets are searched - the same lookup the desktop Offers menu does.
 */
export function findExclusive(data) {
  return (
    [...(data?.featured ? [data.featured] : []), ...(data?.deals ?? []), ...(data?.combos ?? [])].find(
      (offer) => offer.isExclusive,
    ) ?? null
  );
}

/**
 * The website's service price list (Shop › Services). Keyed on pricing like
 * the offers above: the same URL answers with or without prices. `retry: false`
 * because a 404 means the business does not offer services, not a blip.
 */
export function usePublicServices(priceVisible = false) {
  return useQuery({
    queryKey: ['services', { priceVisible }],
    queryFn: () => api.get('/services'),
    staleTime: FIVE_MINUTES,
    retry: false,
  });
}

/** The membership tiers and the warranty each carries. */
export function useMembership() {
  return useQuery({
    queryKey: ['membership'],
    queryFn: () => api.get('/membership'),
    staleTime: FIVE_MINUTES,
  });
}

/**
 * The sections at the foot of one website page: which it shows, and that page's
 * published article and questions (`shared/websitePages.js`). `retry: false`
 * because a 404 is a page not in the registry, not a blip.
 */
export function usePageSections(page) {
  return useQuery({
    queryKey: ['page-sections', page],
    queryFn: () => api.get(`/pages/${page}`),
    enabled: Boolean(page),
    staleTime: FIVE_MINUTES,
    retry: false,
  });
}

/** The business's Google reviews and the rating above them. One list for every page. */
export function useGoogleReviews(enabled = true) {
  return useQuery({
    queryKey: ['google-reviews'],
    queryFn: () => api.get('/google-reviews'),
    enabled,
    staleTime: FIVE_MINUTES,
  });
}
