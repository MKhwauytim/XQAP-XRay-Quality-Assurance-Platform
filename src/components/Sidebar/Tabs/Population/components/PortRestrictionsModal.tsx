import { useState } from "react";
import { ModalPortal } from "../../../../ModalPortal/ModalPortal";
import { useFocusTrap } from "../../../../../hooks/useFocusTrap";
import type { PortCatalogCategory } from "../../../../../data/distribution/portEligibility";
import type { EmployeePortRestriction } from "../../../../../data/population/populationConfig";
import { getLabels } from "../../../../../data/labels/labelsStore";
import "./PortRestrictionsModal.css";

function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_m, key) => vars[key] ?? `{${key}}`);
}

type PortRestrictionsModalProps = {
  employee: { username: string; displayName: string };
  portCatalog: PortCatalogCategory[];
  restriction: EmployeePortRestriction | undefined;
  onSave: (next: EmployeePortRestriction) => void;
  onClose: () => void;
};

/**
 * Click-through from an employee's name in the Phase 4 allocation matrix:
 * which ports (grouped by their portType category) this employee may receive
 * samples from, both in manual assignment and the automatic bulk run.
 *
 * Unrestricted (the default) means every current AND future port — so opening
 * this modal for an unrestricted employee shows every port checked, and it
 * takes an explicit uncheck (or the "remove all restrictions" action to
 * revert) to start recording an explicit allow-list. See
 * `EmployeePortRestriction`'s own comment for why a re-checked "all ports" is
 * NOT silently treated as equivalent to unrestricted.
 */
export default function PortRestrictionsModal({
  employee,
  portCatalog,
  restriction,
  onSave,
  onClose,
}: PortRestrictionsModalProps) {
  const L = getLabels();
  const allPortNames = portCatalog.flatMap((cat) => cat.ports.map((p) => p.portName));

  const [restricted, setRestricted] = useState(restriction?.restricted ?? false);
  const [enabledPorts, setEnabledPorts] = useState<Set<string>>(
    new Set(restriction?.restricted ? restriction.enabledPorts : allPortNames)
  );

  const dialogRef = useFocusTrap<HTMLDivElement>({ onEscape: onClose });

  function togglePort(portName: string, checked: boolean) {
    setRestricted(true);
    setEnabledPorts((prev) => {
      const next = new Set(prev);
      if (checked) next.add(portName);
      else next.delete(portName);
      return next;
    });
  }

  function toggleCategory(category: PortCatalogCategory, checked: boolean) {
    setRestricted(true);
    setEnabledPorts((prev) => {
      const next = new Set(prev);
      for (const port of category.ports) {
        if (checked) next.add(port.portName);
        else next.delete(port.portName);
      }
      return next;
    });
  }

  function handleClearRestriction() {
    setRestricted(false);
    setEnabledPorts(new Set(allPortNames));
  }

  function handleSave() {
    onSave({
      username: employee.username,
      restricted,
      enabledPorts: restricted ? [...enabledPorts] : [],
    });
  }

  return (
    <ModalPortal>
      {/* No backdrop-click-to-close, matching every other in-app dialog that
          holds unsaved input (see ModalShell's own note on this): a stray
          click outside must not silently discard the admin's checkbox edits.
          Closing is via the X, Cancel, or Escape. */}
      <div className="prm-backdrop">
        <div
          ref={dialogRef}
          className="prm-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="prm-title"
        >
          <div className="prm-head">
            <div>
              <h3 id="prm-title">
                {fillTemplate(L.p4_ports_modal_title, { expert: employee.displayName })}
              </h3>
              <p className="prm-sub">{L.p4_ports_modal_subtitle}</p>
            </div>
            <button type="button" className="prm-close" onClick={onClose} aria-label={L.p4_ports_close_aria}>
              ✕
            </button>
          </div>

          <div className={`prm-status ${restricted ? "restricted" : "unrestricted"}`} role="status">
            <span>
              {restricted
                ? fillTemplate(L.p4_ports_status_restricted, {
                    enabled: String(enabledPorts.size),
                    total: String(allPortNames.length),
                  })
                : L.p4_ports_status_unrestricted}
            </span>
          </div>

          <div className="prm-body">
            {portCatalog.length === 0 ? (
              <p className="prm-empty">{L.p4_ports_empty_catalog}</p>
            ) : (
              portCatalog.map((cat) => {
                const enabledInCat = cat.ports.filter((p) => enabledPorts.has(p.portName)).length;
                const allOn = enabledInCat === cat.ports.length;
                const noneOn = enabledInCat === 0;
                return (
                  <div className="prm-cat-block" key={cat.category}>
                    <div className="prm-cat-head">
                      <label>
                        <input
                          type="checkbox"
                          checked={allOn}
                          ref={(el) => {
                            if (el) el.indeterminate = !allOn && !noneOn;
                          }}
                          onChange={(e) => toggleCategory(cat, e.target.checked)}
                        />
                        {cat.category}
                      </label>
                      <span className="prm-cat-count num">
                        {enabledInCat}/{cat.ports.length}
                      </span>
                    </div>
                    <ul className="prm-port-list">
                      {cat.ports.map((port) => (
                        <li className="prm-port-row" key={port.portName}>
                          <label>
                            <input
                              type="checkbox"
                              checked={enabledPorts.has(port.portName)}
                              onChange={(e) => togglePort(port.portName, e.target.checked)}
                            />
                            {port.portName}
                          </label>
                          <span className="prm-port-count num">{port.rowCount}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })
            )}
          </div>

          <div className="prm-foot">
            <button type="button" className="prm-btn prm-btn-danger-ghost" onClick={handleClearRestriction}>
              {L.p4_ports_clear_restriction}
            </button>
            <div className="prm-foot-actions">
              <button type="button" className="prm-btn prm-btn-ghost" onClick={onClose}>
                {L.p4_ports_cancel}
              </button>
              <button type="button" className="prm-btn prm-btn-primary" onClick={handleSave}>
                {L.p4_ports_save}
              </button>
            </div>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
