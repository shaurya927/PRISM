// Counts in-flight user actions (uploads, rescoring, searches) so the app can show its activity bar.
// Job polling is not tracked, otherwise the bar would flicker every 800 ms.
import { useEffect, useState } from "react";

let pending = 0;
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn(pending > 0));

export function tracked(promise) {
  pending += 1;
  emit();
  return promise.finally(() => {
    pending -= 1;
    emit();
  });
}

export function useNetActive() {
  const [active, setActive] = useState(pending > 0);
  useEffect(() => {
    listeners.add(setActive);
    return () => listeners.delete(setActive);
  }, []);
  return active;
}
