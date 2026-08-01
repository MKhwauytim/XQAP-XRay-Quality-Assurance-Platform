/**
 * App-wide "refresh workspace data" signal — mirrors the
 * `xray-user-management-change` pattern in `auth/userManagement.ts`, but for
 * everything else that reads workspace disk state (samples, distribution,
 * referrals/replacements/reopens, notifications, answers, ...).
 *
 * Broadcast by the manual refresh button (AdminToolbar) and the 5-minute
 * auto-refresh timer (AuthGate); any view that loads workspace data on mount
 * can subscribe to re-run its own load function when this fires, so an
 * action taken by another user/tab/machine (a reassigned sample, a posted
 * notification, an approved referral) shows up without a full page reload.
 *
 * This only broadcasts a "go re-read your data" signal within the current
 * tab — it does not itself read or write anything on disk.
 */

const DATA_REFRESH_EVENT_NAME = "xray-data-refresh";

export function broadcastDataRefresh(): void {
  window.dispatchEvent(new Event(DATA_REFRESH_EVENT_NAME));
}

export function subscribeToDataRefresh(callback: () => void): () => void {
  window.addEventListener(DATA_REFRESH_EVENT_NAME, callback);
  return () => {
    window.removeEventListener(DATA_REFRESH_EVENT_NAME, callback);
  };
}
