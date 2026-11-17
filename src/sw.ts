/// <reference lib="webworker" />

import { clientsClaim } from "workbox-core";
import { addPlugins, matchPrecache, precacheAndRoute } from "workbox-precaching";
import type { PrecacheEntry } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { RELOGIN_PARAM } from "../shared/pwa";

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: PrecacheEntry[] };

clientsClaim();
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") event.waitUntil(self.skipWaiting());
});

// Register before the precache route so even an exact /index.html match checks the network.
registerRoute(
  ({ request, url, sameOrigin }) =>
    sameOrigin && request.mode === "navigate" &&
    (url.pathname === "/" || url.pathname === "/index.html"),
  async ({ request, url }) => {
    const response = fetch(request, { cache: "no-store" });
    if (url.searchParams.has(RELOGIN_PARAM)) return response;
    try {
      return await response;
    } catch (error) {
      const offline = await matchPrecache("index.html");
      if (offline) return offline;
      throw error;
    }
  },
);

// A precache install must never store a login page reached by redirect.
addPlugins([{
  requestWillFetch: async ({ request, event }) =>
    event.type === "install" ? new Request(request, { redirect: "error" }) : request,
}]);
precacheAndRoute(self.__WB_MANIFEST, { directoryIndex: "", cleanURLs: false });
