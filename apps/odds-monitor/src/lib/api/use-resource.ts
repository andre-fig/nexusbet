import { useEffect, useState, useRef } from "react";
export interface Resource<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}
/** Cancels superseded filters and prevents late responses from replacing the current view. */
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
    error: null,
  });
  useEffect(() => {
    if (!enabled) {
      set({ data: null, loading: false, error: null });
      return;
    }
    const controller = new AbortController();
    const same = prior.current === identity;
    prior.current = identity;
    set((old) => ({
      data: same ? old.data : null,
      loading: true,
      error: null,
    }));
    load(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted)
          set({ data, loading: false, error: null });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          set((old) => ({
            ...old,
            loading: false,
            error: error instanceof Error ? error.message : "Request failed",
          }));
      });
    return () => controller.abort();
  }, [key, enabled]);
  return { ...state, data: identity === prior.current ? state.data : null };
}
