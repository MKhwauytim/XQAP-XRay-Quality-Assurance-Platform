/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import AuthGate from "./AuthGate";
import * as userManagement from "./userManagement";
import * as authSession from "./authSession";
import * as passwordCrypto from "./passwordCrypto";

// Minimal mock workspace context
vi.mock("../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ selectWorkspace: vi.fn() }),
}));

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(authSession, "readRealSession").mockReturnValue(null);
});

afterEach(() => {
  cleanup();
});

describe("AuthGate — login form", () => {
  it("renders login form when no active session and users exist", () => {
    vi.spyOn(userManagement, "getManagedLoginUsers").mockReturnValue([
      {
        id: "u1", username: "testuser", displayName: "Test", role: "employee",
        passwordHash: { algorithm: "argon2id", encoded: "x" },
        isActive: true, hasCertScanLicense: false,
        createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
      },
    ]);

    render(<AuthGate>{() => <div>authenticated</div>}</AuthGate>);
    expect(screen.getByLabelText("اسم المستخدم")).toBeInTheDocument();
    expect(screen.getByLabelText("كلمة المرور")).toBeInTheDocument();
  });

  it("shows error message on wrong password", async () => {
    vi.spyOn(userManagement, "getManagedLoginUsers").mockReturnValue([
      {
        id: "u1", username: "testuser", displayName: "Test", role: "employee",
        passwordHash: { algorithm: "argon2id", encoded: "x" },
        isActive: true, hasCertScanLicense: false,
        createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
      },
    ]);
    vi.spyOn(passwordCrypto, "verifyPasswordHash").mockResolvedValue(false);

    render(<AuthGate>{() => <div>authenticated</div>}</AuthGate>);
    fireEvent.change(screen.getByLabelText("اسم المستخدم"), { target: { value: "testuser" } });
    fireEvent.change(screen.getByLabelText("كلمة المرور"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "دخول" }));

    await waitFor(() => {
      expect(screen.getByText(/اسم المستخدم غير موجود/)).toBeInTheDocument();
    });
  });
});
