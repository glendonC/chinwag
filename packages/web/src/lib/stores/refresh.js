let refreshHandler = null;

export function setRefreshHandler(handler) {
  refreshHandler = handler;
}

export function requestRefresh() {
  refreshHandler?.();
}
