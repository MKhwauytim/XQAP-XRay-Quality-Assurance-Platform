import { useContext } from "react";

import {
  FeedbackUnreadContext,
  type FeedbackUnreadContextValue,
} from "./FeedbackUnreadContext";

/**
 * Unread-feedback state, shared by the two triggers that can open the widget:
 * the floating button (FeedbackWidget) and the admin toolbar's icon.
 *
 * Deliberately NOT a throwing `useContext` guard like `useWorkspace`: both
 * consumers are ordinary UI that must still render outside the provider (unit
 * tests mount them standalone, and a missing provider must never blank the
 * toolbar over a notification dot). Without a provider there is simply nothing
 * unread and nothing to mark.
 */
const INERT: FeedbackUnreadContextValue = {
  unreadCount: 0,
  messages: [],
  markSeen: () => {},
  reload: async () => {},
};

export function useFeedbackUnread(): FeedbackUnreadContextValue {
  return useContext(FeedbackUnreadContext) ?? INERT;
}
