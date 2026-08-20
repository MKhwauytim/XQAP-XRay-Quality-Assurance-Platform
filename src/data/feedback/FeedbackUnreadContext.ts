import { createContext } from "react";

import type { FeedbackMessage } from "./feedbackStorage";

export type FeedbackUnreadContextValue = {
  /** Inbound feedback items this user has not looked at yet. 0 hides the dot. */
  unreadCount: number;
  /** The polled feedback log, so a consumer never has to re-read it to mark seen. */
  messages: FeedbackMessage[];
  /**
   * Mark everything inbound as seen. Pass the caller's own freshly-loaded list
   * when it has one (the widget loads on open); omit it to use the polled copy.
   */
  markSeen: (messages?: readonly FeedbackMessage[]) => void;
  /** Force a re-read (after submitting a message or a reply). */
  reload: () => Promise<void>;
};

export const FeedbackUnreadContext = createContext<FeedbackUnreadContextValue | null>(null);
