import type { AuthRole } from "../../../../../../auth/authTypes";
import { getLabels } from "../../../../../../data/labels/labelsStore";
import {
  audienceFor,
  hasAccepted,
  notificationTarget,
  type AppNotification,
  type NotificationTarget,
} from "../../../../../../data/notifications/notificationTypes";

export type AudienceUser = { username: string; displayName: string; role: AuthRole };

export const TARGET_ORDER: NotificationTarget[] = ["all", "employees", "supervisors", "custom"];

export function targetLabel(target: NotificationTarget): string {
  const L = getLabels();
  switch (target) {
    case "employees": return L.notif_target_employees;
    case "supervisors": return L.notif_target_supervisors;
    case "custom": return L.notif_target_custom;
    case "all": return L.notif_target_all;
  }
}

export function roleLabel(role: AuthRole): string {
  const L = getLabels();
  return role === "supervisor" ? L.notif_role_supervisor : L.notif_role_employee;
}

/** Everyone a not-yet-posted notification would reach, given the composer state. */
export function previewAudience(
  target: NotificationTarget,
  picked: readonly string[],
  users: readonly AudienceUser[]
): AudienceUser[] {
  return audienceFor({ target, audience: [...picked] } as AppNotification, users);
}

export type AckStats = {
  target: NotificationTarget;
  roster: (AudienceUser & { accepted: boolean })[];
  accepted: number;
  total: number;
  /** 0–100, rounded. 100 when nobody is targeted, so an empty roster never reads as "0% acknowledged". */
  percent: number;
  complete: boolean;
};

export function ackStats(notification: AppNotification, users: readonly AudienceUser[]): AckStats {
  const target = notificationTarget(notification);
  const roster = audienceFor(notification, users).map((user) => ({
    ...user,
    accepted: hasAccepted(notification, user.username),
  }));
  const accepted = roster.filter((user) => user.accepted).length;
  const total = roster.length;
  return {
    target,
    roster,
    accepted,
    total,
    percent: total === 0 ? 100 : Math.round((accepted / total) * 100),
    complete: accepted >= total,
  };
}

/** Local, Latin-numeral date-time (the app forces Latin numerals everywhere). */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Free-text match over the notification body and the poster's name. */
export function matchesSearch(notification: AppNotification, term: string): boolean {
  const needle = term.trim().toLowerCase();
  if (!needle) return true;
  return (
    notification.message.toLowerCase().includes(needle) ||
    notification.postedBy.toLowerCase().includes(needle)
  );
}
