/* @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthSession } from "../auth/authTypes";
import { DEFAULT_LABELS } from "../data/labels/labelsStore";
import { SIM_WORKSPACE_NAME } from "./simWorkspace";

// `WorkspaceProvider` reads `?sim=1` ONCE at module scope — the first render has
// to know whether the picker runs at all — so the URL has to be in place before
// the module is evaluated. Each test therefore gets a fresh module registry via
// `vi.resetModules()` and imports the whole tree dynamically. Everything that
// takes part in the render must come from that SAME fresh registry, or the
// probe would read a different `WorkspaceContext` instance than the provider
// publishes to.
function setSearch(search: string): void {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, search, href: `http://localhost/${search}` },
  });
}

type Probe = {
  status: string;
  handleName: string;
  readOnly: boolean;
  session: AuthSession | null;
};

const probe: Probe = { status: "", handleName: "", readOnly: true, session: null };

async function renderSimApp() {
  const { WorkspaceProvider } = await import("../data/workspace/WorkspaceProvider");
  const { WorkspaceGate, WorkspacePicker } = await import("../data/workspace/WorkspaceGate");
  const { default: AuthGate } = await import("../auth/AuthGate");
  const { useWorkspace } = await import("../data/workspace/useWorkspace");
  const { isReadOnlyMode } = await import("../data/storage/readOnlyMode");

  function ProbeView({ session }: { session: AuthSession }) {
    const { directoryHandle, status } = useWorkspace();
    probe.status = status;
    probe.handleName = directoryHandle?.name ?? "";
    probe.readOnly = isReadOnlyMode();
    probe.session = session;
    return <output data-testid="probe">{`${status}|${session.role}`}</output>;
  }

  // The real gate chain from App.tsx — picker → auth → workspace gate — so this
  // exercises every screen `?sim=1` has to get past, not just the provider.
  return render(
    <WorkspaceProvider>
      <WorkspacePicker>
        <AuthGate>
          {(session) => (
            <WorkspaceGate session={session}>
              <ProbeView session={session} />
            </WorkspaceGate>
          )}
        </AuthGate>
      </WorkspacePicker>
    </WorkspaceProvider>,
  );
}

beforeEach(() => {
  vi.resetModules();
  probe.status = "";
  probe.handleName = "";
  probe.readOnly = true;
  probe.session = null;
});

afterEach(() => {
  cleanup();
  // The banner is appended straight to <body>, outside React's tree, so RTL's
  // cleanup does not remove it — and a leftover would make the "no flag" test
  // pass for the wrong reason.
  document.querySelectorAll("[data-sim-banner]").forEach((node) => node.remove());
});

describe("?sim=1", () => {
  it("mounts a ready workspace and signs in, with no picker and no login form", async () => {
    setSearch("?sim=1&role=employee");
    await renderSimApp();

    await waitFor(() => {
      expect(screen.getByTestId("probe")).toBeInTheDocument();
    });

    // The whole point: jsdom has no `showDirectoryPicker`, so without the sim
    // bypass this render lands on the "unsupported browser" card and never
    // reaches a session at all.
    expect(probe.status).toBe("ready");
    expect(probe.handleName).toBe(SIM_WORKSPACE_NAME);
    expect(probe.session).toMatchObject({ role: "employee", username: "jalgahamdi" });
    expect(screen.queryByLabelText("اسم المستخدم")).toBeNull();

    // The seed fabricates ports, declaration numbers and reviewer verdicts that
    // look exactly like a real month; the page has to say so. The read-only
    // demo's own banner keys on `session.mode === "demo"`, which the simulated
    // session deliberately does not carry — so this is its only such signal.
    const banner = document.querySelector("[data-sim-banner]");
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain("SIMULATED DATA");
  });

  it("mounts WRITABLE — not the demo workspace's read-only mode", async () => {
    setSearch("?sim=1");
    await renderSimApp();

    await waitFor(() => {
      expect(screen.getByTestId("probe")).toBeInTheDocument();
    });

    // `enterDemoWorkspace` finishes with `setReadOnlyMode(true)`, which rejects
    // every answer / reassignment / import. The simulated workspace must not —
    // this single assertion is the difference between a drivable simulation and
    // the existing demo.
    expect(probe.readOnly).toBe(false);
    // …and the session carries no `mode: "demo"` either, because
    // `usePermissions().isReadOnly` is `session.mode === "demo" || isReadOnlyMode()`
    // and BOTH halves have to be false for a mutation to be permitted.
    expect(probe.session?.mode).toBeUndefined();
    expect(probe.session).toMatchObject({ role: "admin", username: "admin" });
  });

  it("signs in as the requested role's seeded account", async () => {
    setSearch("?sim=1&role=supervisor");
    await renderSimApp();

    await waitFor(() => {
      expect(screen.getByTestId("probe")).toBeInTheDocument();
    });

    // A managed account that really exists and is active: an ordinary (non-demo)
    // session is subject to AuthGate's `stillHasManagedUser` re-validation once
    // the workspace hydrates, and a made-up username would be logged straight
    // back out.
    expect(probe.session).toMatchObject({ role: "supervisor", username: "malrogi" });
  });

  it("re-issues the session when a later load asks for a different role", async () => {
    // A Playwright suite moves between scenarios by changing `role=` in the URL.
    // `writeSession` persists an ordinary session to localStorage, so without an
    // identity check the second load would silently restore the first load's
    // role and the test would assert against the wrong permissions.
    setSearch("?sim=1&role=employee");
    const first = await renderSimApp();
    await waitFor(() => {
      expect(probe.session).toMatchObject({ role: "employee" });
    });
    first.unmount();

    // Deliberately NOT clearing localStorage: the persisted employee session is
    // exactly the precondition this guards against.
    vi.resetModules();
    setSearch("?sim=1&role=manager");
    await renderSimApp();
    await waitFor(() => {
      expect(probe.session).toMatchObject({ role: "manager", username: "amonem" });
    });
  });

  it("does nothing without the flag — the app still gates on the picker", async () => {
    setSearch("");
    await renderSimApp();

    // jsdom has no File System Access API, so an ordinary load stops at the
    // unsupported-browser card. Reaching the probe would mean the simulated
    // workspace mounted when it was not asked to.
    await waitFor(() => {
      expect(screen.getByText(DEFAULT_LABELS.wsgate_unsupported_title)).toBeInTheDocument();
    });
    expect(screen.queryByTestId("probe")).toBeNull();
    expect(probe.session).toBeNull();
    expect(document.querySelector("[data-sim-banner]")).toBeNull();
  });
});

describe("the simulated workspace accepts writes", () => {
  it("writes and reads back through the real safe-write layer", async () => {
    const { createSimulatedWorkspace } = await import("./simWorkspace");
    const { safeWriteJson, safeReadJson } = await import("../data/storage/safeWrite");
    const { wrap } = await import("../data/storage/jsonEnvelope");

    const handle = await createSimulatedWorkspace();
    // Not a UI assertion — a direct check that the mounted tree is genuinely
    // writable through the same layer every mutation in the app goes through.
    // `safeWriteJson` opens with `assertWritableMode()`, so in read-only mode
    // this call throws ReadOnlyModeError instead of writing anything.
    await expect(
      safeWriteJson(handle, "sim-write-probe.json", wrap({ probe: true }, 1)),
    ).resolves.toBeUndefined();

    const read = await safeReadJson<{ probe: boolean }>(handle, "sim-write-probe.json");
    expect(read.ok && read.value.probe).toBe(true);
  });
});
