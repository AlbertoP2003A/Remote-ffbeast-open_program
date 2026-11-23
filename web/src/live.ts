import { useSyncExternalStore } from "react";
import type { LiveState } from "./types";

/**
 * Estado en vivo fuera de React: llega a 20 Hz y no debe re-renderizar la app
 * entera. Solo los componentes que llaman a useLiveState se suscriben.
 */
let snapshot: LiveState | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function publishLive(next: LiveState | null): void {
  snapshot = next;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): LiveState | null {
  return snapshot;
}

function getServerSnapshot(): null {
  return null;
}

export function useLiveState(): LiveState | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
