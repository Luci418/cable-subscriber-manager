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
  const flag = RELOAD_KEY + key;
  const clear = () => {
    try {
      sessionStorage?.removeItem(flag);
    } catch {
      /* ignore */
    }
  };
  return factory().then(
    (mod) => {
      // This chunk loaded fine, so its one-shot reload budget is restored.
      clear();
      return mod;
    },
    async (err) => {
      try {
        const mod = await factory();
        clear();
        return mod;
      } catch {
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
    },
  );
}

export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
  key: string,
) {
  return lazy(() => retryImport(factory, key));
}

/**
 * Deprecated: guards are now cleared per-chunk on a successful import. Clearing
 * everything at boot defeated the one-shot protection, because the boot caused
 * by the reload wiped the flag before the failing chunk was retried.
 */
export function clearChunkReloadGuards() {
  /* no-op */
}
