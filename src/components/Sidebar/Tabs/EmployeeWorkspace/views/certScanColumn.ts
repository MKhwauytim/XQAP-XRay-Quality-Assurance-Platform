import type { DataTableCol } from "../../../../DataTable";
import type { DistributionEntry } from "../../../../../data/distribution/distributionTypes";
import type { Labels } from "../../../../../data/labels/labelsStore";

/**
 * DataTable status-filter props for the `certScanStatus` column of the
 * employee sample tables (C2). The option values ARE the processed row's own
 * `certScanStatus` values, so DataTable's default status match
 * (`accessor(row) === value`) filters correctly with no custom matcher; the
 * option labels reuse the shared CertScan chip keys.
 */
export function certScanStatusFilterProps(
  L: Labels
): Pick<DataTableCol<DistributionEntry>, "filterKind" | "statusOptions"> {
  return {
    filterKind: "status",
    statusOptions: [
      { value: "all", label: L.status_all },
      { value: "Certscan", label: L.certscan_filter_certscan },
      { value: "NonCertscan", label: L.certscan_filter_noncertscan },
    ],
  };
}
