/**
 * Every port the workspace has already seen, read from each month's saved
 * sample (`sample.master.json`): its `portAllocations` list every port of that
 * month's population with its size, and its rows carry each port's type. Lets
 * the CertScan-ports and priority-ports pickers list ports before this month's
 * Excel is uploaded or processed. Read-only, derived on demand — no new stored
 * state. Months without a sample contribute nothing.
 */
import type { KnownPort } from "../distribution/portEligibility";
import { normalizePortName } from "../distribution/portEligibility";
import { loadSampleMaster } from "../sampling/sampleStorage";
import { logError } from "../storage/errorLogger";
import { mapWithConcurrency } from "../storage/concurrency";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { listMonthFolders } from "./populationStorage";
import type { SampleMasterData } from "../sampling/sampleTypes";

/** Fold samples, oldest month first, into one entry per port: the latest month wins the count and the type. */
export function knownPortsFromSamples(samples: readonly Pick<SampleMasterData, "portAllocations" | "rows">[]): KnownPort[] {
  const ports = new Map<string, KnownPort>();
  for (const sample of samples) {
    const types = new Map<string, string>();
    for (const row of sample.rows ?? []) {
      if (row.portType?.trim()) types.set(normalizePortName(row.portName), row.portType.trim());
    }
    for (const allocation of sample.portAllocations ?? []) {
      const portName = normalizePortName(allocation.portName);
      ports.set(portName, {
        portName,
        portType: types.get(portName) ?? ports.get(portName)?.portType ?? null,
        rowCount: allocation.populationSize,
      });
    }
  }
  return [...ports.values()];
}

export async function loadKnownPorts(directoryHandle: DirectoryHandleLike): Promise<KnownPort[]> {
  try {
    const months = await listMonthFolders(directoryHandle);
    const samples = await mapWithConcurrency(months, 4, async (month) => {
      try {
        return await loadSampleMaster(directoryHandle, month.folderName);
      } catch {
        return null; // one unreadable month must not hide every other month's ports
      }
    });
    return knownPortsFromSamples(samples.filter((sample): sample is SampleMasterData => sample !== null));
  } catch (error) {
    logError("population:known-ports", error);
    return [];
  }
}
