import type { AuthRole } from "../../auth/authTypes";
import type { PasswordHashRecord } from "../../auth/passwordCrypto";

export const WORKSPACE_SCHEMA_VERSION = "1.0.0" as const;

export type WorkspaceStatus =
  | "not_selected"
  | "checking"
  | "ready"
  | "missing_structure"
  | "invalid_structure"
  | "permission_denied"
  | "unsupported_browser"
  | "error";

export type WorkspaceFileType =
  | "workspace.manifest"
  | "users.permissions"
  | "data.raw"
  | "data.processed"
  | "sample.master"
  | "sample.distribution"
  | "employee.answers"
  | "workspace.lock";

export type PermissionLevel = "none" | "view" | "edit";

export type WorkspaceFileStatus =
  | "not_checked"
  | "missing"
  | "loaded"
  | "invalid_json"
  | "schema_mismatch"
  | "permission_denied"
  | "dirty"
  | "saving"
  | "saved"
  | "error";

export type FileEditState =
  | "readonly"
  | "checking_lock"
  | "locked_by_current_user"
  | "locked_by_other_user"
  | "editing"
  | "saving"
  | "conflict_detected"
  | "saved"
  | "save_failed";

export type JsonFileMetadata = {
  schemaVersion: typeof WORKSPACE_SCHEMA_VERSION;
  fileType: WorkspaceFileType;
  revision: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  contentHash: string;
  /** Per-write UUID embedded by casLoop for cross-machine race detection (SEC-01 file). */
  _writeToken?: string;
};

export type JsonEnvelope<TData> = {
  metadata: JsonFileMetadata;
  data: TData;
};

export type WorkspaceManifestData = {
  workspaceId: string;
  workspaceName: string;
  files: {
    usersPermissions: string;
    dataRaw: string;
    dataProcessed: string;
    sampleMaster: string;
    sampleDistribution: string;
    employeeAnswersFolder: string;
    systemFolder: string;
    locksFolder: string;
    auditFolder: string;
  };
};

export type WorkspaceManifestFile = JsonEnvelope<WorkspaceManifestData>;

export type ManagedUser = {
  id: string;
  username: string;
  displayName: string;
  passwordHash: PasswordHashRecord;
  role: AuthRole;
  isActive: boolean;
  hasCertScanLicense: boolean;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
};

export type ManagedRole = {
  id: AuthRole;
  label: string;
  description: string;
  isSystemRole: boolean;
};

export type RolePermission = {
  role: AuthRole;
  tabId: string;
  access: PermissionLevel;
};

export type FeaturePermission = {
  role: AuthRole;
  featureId: string;
  enabled: boolean;
};

export type UsersPermissionsData = {
  users: ManagedUser[];
  roles: ManagedRole[];
  permissions: RolePermission[];
  featurePermissions?: FeaturePermission[];
};

export type UsersPermissionsFile = JsonEnvelope<UsersPermissionsData>;

export type RawDataRecord = Record<string, unknown>;

export type RawDataFileData = {
  sourceFileName: string | null;
  importedAt: string | null;
  importedBy: string | null;
  records: RawDataRecord[];
};

export type RawDataFile = JsonEnvelope<RawDataFileData>;

export type ProcessedDataRecord = Record<string, unknown>;

export type ProcessedDataFileData = {
  processingBatchId: string | null;
  sourceRawRevision: number | null;
  processedAt: string | null;
  processedBy: string | null;
  rulesVersion: string | null;
  records: ProcessedDataRecord[];
  exclusions: Array<{
    sourceRecordId: string;
    reason: string;
  }>;
  validationMessages: string[];
};

export type ProcessedDataFile = JsonEnvelope<ProcessedDataFileData>;

export type SampleRecord = {
  sampleId: string;
  sourceRecordId: string;
  payload: Record<string, unknown>;
};

export type SampleMasterData = {
  sampleBatchId: string | null;
  sourceProcessedRevision: number | null;
  createdAt: string | null;
  createdBy: string | null;
  selectionMethod: string | null;
  records: SampleRecord[];
};

export type SampleMasterFile = JsonEnvelope<SampleMasterData>;

export type SampleAssignment = {
  assignmentId: string;
  sampleId: string;
  assignedToUsername: string;
  assignedAt: string;
  assignedBy: string;
  status: "assigned" | "in_progress" | "completed" | "returned";
};

export type SampleDistributionData = {
  distributionBatchId: string | null;
  sampleBatchId: string | null;
  createdAt: string | null;
  createdBy: string | null;
  assignments: SampleAssignment[];
};

export type SampleDistributionFile = JsonEnvelope<SampleDistributionData>;

export type EmployeeAnswer = {
  sampleId: string;
  answeredAt: string | null;
  answers: Record<string, unknown>;
  status: "not_started" | "in_progress" | "completed";
};

export type EmployeeAnswersData = {
  answerBatchId: string;
  sampleBatchId: string;
  distributionBatchId: string;
  username: string;
  createdAt: string;
  createdBy: string;
  answers: EmployeeAnswer[];
};

export type EmployeeAnswersFile = JsonEnvelope<EmployeeAnswersData>;

export type WorkspaceLockData = {
  resourceName: string;
  lockedByUsername: string;
  lockedByRole: AuthRole;
  lockId: string;
  createdAt: string;
  expiresAt: string;
  baseRevision: number;
  baseHash: string;
};

export type WorkspaceLockFile = JsonEnvelope<WorkspaceLockData>;

export type WorkspaceStructureCheckResult = {
  status: WorkspaceStatus;
  missingItems: string[];
  invalidItems: string[];
  message: string;
};

export type WorkspaceLoadedFiles = {
  manifest: WorkspaceManifestFile | null;
  usersPermissions: UsersPermissionsFile | null;
  sampleMaster: SampleMasterFile | null;
  sampleDistribution: SampleDistributionFile | null;
};

export type SaveWithRevisionResult<TFile> =
  | {
      ok: true;
      savedFile: TFile;
      newHash: string;
    }
  | {
      ok: false;
      reason: "conflict" | "permission_denied" | "write_failed" | "invalid_file";
      message: string;
      latestHash?: string;
    };

export type AcquireLockResult =
  | {
      ok: true;
      lock: WorkspaceLockFile;
    }
  | {
      ok: false;
      reason: "locked_by_other_user" | "permission_denied" | "write_failed";
      message: string;
      existingLock?: WorkspaceLockFile;
    };