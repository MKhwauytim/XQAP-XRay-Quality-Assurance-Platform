import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { FeedbackMessage } from "./feedbackStorage";
import {
  countUnreadFeedback,
  latestInboundTimestamp,
  listInboundActivity,
  markFeedbackSeen,
  readFeedbackSeenAt,
  type FeedbackViewer,
} from "./feedbackUnread";

const ADMIN: FeedbackViewer = { username: "admin", role: "admin" };
const EMP: FeedbackViewer = { username: "emp-1", role: "employee" };
const OTHER_EMP: FeedbackViewer = { username: "emp-2", role: "employee" };

function message(overrides: Partial<FeedbackMessage> & { id: string }): FeedbackMessage {
  return {
    from: "emp-1",
    role: "employee",
    category: "issue",
    text: "…",
    timestamp: "2026-08-19T09:00:00.000Z",
    status: "open",
    replies: [],
    ...overrides,
  };
}

// `localStorage` is not part of the default `node` test environment; the seen
// marker is the only thing here that touches it, so a minimal stub keeps this
// file out of jsdom.
function installStorageStub(): void {
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };
  const listeners = new Set<() => void>();
  Object.assign(globalThis, {
    localStorage: storage,
    window: {
      dispatchEvent: () => {
        for (const listener of listeners) listener();
        return true;
      },
      addEventListener: () => {},
      removeEventListener: () => {},
    },
  });
}

beforeEach(installStorageStub);

afterEach(() => {
  Reflect.deleteProperty(globalThis, "localStorage");
  Reflect.deleteProperty(globalThis, "window");
});

describe("listInboundActivity", () => {
  const messages = [
    message({ id: "a", from: "emp-1", replies: [{ from: "admin", role: "admin", text: "رد", timestamp: "2026-08-19T10:00:00.000Z" }] }),
    message({ id: "b", from: "emp-2", replies: [] }),
  ];

  it("gives a manager every message and reply written by someone else", () => {
    expect(listInboundActivity(messages, { username: "boss", role: "manager" })).toEqual([
      { from: "emp-1", timestamp: "2026-08-19T09:00:00.000Z" },
      { from: "admin", timestamp: "2026-08-19T10:00:00.000Z" },
      { from: "emp-2", timestamp: "2026-08-19T09:00:00.000Z" },
    ]);
  });

  it("never counts the viewer's own message or reply as inbound", () => {
    // admin wrote the reply on "a" and neither message, so only the two
    // messages themselves are inbound for them.
    expect(listInboundActivity(messages, ADMIN).map((a) => a.from)).toEqual(["emp-1", "emp-2"]);
  });

  it("gives a non-manager only the replies on their own threads", () => {
    expect(listInboundActivity(messages, EMP)).toEqual([
      { from: "admin", timestamp: "2026-08-19T10:00:00.000Z" },
    ]);
    // emp-2 authored "b" and it has no replies, so nothing is inbound.
    expect(listInboundActivity(messages, OTHER_EMP)).toEqual([]);
  });
});

describe("countUnreadFeedback", () => {
  const messages = [
    message({
      id: "a",
      from: "emp-1",
      replies: [
        { from: "admin", role: "admin", text: "أول رد", timestamp: "2026-08-19T10:00:00.000Z" },
        { from: "admin", role: "admin", text: "رد ثانٍ", timestamp: "2026-08-19T12:00:00.000Z" },
      ],
    }),
  ];

  it("treats everything inbound as unread when nothing was ever marked seen", () => {
    expect(countUnreadFeedback(messages, EMP, null)).toBe(2);
  });

  it("counts only activity newer than the marker", () => {
    expect(countUnreadFeedback(messages, EMP, "2026-08-19T11:00:00.000Z")).toBe(1);
    expect(countUnreadFeedback(messages, EMP, "2026-08-19T12:00:00.000Z")).toBe(0);
  });

  it("is zero for a user with no inbound activity at all", () => {
    expect(countUnreadFeedback(messages, OTHER_EMP, null)).toBe(0);
  });

  it("ignores an unparsable timestamp rather than reporting it as newer", () => {
    const broken = [message({ id: "z", from: "admin", timestamp: "not-a-date" })];
    expect(countUnreadFeedback(broken, EMP, "2026-08-19T00:00:00.000Z")).toBe(0);
  });
});

describe("markFeedbackSeen", () => {
  const messages = [
    message({
      id: "a",
      from: "emp-1",
      replies: [{ from: "admin", role: "admin", text: "رد", timestamp: "2026-08-19T10:00:00.000Z" }],
    }),
  ];

  it("stores the newest inbound timestamp and clears the count", () => {
    expect(markFeedbackSeen(messages, EMP)).toBe(true);
    expect(readFeedbackSeenAt("emp-1")).toBe("2026-08-19T10:00:00.000Z");
    expect(countUnreadFeedback(messages, EMP, readFeedbackSeenAt("emp-1"))).toBe(0);
  });

  it("marks the list's own newest item, not `now` — a clock-ahead machine must still clear", () => {
    const future = [
      message({ id: "f", from: "admin", timestamp: "2099-01-01T00:00:00.000Z", replies: [] }),
    ];
    markFeedbackSeen(future, EMP);
    expect(countUnreadFeedback(future, EMP, readFeedbackSeenAt("emp-1"))).toBe(0);
  });

  it("never moves the marker backwards from a staler list", () => {
    markFeedbackSeen(messages, EMP);
    const older = [
      message({
        id: "a",
        from: "emp-1",
        replies: [{ from: "admin", role: "admin", text: "رد", timestamp: "2026-08-19T08:00:00.000Z" }],
      }),
    ];
    expect(markFeedbackSeen(older, EMP)).toBe(false);
    expect(readFeedbackSeenAt("emp-1")).toBe("2026-08-19T10:00:00.000Z");
  });

  it("writes nothing when there is no inbound activity", () => {
    expect(markFeedbackSeen(messages, OTHER_EMP)).toBe(false);
    expect(readFeedbackSeenAt("emp-2")).toBeNull();
  });

  it("keys the marker per user", () => {
    markFeedbackSeen(messages, EMP);
    expect(readFeedbackSeenAt("someone-else")).toBeNull();
  });
});

describe("latestInboundTimestamp", () => {
  it("returns null when nothing is inbound", () => {
    expect(latestInboundTimestamp([], ADMIN)).toBeNull();
  });
});
