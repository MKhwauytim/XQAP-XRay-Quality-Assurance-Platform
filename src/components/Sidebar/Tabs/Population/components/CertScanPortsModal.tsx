import { useState } from "react";
import { ModalPortal } from "../../../../ModalPortal/ModalPortal";
import { useFocusTrap } from "../../../../../hooks/useFocusTrap";
import type { PortCatalogCategory } from "../../../../../data/distribution/portEligibility";
import { useLabels } from "../../../../../data/labels/useLabels";
import "./PortRestrictionsModal.css";

type CertScanPortsModalProps = {
  portCatalog: PortCatalogCategory[];
  selectedPorts: readonly string[];
  onSave: (ports: string[]) => void;
  onClose: () => void;
};

/**
 * Admin picker for `PopulationConfig.certScanPorts` (C2): every row whose port
 * is checked here is processed as CertScan, in addition to rows matched by
 * the pasted CertScan device list. Reuses PortRestrictionsModal's markup and
 * CSS (`prm-*`) so the two port pickers read as one control family.
 *
 * A previously flagged port absent from the current catalog (not in this
 * month's risk file) is kept and listed under its own group, so opening and
 * saving the picker for one month never silently drops another month's flag.
 * No backdrop-click-to-close (unsaved checkbox edits); close via ✕, the
 * cancel button or Escape.
 */
export default function CertScanPortsModal({ portCatalog, selectedPorts, onSave, onClose }: CertScanPortsModalProps) {
  const L = useLabels();
  const catalogPortNames = new Set(portCatalog.flatMap((category) => category.ports.map((port) => port.portName)));
  const missingPorts = selectedPorts.filter((portName) => !catalogPortNames.has(portName));
  const categories: PortCatalogCategory[] =
    missingPorts.length > 0
      ? [
          ...portCatalog,
          {
            category: L.p2_certscan_ports_missing_category,
            ports: missingPorts.map((portName) => ({ portName, rowCount: 0 })),
          },
        ]
      : portCatalog;
  const totalPorts = categories.reduce((sum, category) => sum + category.ports.length, 0);

  const [checked, setChecked] = useState<Set<string>>(() => new Set(selectedPorts));
  const dialogRef = useFocusTrap<HTMLDivElement>({ onEscape: onClose });

  function togglePort(portName: string, on: boolean) {
    setChecked((previous) => {
      const next = new Set(previous);
      if (on) next.add(portName);
      else next.delete(portName);
      return next;
    });
  }

  function toggleCategory(category: PortCatalogCategory, on: boolean) {
    setChecked((previous) => {
      const next = new Set(previous);
      for (const port of category.ports) {
        if (on) next.add(port.portName);
        else next.delete(port.portName);
      }
      return next;
    });
  }

  function handleSave() {
    onSave(
      categories
        .flatMap((category) => category.ports.map((port) => port.portName))
        .filter((portName) => checked.has(portName)),
    );
  }

  return (
    <ModalPortal>
      <div className="prm-backdrop csp-over-modal">
        <div ref={dialogRef} className="prm-modal" role="dialog" aria-modal="true" aria-labelledby="csp-title">
          <div className="prm-head">
            <div>
              <h3 id="csp-title">{L.p2_certscan_ports_title}</h3>
              <p className="prm-sub">{L.p2_certscan_ports_section_hint}</p>
            </div>
            <button type="button" className="prm-close" onClick={onClose} aria-label={L.p2_certscan_ports_close_aria}>
              ✕
            </button>
          </div>

          <div className={`prm-status ${checked.size > 0 ? "restricted" : "unrestricted"}`} role="status">
            <span>
              {L.p2_certscan_ports_status
                .replace("{count}", String(checked.size))
                .replace("{total}", String(totalPorts))}
            </span>
          </div>

          <div className="prm-body">
            {categories.length === 0 ? (
              <p className="prm-empty">{L.p2_certscan_ports_empty_catalog}</p>
            ) : (
              categories.map((category) => {
                const checkedInCategory = category.ports.filter((port) => checked.has(port.portName)).length;
                const allOn = checkedInCategory === category.ports.length;
                const noneOn = checkedInCategory === 0;
                return (
                  <div className="prm-cat-block" key={category.category}>
                    <div className="prm-cat-head">
                      <label>
                        <input
                          type="checkbox"
                          checked={allOn}
                          ref={(el) => {
                            if (el) el.indeterminate = !allOn && !noneOn;
                          }}
                          onChange={(e) => toggleCategory(category, e.target.checked)}
                        />
                        {category.category}
                      </label>
                      <span className="prm-cat-count num">
                        {checkedInCategory}/{category.ports.length}
                      </span>
                    </div>
                    <ul className="prm-port-list">
                      {category.ports.map((port) => (
                        <li className="prm-port-row" key={port.portName}>
                          <label>
                            <input
                              type="checkbox"
                              checked={checked.has(port.portName)}
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
            <button type="button" className="prm-btn prm-btn-danger-ghost" onClick={() => setChecked(new Set())}>
              {L.p2_certscan_ports_clear}
            </button>
            <div className="prm-foot-actions">
              <button type="button" className="prm-btn prm-btn-ghost" onClick={onClose}>
                {L.p2_certscan_ports_cancel}
              </button>
              <button type="button" className="prm-btn prm-btn-primary" onClick={handleSave}>
                {L.p2_certscan_ports_save}
              </button>
            </div>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
