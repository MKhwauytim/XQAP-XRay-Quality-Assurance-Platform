import type { PreparedPopulationRow } from "../../components/Sidebar/Tabs/Population/processing/populationProcessingTypes";
import { hamiltonApportionment } from "./apportionment";
import { createRng, drawWithoutReplacement, hashSeedString } from "./rng";
import type {
  PortAllocation,
  SampleConfig,
  SampleDrawResult,
  SampleMasterData
} from "./sampleTypes";

// Group population rows by portName
function groupByPort(
  rows: PreparedPopulationRow[]
): Map<string, PreparedPopulationRow[]> {
  const groups = new Map<string, PreparedPopulationRow[]>();
  for (const row of rows) {
    const key = row.portName ?? "غير محدد";
    let bucket = groups.get(key);
    if (!bucket) {
      bucket = [];
      groups.set(key, bucket);
    }
    bucket.push(row);
  }
  return groups;
}

// Split a port's allocated quota into CertScan / NonCertScan sub-quotas
// using Hamilton apportionment on the port's own CertScan/NonCertScan counts.
function splitCertScanQuota(
  allocated: number,
  certScanCount: number,
  nonCertScanCount: number
): { certScanQuota: number; nonCertScanQuota: number } {
  const portTotal = certScanCount + nonCertScanCount;
  if (portTotal === 0 || allocated === 0) {
    return { certScanQuota: 0, nonCertScanQuota: 0 };
  }

  const split = hamiltonApportionment(
    [
      { key: "cert", size: certScanCount },
      { key: "noncert", size: nonCertScanCount }
    ],
    allocated
  );

  const certScanQuota = split.find((r) => r.key === "cert")?.allocated ?? 0;
  const nonCertScanQuota =
    split.find((r) => r.key === "noncert")?.allocated ?? 0;
  return { certScanQuota, nonCertScanQuota };
}

export function drawSample(
  rows: PreparedPopulationRow[],
  config: SampleConfig,
  username: string
): SampleDrawResult {
  if (rows.length === 0) {
    return { ok: false, reason: "لا توجد صفوف مجتمع للسحب منها." };
  }

  if (config.totalSampleSize <= 0) {
    return { ok: false, reason: "حجم العينة يجب أن يكون أكبر من صفر." };
  }

  const rng = createRng(hashSeedString(config.rngSeed));
  const portGroups = groupByPort(rows);

  // Compute port-level allocations via Hamilton
  const portKeys = Array.from(portGroups.keys());
  const portSizes = portKeys.map((k) => ({
    key: k,
    size: portGroups.get(k)!.length
  }));

  const apportioned = hamiltonApportionment(portSizes, config.totalSampleSize);

  const portAllocations: PortAllocation[] = [];
  const allDrawnRows: PreparedPopulationRow[] = [];

  let totalCertScanRequested = 0;
  let totalNonCertScanRequested = 0;
  let totalCertScanActual = 0;
  let totalNonCertScanActual = 0;

  for (const entry of apportioned) {
    const portRows = portGroups.get(entry.key)!;
    const certScanRows = portRows.filter((r) => r.certScanStatus === "Certscan");
    const nonCertScanRows = portRows.filter(
      (r) => r.certScanStatus === "NonCertscan"
    );

    const { certScanQuota, nonCertScanQuota } = splitCertScanQuota(
      entry.allocated,
      certScanRows.length,
      nonCertScanRows.length
    );

    // Draw from each tier independently using the shared RNG
    const drawnCert = drawWithoutReplacement(certScanRows, certScanQuota, rng);
    const drawnNonCert = drawWithoutReplacement(
      nonCertScanRows,
      nonCertScanQuota,
      rng
    );

    const portActualTotal = drawnCert.length + drawnNonCert.length;

    portAllocations.push({
      portName: entry.key,
      populationSize: portRows.length,
      certScanCount: certScanRows.length,
      nonCertScanCount: nonCertScanRows.length,
      allocatedQuota: entry.allocated,
      certScanQuota,
      nonCertScanQuota,
      actualCertScanDrawn: drawnCert.length,
      actualNonCertScanDrawn: drawnNonCert.length,
      actualTotalDrawn: portActualTotal
    });

    allDrawnRows.push(...drawnCert, ...drawnNonCert);
    totalCertScanRequested += certScanQuota;
    totalNonCertScanRequested += nonCertScanQuota;
    totalCertScanActual += drawnCert.length;
    totalNonCertScanActual += drawnNonCert.length;
  }

  // Handle spillover: ports that are undersized leave unfilled seats.
  // Capacity-weighted spillover: redistribute unfilled quota to ports that still
  // have remaining population, proportional to their remaining capacity.
  const underfill =
    config.totalSampleSize - allDrawnRows.length;

  if (underfill > 0) {
    const spillResult = applySpillover(
      portGroups,
      portAllocations,
      allDrawnRows,
      underfill,
      rng
    );
    allDrawnRows.push(...spillResult.extraRows);
    totalCertScanActual += spillResult.extraCert;
    totalNonCertScanActual += spillResult.extraNonCert;
  }

  const data: SampleMasterData = {
    rngSeed: config.rngSeed,
    totalRequested: config.totalSampleSize,
    totalActual: allDrawnRows.length,
    certScanRequested: totalCertScanRequested,
    nonCertScanRequested: totalNonCertScanRequested,
    certScanActual: totalCertScanActual,
    nonCertScanActual: totalNonCertScanActual,
    portAllocations,
    drawnAt: new Date().toISOString(),
    drawnBy: username,
    rows: allDrawnRows
  };

  return { ok: true, data };
}

type SpilloverResult = {
  extraRows: PreparedPopulationRow[];
  extraCert: number;
  extraNonCert: number;
};

function applySpillover(
  portGroups: Map<string, PreparedPopulationRow[]>,
  allocations: PortAllocation[],
  alreadyDrawn: PreparedPopulationRow[],
  underfill: number,
  rng: ReturnType<typeof createRng>
): SpilloverResult {
  const drawnIds = new Set(alreadyDrawn.map((r) => r.xrayImageId));

  // Ports with remaining capacity (population > drawn)
  const candidates = allocations
    .map((a) => {
      const portRows = portGroups.get(a.portName)!;
      const remaining = portRows.filter((r) => !drawnIds.has(r.xrayImageId));
      return { portName: a.portName, remaining };
    })
    .filter((c) => c.remaining.length > 0);

  if (candidates.length === 0) {
    return { extraRows: [], extraCert: 0, extraNonCert: 0 };
  }

  const spillApportionment = hamiltonApportionment(
    candidates.map((c) => ({ key: c.portName, size: c.remaining.length })),
    underfill
  );

  const extraRows: PreparedPopulationRow[] = [];
  let extraCert = 0;
  let extraNonCert = 0;

  for (const entry of spillApportionment) {
    if (entry.allocated === 0) continue;
    const candidate = candidates.find((c) => c.portName === entry.key)!;
    const drawn = drawWithoutReplacement(
      candidate.remaining,
      entry.allocated,
      rng
    );
    extraRows.push(...drawn);
    extraCert += drawn.filter((r) => r.certScanStatus === "Certscan").length;
    extraNonCert += drawn.filter(
      (r) => r.certScanStatus === "NonCertscan"
    ).length;
  }

  return { extraRows, extraCert, extraNonCert };
}
