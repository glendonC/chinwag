const refreshSubscribers = new Set();

/** When true, WebSocket is connected and will deliver deltas — skip HTTP refresh. */
let wsConnected = false;

export function addRefreshHandler(handler) {
  refreshSubscribers.add(handler);
  return () => refreshSubscribers.delete(handler);
}

// Legacy single-handler API — delegates to subscriber set
export function setRefreshHandler(handler) {
  refreshSubscribers.add(handler);
}

export function requestRefresh() {
  if (wsConnected) return; // WS will deliver the delta — no need to HTTP poll
  for (const handler of refreshSubscribers) {
    handler();
  }
}

/** Called by the WebSocket module to signal connection state changes. */
export function setWsConnected(connected) {
  wsConnected = connected;
}
