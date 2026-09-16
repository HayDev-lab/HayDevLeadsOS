"use client";

import { useEffect, useState, useCallback } from "react";

export interface HashRoute {
  view: string;
  params: Record<string, string>;
}

function parse(hash: string): HashRoute {
  const clean = hash.replace(/^#\/?/, "");
  if (!clean) return { view: "dashboard", params: {} };
  const [path, query] = clean.split("?");
  const segs = path.split("/").filter(Boolean);
  const view = segs[0] ?? "dashboard";
  const params: Record<string, string> = {};
  if (query) {
    for (const part of query.split("&")) {
      const [k, v] = part.split("=");
      if (k) params[decodeURIComponent(k)] = decodeURIComponent(v ?? "");
    }
  }
  // for `#lead/<id>` style, put id into params.id
  if (segs.length > 1) params.id = segs[1];
  return { view, params };
}

export function useHashRoute(): [HashRoute, (v: string, params?: Record<string, string>) => void] {
  const [route, setRoute] = useState<HashRoute>(() => parse(typeof window !== "undefined" ? window.location.hash : ""));

  useEffect(() => {
    const onHash = () => setRoute(parse(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const navigate = useCallback((view: string, params?: Record<string, string>) => {
    let hash = `#/${view}`;
    if (params?.id) hash = `#/${view}/${params.id}`;
    const qs = Object.entries(params ?? {})
      .filter(([k]) => k !== "id")
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");
    if (qs) hash += `?${qs}`;
    if (typeof window !== "undefined") {
      window.location.hash = hash;
    }
  }, []);

  return [route, navigate];
}
