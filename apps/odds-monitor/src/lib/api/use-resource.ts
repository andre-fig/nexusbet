import { useEffect, useState, useRef } from "react";
export interface Resource<T> {
  data: T | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
}
/**
 * Cancels superseded requests and keeps the current identity mounted while an
 * SSE/manual refresh is in flight. A changed identity (filter/event/selection)
 * still gets a normal initial loading state and cannot display stale data.
 */
export function useResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
  key: string,
  enabled = true,
  identity = key,
): Resource<T> {
  const prior = useRef(identity);
  const [state, set] = useState<Resource<T>>({
    data: null,
    loading: enabled,
    refreshing: false,
    error: null,
  });
  useEffect(() => {
    if (!enabled) {
      set({ data: null, loading: false, refreshing: false, error: null });
      return;
    }
    const controller = new AbortController();
    const same = prior.current === identity;
    prior.current = identity;
    set((old) => {
      const background = same && old.data !== null;
      return {
        data: background ? old.data : null,
        loading: !background,
        refreshing: background,
        error: null,
      };
    });
    load(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted)
          set({ data, loading: false, refreshing: false, error: null });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          set((old) => ({
            ...old,
            loading: false,
            refreshing: false,
            error: error instanceof Error ? error.message : "Request failed",
          }));
      });
    return () => controller.abort();
  }, [key, enabled]);
  if (identity !== prior.current)
    return {
      data: null,
      loading: enabled,
      refreshing: false,
      error: null,
    };
  return state;
}
