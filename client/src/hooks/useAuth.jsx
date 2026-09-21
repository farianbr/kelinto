import { createContext, useCallback, useContext, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import useUiStore from '@/store/uiStore';
import { setBusiness } from '@/store/businessStore';

const AuthContext = createContext(null);

/**
 * Session state. The token itself is an httpOnly cookie the JS never sees
 * `/auth/me` is the only way to learn who is signed in.
 *
 * Three states matter across the whole UI:
 *   guest - prices hidden, "Login to view" gate on every card
 *   pending - signed in, still gated, shown "your account is under review"
 *   approved - full wholesale pricing and ordering
 */
export function AuthProvider({ children }) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['auth', 'me'],
    // `/auth/me` answers 200 with `user: null` for a guest, so there is no 401 to
    // catch here - an error from this call is a real one and should surface.
    queryFn: () => api.get('/auth/me'),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const user = data?.user ?? null;
  // The business's switched-on features, for staff only - `null` for everyone
  // else. A courtesy that shapes the nav; `requireFeature` decides for real.
  const features = data?.features ?? null;

  /**
   * An active platform-support session, or null (SAAS_PLATFORM §4.5).
   *
   * Rides on `/auth/me` so it is available on every screen from first paint
   * the banner has to be able to render anywhere, and the way out of a business
   * must not depend on which page the staff member happens to be standing on.
   */
  const impersonation = data?.impersonation ?? null;

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
    // Pricing is embedded in every product response, so the catalogue has to be
    // refetched whenever the viewer's approval state changes.
    queryClient.invalidateQueries({ queryKey: ['products'] });
    queryClient.invalidateQueries({ queryKey: ['search'] });
    // Combo bundle prices are gated exactly like the catalogue.
    queryClient.invalidateQueries({ queryKey: ['offers'] });
  }, [queryClient]);

  const signIn = useCallback(
    async (credentials) => {
      const result = await api.post('/auth/login', credentials);
      // `features` rides along with the user, or the panel renders once with an
      // empty set - every gated nav row missing until the next `/auth/me`.
      queryClient.setQueryData(['auth', 'me'], {
        user: result.user,
        features: result.features ?? null,
      });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['search'] });
      // Combo bundle prices are gated exactly like the catalogue.
      queryClient.invalidateQueries({ queryKey: ['offers'] });
      return result.user;
    },
    [queryClient],
  );

  const signUp = useCallback((payload) => api.post('/auth/register', payload), []);

  const signOut = useCallback(async () => {
    await api.post('/auth/logout');

    /**
     * The business selection goes with the session that made it.
     *
     * It lives in `localStorage`, so it used to outlive sign-out and every tab
     * on the origin kept sending it. A staff member who signed out of the
     * CellShoppe panel left that id behind in their browser, and the storefront
     * they visited next was served CellShoppe: an empty catalogue, and their own
     * `buyer@` account rejected as a bad credential because `User` is
     * per-business. Clearing it here makes signing out actually leave.
     *
     * Ordered after the request on purpose - `/auth/logout` is a scoped path in
     * development, and clearing first would send it unscoped.
     */
    setBusiness(null);

    queryClient.setQueryData(['auth', 'me'], { user: null, features: null });
    queryClient.invalidateQueries({ queryKey: ['products'] });
    queryClient.invalidateQueries({ queryKey: ['search'] });
    // Combo bundle prices are gated exactly like the catalogue.
    queryClient.invalidateQueries({ queryKey: ['offers'] });
  }, [queryClient]);

  const value = useMemo(
    () => ({
      user,
      isLoading,
      isAuthenticated: Boolean(user),
      isApproved: user?.status === 'approved',
      isPending: user?.status === 'pending',
      isAdmin: user?.role === 'admin',
      // Panel access. An admin always has it; a staff member has it only once
      // an administrator has granted a role - access is granted, never
      // inherited (§7.6). The server decides for real; this only shapes the UI.
      isStaff: user?.role === 'staff',
      // A support session reaches the panel with no `user` at all - the grant
      // is the authorisation, exactly as it is server-side in `requireStaff`.
      // Without this the staff member would enter a business and land on a sign-in
      // screen, holding a valid grant the client refused to believe in.
      canUseAdmin:
        Boolean(impersonation) ||
        user?.role === 'admin' ||
        (user?.role === 'staff' && Boolean(user?.staffRole)),
      // Area permissions, or null for an admin - who bypasses the map entirely.
      permissions: user?.permissions ?? null,
      // What this BUSINESS has switched on, which is a different question from
      // what this ACCOUNT may do with it (SAAS_PLATFORM §4.4).
      features,
      // Null for everybody but a platform operator inside a support session.
      impersonation,
      isImpersonating: Boolean(impersonation),
      signIn,
      signUp,
      signOut,
      refresh,
    }),
    [user, features, impersonation, isLoading, signIn, signUp, signOut, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Asks before signing out.
 *
 * Sign out used to fire on the click. It is one press, it is easy to hit by
 * mistake next to the account links it sits among, and undoing it means finding
 * the credentials again - on a shared workshop machine, often someone else's.
 * The cart survives, but the session and anything half-filled on the page do
 * not, so it gets the same confirmation as any other action that cannot be
 * taken back.
 *
 * The dialog is raised through the UI store and rendered ONCE at the app root
 * (`SignOutConfirm`), rather than at each of the four buttons - a confirmation
 * every call site has to remember is one that a fifth button will forget.
 *
 * Returns the same zero-argument function the call sites already pass straight
 * to `onClick`, so none of them change.
 */
export function useSignOut() {
  const askSignOut = useUiStore((s) => s.askSignOut);
  return askSignOut;
}

/**
 * The sign-out that actually runs, once confirmed. Only `SignOutConfirm` calls
 * this.
 *
 * Signing out from inside /account or /admin would otherwise leave the viewer
 * staring at that area's own access wall, so it always drops back to the shop.
 */
export function useConfirmedSignOut() {
  const { signOut } = useAuth();
  const navigate = useNavigate();

  return useCallback(async () => {
    await signOut();
    navigate('/');
  }, [signOut, navigate]);
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}

export default useAuth;
