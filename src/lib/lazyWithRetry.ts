import { lazy, type ComponentType } from "react";

/**
 * Route chunks are content-hashed. After a redeploy, a browser that still has
 * the old index.html will ask for a chunk filename that no longer exists and
 * the dynamic import rejects with "Failed to fetch dynamically imported
 * module" — which renders a blank screen.
 *
 * Strategy: retry once (covers a transient network blip), then do a one-shot
 * hard reload to pick up the fresh index.html. The sessionStorage guard makes
 * sure we can never end up in a reload loop if the chunk is genuinely broken.
 */
const RELOAD_KEY = "chunk-reload:";

export function retryImport<T>(
  factory: () => Promise<T>,
  key: string,
): Promise<T> {
  return factory().catch(async (err) => {
    try {
      return await factory();
    } catch {
      const flag = RELOAD_KEY + key;
      const alreadyReloaded =
        typeof sessionStorage !== "undefined" && sessionStorage.getItem(flag);
      if (!alreadyReloaded && typeof window !== "undefined") {
        try {
          sessionStorage.setItem(flag, "1");
        } catch {
          /* storage may be unavailable */
        }
        window.location.reload();
        // Never resolves; the page is going away.
        return new Promise<T>(() => {});
      }
      throw err;
    }
  });
}

export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
  key: string,
) {
  return lazy(() => retryImport(factory, key));
}

/** Clear the reload guards once the app has successfully booted a route. */
export function clearChunkReloadGuards() {
  try {
    if (typeof sessionStorage === "undefined") return;
    Object.keys(sessionStorage)
      .filter((k) => k.startsWith(RELOAD_KEY))
      .forEach((k) => sessionStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}
