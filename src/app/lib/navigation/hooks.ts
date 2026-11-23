import { useLocation, useMatches, useRouter as useTanStackRouter, type AnyRouter } from "@tanstack/react-router";
import { useMemo } from "react";

/** Navigates to a full path with its query and hash, inside the app. */
export function navigateTo(router: AnyRouter, href: string, options: { replace?: boolean; resetScroll?: boolean } = {}) {
  return router.navigate({ href, ...options } as Parameters<AnyRouter["navigate"]>[0]);
}

/** Loads a path's route data ahead of a navigation. */
export function preloadPath(router: AnyRouter, href: string) {
  return router.preloadRoute({ href } as Parameters<AnyRouter["preloadRoute"]>[0]);
}

/** Navigation the app's components use: push, replace, refresh (reloads the route's data), back, prefetch. */
export function useRouter() {
  const router = useTanStackRouter();
  return useMemo(
    () => ({
      push: (href: string, options?: { scroll?: boolean }) => void navigateTo(router, href, { resetScroll: options?.scroll ?? true }),
      replace: (href: string, options?: { scroll?: boolean }) =>
        void navigateTo(router, href, { replace: true, resetScroll: options?.scroll ?? true }),
      /** Loads the current route's data again on the server, as a page load would. */
      refresh: () => void router.invalidate(),
      back: () => router.history.back(),
      prefetch: (href: string) => void preloadPath(router, href).catch(() => undefined),
    }),
    [router]
  );
}

/** The current URL's query, read-only. */
export function useSearchParams(): URLSearchParams {
  const searchStr = useLocation({ select: (location) => location.searchStr });
  return useMemo(() => new URLSearchParams(searchStr), [searchStr]);
}

/** The current path. Components use usePublicPathname from @/components/game-mode/use-public-pathname. */
export function usePathname(): string {
  return useLocation({ select: (location) => location.pathname });
}

/** The current route's path parameters. */
export function useParams<T extends Record<string, string>>(): T {
  return (useMatches().at(-1)?.params ?? {}) as T;
}
