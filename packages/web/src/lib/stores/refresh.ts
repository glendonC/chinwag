type RefreshHandler = () => void;

const refreshSubscribers = new Set<RefreshHandler>();

/** When true, WebSocket is connected and will deliver deltas — skip HTTP refresh. */
let wsConnected = false;

export function addRefreshHandler(handler: RefreshHandler): () => void {
  refreshSubscribers.add(handler);
  return () => refreshSubscribers.delete(handler);
}

// Legacy single-handler API — delegates to subscriber set
export function setRefreshHandler(handler: RefreshHandler): void {
  refreshSubscribers.add(handler);
}

export function requestRefresh(): void {
  if (wsConnected) return; // WS will deliver the delta — no need to HTTP poll
  for (const handler of refreshSubscribers) {
    handler();
  }
}

/** Called by the WebSocket module to signal connection state changes. */
export function setWsConnected(connected: boolean): void {
  wsConnected = connected;
}
