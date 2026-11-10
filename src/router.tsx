import { QueryClient, focusManager } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

const STALE_TIME_MS = 5 * 60_000;
const CACHE_RETENTION_MS = 30 * 60_000;
const FOCUS_COALESCE_MS = 250;

// TanStack Query already deduplicates identical in-flight queries. Browser focus
// and visibility can arrive together after leaving the app or unlocking a phone.
// Publish ONE focus transition, not one per browser event.
// Only stale queries refetch; a quick return reuses the existing cache.
if (typeof window !== "undefined") {
  focusManager.setEventListener((notify) => {
    let pending: number | null = null;

    const clearPending = () => {
      if (pending !== null) {
        window.clearTimeout(pending);
        pending = null;
      }
    };

    const resume = () => {
      if (document.visibilityState !== "visible") return;
      clearPending();
      pending = window.setTimeout(() => {
        pending = null;
        if (document.visibilityState === "visible") {
          notify(true);
        }
      }, FOCUS_COALESCE_MS);
    };

    const pause = () => {
      clearPending();
      notify(false);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") pause();
      else resume();
    };

    window.addEventListener("blur", pause);
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      clearPending();
      window.removeEventListener("blur", pause);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  });
}

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: STALE_TIME_MS,
        gcTime: typeof window === "undefined" ? Infinity : CACHE_RETENTION_MS,
        retry: 1,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
