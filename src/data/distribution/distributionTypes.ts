import type { PreparedPopulationRow } from "../../components/Sidebar/Tabs/Population/processing/populationProcessingTypes";

export type DistributionEventType =
  | "assigned"
  | "completed"
  | "replacement-requested"
  | "replaced"
  | "reassigned";

export type DistributionEvent = {
  eventId: string;
  eventType: DistributionEventType;
  xrayImageId: string;
  assignedTo: string;
  replacedById?: string;
  reassignedTo?: string;
  eventAt: string;
  eventBy: string;
  notes?: string;
};

export type DistributionLog = {
  monthFolderName: string;
  events: DistributionEvent[];
};

export type DistributionStatus =
  | "pending"
  | "completed"
  | "replacement-requested"
  | "replaced";

export type DistributionEntry = {
  xrayImageId: string;
  assignedTo: string;
  status: DistributionStatus;
  replacedById: string | null;
  lastEventAt: string;
  row: PreparedPopulationRow;
};

export type DistributionCurrentData = {
  monthFolderName: string;
  derivedAt: string;
  totalAssigned: number;
  totalCompleted: number;
  totalReplaced: number;
  totalPending: number;
  entries: DistributionEntry[];
};
