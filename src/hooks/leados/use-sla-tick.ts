"use client";

// Shared SLA tick — ONE timer for the whole app, never one per row.
// Components subscribe via useSlaTick() and re-render on each tick so
// elapsed time stays live without refetching, and with cleanup on unmount.

import { useSyncExternalStore } from "react";

const TICK_MS = 60_000;

let tick = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function start() {
  if (timer) return;
  timer = setInterval(() => {
    tick = Date.now();
    listeners.forEach((l) => l());
  }, TICK_MS);
}

function stop() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  start();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stop();
  };
}

function getSnapshot() {
  return tick;
}

/** Re-renders the caller once per minute (shared singleton timer). */
export function useSlaTick(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
