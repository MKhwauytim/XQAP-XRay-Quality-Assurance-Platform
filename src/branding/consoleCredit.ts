import { getLabels } from "../data/labels/labelsStore";
import { ORGANIZATION_PATH_TEXT } from "./organization";

const DEVELOPER_NAME = "Mkhuwaytim";

/**
 * One-time styled banner written to the browser console on app start, so
 * anyone opening DevTools (F12) sees the app identity, owning department,
 * version, and developer credit rather than a blank console.
 */
export function printConsoleCredit(): void {
  const labels = getLabels();
  console.log(
    `%c${labels.app_display_name}%c\n${ORGANIZATION_PATH_TEXT}\nDeveloper: ${DEVELOPER_NAME}\nv${__APP_VERSION__}`,
    "font-weight: bold; font-size: 14px;",
    "font-weight: normal;",
  );
}
