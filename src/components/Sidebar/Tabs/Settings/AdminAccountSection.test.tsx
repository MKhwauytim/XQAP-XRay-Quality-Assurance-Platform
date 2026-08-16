/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { AdminAccountSection } from "./AdminAccountSection";
import * as authSession from "../../../../auth/authSession";
import * as userManagement from "../../../../auth/userManagement";
import type { AuthSession } from "../../../../auth/authTypes";

const mocks = vi.hoisted(() => ({
  syncUserManagementToDisk: vi.fn(),
  directoryHandle: { name: "workspace" },
}));

vi.mock("../../../../data/workspace/userSync", () => ({
  syncUserManagementToDisk: mocks.syncUserManagementToDisk,
}));

vi.mock("../../../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle: mocks.directoryHandle, status: "ready" }),
}));

// Audit finding 13: AdminAccountSection now gates on canMutate("settings.adminAccount")
// (the EFFECTIVE/previewed role) in addition to the pre-existing isRealAdmin visibility
// check. `usePermissions` itself resolves through `readSession()`, whose internal call to
// `readRealSession()` is a same-module reference that a `vi.spyOn(authSession,
// "readRealSession")` from outside the module does NOT intercept (a standard ESM
// self-reference gotcha) -- so mocking usePermissions directly here, independent of the
// authSession spies below, is what lets "editing" behave as a real admin while the new
// "role preview" describe block exercises canMutate=false in isolation.
const permissionsMock = vi.hoisted(() => ({ state: { canMutate: true } }));
vi.mock("../../../../auth/usePermissions", () => ({
  usePermissions: () => ({
    canMutate: (featureId: string) =>
      featureId === "settings.adminAccount" ? permissionsMock.state.canMutate : true,
  }),
}));

function session(overrides: Partial<AuthSession>): AuthSession {
  return {
    role: "admin",
    username: "admin",
    loginAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  mocks.syncUserManagementToDisk.mockReset();
  mocks.syncUserManagementToDisk.mockResolvedValue(undefined);
  mocks.directoryHandle = { name: "workspace" };
  permissionsMock.state = { canMutate: true };
  userManagement.writeUserManagementState(
    userManagement.createEmptyUserManagementState(),
    false,
  );
});

afterEach(() => {
  cleanup();
});

describe("AdminAccountSection — who may see it", () => {
  it("renders for a real signed-in admin", () => {
    vi.spyOn(authSession, "readRealSession").mockReturnValue(session({}));

    render(<AdminAccountSection />);

    expect(screen.getByText("حساب المدير")).toBeInTheDocument();
  });

  it("renders nothing for a non-admin role", () => {
    vi.spyOn(authSession, "readRealSession").mockReturnValue(
      session({ role: "manager", username: "amonem" }),
    );

    const { container } = render(<AdminAccountSection />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing in the read-only demo session, despite its admin role", () => {
    vi.spyOn(authSession, "readRealSession").mockReturnValue(
      session({ username: "viewer", mode: "demo" }),
    );

    const { container } = render(<AdminAccountSection />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when signed out", () => {
    vi.spyOn(authSession, "readRealSession").mockReturnValue(null);

    const { container } = render(<AdminAccountSection />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe("AdminAccountSection — editing", () => {
  beforeEach(() => {
    vi.spyOn(authSession, "readRealSession").mockReturnValue(session({}));
  });

  function open() {
    render(<AdminAccountSection />);
  }

  it("is expanded on arrival, with admin-username sign-in on by default", () => {
    open();

    expect(screen.getByRole("button", { expanded: true })).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /السماح بتسجيل الدخول باسم المستخدم/ }),
    ).toBeChecked();
  });

  it("saves a new passcode and persists it to the workspace", async () => {
    open();
    fireEvent.change(screen.getByLabelText("كلمة المرور الجديدة"), {
      target: { value: "new-pass" },
    });
    fireEvent.change(screen.getByLabelText("تأكيد كلمة المرور"), {
      target: { value: "new-pass" },
    });
    fireEvent.click(screen.getByRole("button", { name: "تحديث كلمة المرور" }));

    await waitFor(() => {
      expect(screen.getByText("تم تحديث كلمة مرور المدير.")).toBeInTheDocument();
    });

    const stored = userManagement.readAdminAccount().passwordHash;
    expect(stored).not.toBeNull();
    // The workspace file gets the hash, never the typed passcode (SEC-01).
    expect(JSON.stringify(stored)).not.toContain("new-pass");
    expect(mocks.syncUserManagementToDisk).toHaveBeenCalledTimes(1);
  });

  it("rejects mismatched confirmation without touching the stored passcode", async () => {
    open();
    fireEvent.change(screen.getByLabelText("كلمة المرور الجديدة"), {
      target: { value: "new-pass" },
    });
    fireEvent.change(screen.getByLabelText("تأكيد كلمة المرور"), {
      target: { value: "other-pass" },
    });
    fireEvent.click(screen.getByRole("button", { name: "تحديث كلمة المرور" }));

    await waitFor(() => {
      expect(screen.getByText("كلمتا المرور غير متطابقتين.")).toBeInTheDocument();
    });
    expect(userManagement.readAdminAccount().passwordHash).toBeNull();
    expect(mocks.syncUserManagementToDisk).not.toHaveBeenCalled();
  });

  it("toggles admin-username sign-in off and persists it", async () => {
    open();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /السماح بتسجيل الدخول باسم المستخدم/ }),
    );

    await waitFor(() => {
      expect(userManagement.readAdminAccount().allowUsernameLogin).toBe(false);
    });
    expect(mocks.syncUserManagementToDisk).toHaveBeenCalledTimes(1);
  });

  it("says the change was session-only when no workspace is connected", async () => {
    mocks.directoryHandle = null as unknown as { name: string };
    open();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /السماح بتسجيل الدخول باسم المستخدم/ }),
    );

    await waitFor(() => {
      expect(screen.getByText(/لا توجد مساحة عمل متصلة لحفظه/)).toBeInTheDocument();
    });
    expect(mocks.syncUserManagementToDisk).not.toHaveBeenCalled();
  });
});

// Audit finding 13: the section is visible during a role preview (isRealAdmin only
// checks the REAL session, which is unaffected by previewing another role -- by design,
// so a non-admin real user still never sees it). Before this fix, every control here
// stayed fully interactive too, contradicting the module's own doc comment and unlike
// the sibling SyncIntervalSection, which already went inert via canMutate. These tests
// pin canMutate("settings.adminAccount")=false (what canMutate resolves to for any
// non-admin previewed role, since the feature defaults to admin-only) and assert both
// the render-boundary disabling AND the handler-boundary rejection.
describe("AdminAccountSection — inert during a role preview (audit finding 13)", () => {
  beforeEach(() => {
    vi.spyOn(authSession, "readRealSession").mockReturnValue(session({}));
    permissionsMock.state = { canMutate: false };
  });

  it("still renders (visible to the real admin) but disables every control", () => {
    render(<AdminAccountSection />);

    expect(screen.getByText("حساب المدير")).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /السماح بتسجيل الدخول باسم المستخدم/ }),
    ).toBeDisabled();
    expect(screen.getByLabelText("كلمة المرور الجديدة")).toBeDisabled();
    expect(screen.getByLabelText("تأكيد كلمة المرور")).toBeDisabled();
    expect(screen.getByRole("button", { name: "تحديث كلمة المرور" })).toBeDisabled();
  });

  it("rejects handleChangePassword at the handler boundary even if a stale render left the button enabled", async () => {
    // Render permissive, fill the form, THEN flip canMutate false (simulating a
    // preview toggled mid-interaction) before the click -- proves the handler
    // itself re-checks rather than trusting the render-time disabled state.
    permissionsMock.state = { canMutate: true };
    render(<AdminAccountSection />);
    fireEvent.change(screen.getByLabelText("كلمة المرور الجديدة"), { target: { value: "new-pass" } });
    fireEvent.change(screen.getByLabelText("تأكيد كلمة المرور"), { target: { value: "new-pass" } });

    permissionsMock.state = { canMutate: false };
    fireEvent.click(screen.getByRole("button", { name: "تحديث كلمة المرور" }));

    await waitFor(() => {
      expect(screen.getByText("لا يمكن تعديل حساب المدير أثناء معاينة دور آخر.")).toBeInTheDocument();
    });
    expect(userManagement.readAdminAccount().passwordHash).toBeNull();
    expect(mocks.syncUserManagementToDisk).not.toHaveBeenCalled();
  });
});
