import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/hooks/useAuth';
import './styles/index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30 * 1000,
    },
  },
});

/**
 * Which application this host is, before the router decides anything.
 *
 * In production the server writes it into the page (`utils/surface.js`), and
 * this does nothing. In development Vite serves the page and writes no tags, so
 * the server is asked once and the tags are written here - which is what makes
 * `app.localhost:5173`, `admin.localhost:5173` and `cellshoppe.localhost:5173`
 * behave the way their production hosts do. A failure leaves no tags, which is
 * the old every-route behaviour: never worse than before.
 */
async function learnSurface() {
  if (!import.meta.env.DEV || document.querySelector('meta[name="app-surface"]')) return;
  try {
    const response = await fetch('/api/dev/surface');
    if (!response.ok) return;
    const { surface, panelHost, superAdminHost, panelBusiness } = await response.json();
    const tags = {
      'app-surface': surface,
      'app-panel-host': panelHost,
      'app-superadmin-host': superAdminHost,
      'app-panel-business': panelBusiness,
    };
    for (const [name, content] of Object.entries(tags)) {
      if (!content) continue;
      const meta = document.createElement('meta');
      meta.name = name;
      meta.content = content;
      document.head.appendChild(meta);
    }
  } catch {
    // The API not answering yet is ordinary in development; carry on without.
  }
}

async function start() {
  await learnSurface();
  // Imported only now: `lib/surface.js` reads the tags once, when it loads, and
  // the app pulls it in - so it must not load before they are written.
  const { default: App } = await import('./App');

  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
}

start();
