import { expect, test } from "@playwright/test";
import { gotoSim, openTab, sidebar, workspace } from "./helpers/app";
import { ROLE_ACCOUNTS, SEED_MONTH_LABEL } from "./helpers/seed";

/**
 * Boot, auto-sign-in, and the role → tab gating the whole app hangs off.
 *
 * The tab sets below are the SHIPPED permission defaults
 * (`createDefaultPermissions()` in `src/auth/userManagement.ts`) evaluated
 * against each role's ceiling in `src/auth/tabCatalog.ts` — not a wish list.
 * A change to either that is not reflected here is exactly the regression this
 * file exists to catch.
 */

test.describe("boot & auth", () => {
  test("mounts the simulated workspace and lands in the app shell", async ({ page }) => {
    await gotoSim(page, "admin");

    await expect(page.locator(".app-shell")).toBeVisible();
    await expect(sidebar(page).getByText("نظام جودة الأشعة")).toBeVisible();
    await expect(sidebar(page).getByRole("combobox", { name: "الشهر" })).toHaveValue(/.+/);
    await expect(
      sidebar(page).getByRole("combobox", { name: "الشهر" }).getByRole("option", { name: SEED_MONTH_LABEL }),
    ).toBeAttached();
  });

  test("signs in as the bootstrap admin by default", async ({ page }) => {
    await gotoSim(page, "admin");

    await expect(sidebar(page).getByText(ROLE_ACCOUNTS.admin.username, { exact: true })).toBeVisible();
    await expect(sidebar(page).getByRole("button", { name: "تسجيل الخروج" })).toBeVisible();
    // Only a real admin gets the role-preview switch.
    await expect(page.getByRole("group", { name: "معاينة الأدوار" })).toBeVisible();
  });

  for (const [role, account] of Object.entries(ROLE_ACCOUNTS)) {
    test(`?role=${role} signs in as ${account.username}`, async ({ page }) => {
      await gotoSim(page, role as keyof typeof ROLE_ACCOUNTS);
      await expect(sidebar(page).getByText(account.displayName, { exact: true })).toBeVisible();
    });
  }

  test("role preview is offered to admin only", async ({ page }) => {
    await gotoSim(page, "manager");
    await expect(page.getByRole("group", { name: "معاينة الأدوار" })).toHaveCount(0);
  });
});

test.describe("permission-gated tabs", () => {
  /**
   * TOP-LEVEL tabs only. Sub-tabs are asserted separately below, because the
   * rail auto-expands whichever parent the role lands on — folding both into
   * one count would make this test depend on the landing tab as well as on the
   * permission matrix.
   */
  const TOP_LEVEL: Record<string, string[]> = {
    guest: [],
    employee: ["إدارة مساحة العمل"],
    supervisor: ["إدارة مساحة العمل"],
    manager: ["إدارة بيانات الأشعة", "إدارة مساحة العمل", "مركز الإشعارات", "إدارة التقارير"],
    admin: [
      "إدارة بيانات الأشعة",
      "إدارة مساحة العمل",
      "مركز الإشعارات",
      "إدارة التقارير",
      "إدارة الأرشيف",
      "إدارة المستخدمين",
      "إدارة الإعدادات",
    ],
  };

  const SUB_TABS: Record<string, Record<string, string[]>> = {
    employee: { "إدارة مساحة العمل": ["صور الأشعة المحالة"] },
    supervisor: {
      "إدارة مساحة العمل": ["صور الأشعة المحالة", "نتائج فحص الأشعة", "اعتماد الطلبات"],
    },
    manager: {
      "إدارة بيانات الأشعة": ["معالجة البيانات", "استعراض البيانات"],
      "إدارة التقارير": ["التقارير", "مؤشرات الأداء", "مصمم التقارير"],
    },
    admin: {
      "إدارة بيانات الأشعة": ["معالجة البيانات", "استعراض البيانات", "ارفاق حالات استثنائية"],
      "إدارة المستخدمين": [
        "المستخدمون",
        "صلاحيات الصفحات",
        "صلاحيات الميزات",
        "متابعة الأنشطة",
        "سجل الإجراءات",
      ],
    },
  };

  for (const [role, expected] of Object.entries(TOP_LEVEL)) {
    test(`${role} sees exactly its granted top-level tabs`, async ({ page }) => {
      await gotoSim(page, role as "admin");
      const nav = page.getByRole("navigation", { name: "تبويبات النظام" });
      // Sub-tabs live inside a `role="group"` under their parent; everything
      // else in the rail is a top-level tab. Subtracting the two counts keeps
      // this a pure role query.
      await expect(async () => {
        const all = await nav.getByRole("button").count();
        const nested = await nav.getByRole("group").getByRole("button").count();
        expect(all - nested).toBe(expected.length);
      }).toPass();
      for (const name of expected) {
        await expect(nav.getByRole("button", { name, exact: true })).toBeVisible();
      }
    });
  }

  for (const [role, groups] of Object.entries(SUB_TABS)) {
    test(`${role} sees exactly its granted sub-tabs`, async ({ page }) => {
      await gotoSim(page, role as "admin");
      const nav = page.getByRole("navigation", { name: "تبويبات النظام" });
      for (const [parent, children] of Object.entries(groups)) {
        await openTab(page, parent);
        const group = nav.getByRole("group").filter({ has: page.getByRole("button", { name: children[0], exact: true }) });
        await expect(group.getByRole("button")).toHaveCount(children.length);
        for (const child of children) {
          await expect(group.getByRole("button", { name: child, exact: true })).toBeVisible();
        }
      }
    });
  }

  test("a role with no granted page gets the explicit empty state, not a blank screen", async ({ page }) => {
    await gotoSim(page, "guest");
    await expect(workspace(page).getByRole("heading", { name: "لا توجد تبويبات متاحة" })).toBeVisible();
    await expect(workspace(page).getByText("guest", { exact: true })).toBeVisible();
  });

  test("admin cannot reach a tab an employee never sees, and vice versa", async ({ page }) => {
    await gotoSim(page, "employee");
    const nav = page.getByRole("navigation", { name: "تبويبات النظام" });
    await expect(nav.getByRole("button", { name: "إدارة المستخدمين", exact: true })).toHaveCount(0);
    await expect(nav.getByRole("button", { name: "إدارة الإعدادات", exact: true })).toHaveCount(0);
    await expect(nav.getByRole("button", { name: "إدارة بيانات الأشعة", exact: true })).toHaveCount(0);
  });

  test("admin role preview re-gates the sidebar without a reload", async ({ page }) => {
    await gotoSim(page, "admin");
    const nav = page.getByRole("navigation", { name: "تبويبات النظام" });
    await expect(nav.getByRole("button", { name: "إدارة المستخدمين", exact: true })).toBeVisible();

    await page.getByRole("group", { name: "معاينة الأدوار" }).getByRole("button", { name: "الموظف" }).click();

    await expect(nav.getByRole("button", { name: "إدارة المستخدمين", exact: true })).toHaveCount(0);
    await expect(nav.getByRole("button", { name: "صور الأشعة المحالة", exact: true })).toBeVisible();

    await page.getByRole("group", { name: "معاينة الأدوار" }).getByRole("button", { name: "الإدارة" }).click();
    await expect(nav.getByRole("button", { name: "إدارة المستخدمين", exact: true })).toBeVisible();
  });

  test("?user= re-attributes the session while keeping the role's gating", async ({ page }) => {
    // The URL contract lets a role run as a different seeded account — used by
    // the queue specs to look at one reviewer's rows as somebody else.
    await gotoSim(page, "employee", { user: "hihaloraini" });
    await expect(sidebar(page).getByText("حاتم العريني", { exact: true })).toBeVisible();
    await openTab(page, "إدارة مساحة العمل");
    await expect(workspace(page).getByRole("heading", { name: "صور الأشعة المحالة" })).toBeVisible();
  });
});
