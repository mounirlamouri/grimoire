import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AddonMetadata } from "../types/addon";

/**
 * Hook that lazily fetches addon metadata when UIDs are requested.
 * Caches results in-memory; the backend handles SQLite caching and
 * staleness checks against UIDate.
 */
export function useAddonMetadata() {
  const [metadataMap, setMetadataMap] = useState<Map<string, AddonMetadata>>(new Map());
  const [loadingUids, setLoadingUids] = useState<Set<string>>(new Set());
  const pendingRef = useRef<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    const uids = [...pendingRef.current];
    pendingRef.current.clear();
    if (uids.length === 0) return;

    setLoadingUids((prev) => {
      const next = new Set(prev);
      uids.forEach((u) => next.add(u));
      return next;
    });

    try {
      const result = await invoke<Record<string, AddonMetadata>>(
        "fetch_addon_metadata",
        { uids }
      );
      setMetadataMap((prev) => {
        const next = new Map(prev);
        for (const [uid, meta] of Object.entries(result)) {
          next.set(uid, meta);
        }
        return next;
      });
    } catch (err) {
      console.warn("Failed to fetch addon metadata:", err);
    } finally {
      setLoadingUids((prev) => {
        const next = new Set(prev);
        uids.forEach((u) => next.delete(u));
        return next;
      });
    }
  }, []);

  const fetchMetadata = useCallback(
    (uid: string) => {
      // Already cached in-memory or already pending
      if (metadataMap.has(uid) || pendingRef.current.has(uid)) return;
      pendingRef.current.add(uid);

      // Debounce: batch requests within 100ms
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, 100);
    },
    [metadataMap, flush]
  );

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { metadataMap, loadingUids, fetchMetadata };
}
