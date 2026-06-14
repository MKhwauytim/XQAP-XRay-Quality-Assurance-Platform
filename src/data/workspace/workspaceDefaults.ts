import {
  WORKSPACE_SCHEMA_VERSION,
  type JsonEnvelope,
  type JsonFileMetadata,
  type ProcessedDataFile,
  type RawDataFile,
  type SampleDistributionFile,
  type SampleMasterFile,
  type UsersPermissionsFile,
  type WorkspaceFileType,
  type WorkspaceManifestFile
} from "./workspaceTypes";

export const WORKSPACE_FILE_NAMES = {
  manifest: "workspace.manifest.json",
  usersPermissions: "users.permissions.json",
  dataRaw: "data.raw.json",
  dataProcessed: "data.processed.json",
  sampleMaster: "sample.master.json",
  sampleDistribution: "sample.distribution.json",
  employeeAnswersFolder: "employee-answers",
  systemFolder: ".system",
  locksFolder: "locks",
  auditFolder: "audit",
  backupsFolder: "backups",
  templatesFolder: "templates"
} as const;

export const REQUIRED_WORKSPACE_FILES = [
  WORKSPACE_FILE_NAMES.manifest,
  WORKSPACE_FILE_NAMES.usersPermissions,
  WORKSPACE_FILE_NAMES.sampleMaster,
  WORKSPACE_FILE_NAMES.sampleDistribution
] as const;

export const OPTIONAL_WORKSPACE_FILES = [
  WORKSPACE_FILE_NAMES.dataRaw,
  WORKSPACE_FILE_NAMES.dataProcessed
] as const;

export const REQUIRED_WORKSPACE_FOLDERS = [
  WORKSPACE_FILE_NAMES.employeeAnswersFolder,
  WORKSPACE_FILE_NAMES.systemFolder
] as const;

export const SYSTEM_SUBFOLDERS = [
  WORKSPACE_FILE_NAMES.locksFolder,
  WORKSPACE_FILE_NAMES.auditFolder,
  WORKSPACE_FILE_NAMES.backupsFolder
] as const;

export const TOP_LEVEL_DATA_FOLDERS = [
  WORKSPACE_FILE_NAMES.templatesFolder
] as const;

export function createWorkspaceId(): string {
  return `xray-workspace-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

export function createEmptyHash(): string {
  return "";
}

export function createMetadata(
  fileType: WorkspaceFileType,
  username: string,
  timestamp: string
): JsonFileMetadata {
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    fileType,
    revision: 1,
    createdAt: timestamp,
    createdBy: username,
    updatedAt: timestamp,
    updatedBy: username,
    contentHash: createEmptyHash()
  };
}

export function createEnvelope<TData>(
  fileType: WorkspaceFileType,
  username: string,
  data: TData,
  timestamp = new Date().toISOString()
): JsonEnvelope<TData> {
  return {
    metadata: createMetadata(fileType, username, timestamp),
    data
  };
}

export function createDefaultWorkspaceManifest(
  username: string,
  workspaceName = "X-Ray Quality Workspace"
): WorkspaceManifestFile {
  const timestamp = new Date().toISOString();

  return createEnvelope(
    "workspace.manifest",
    username,
    {
      workspaceId: createWorkspaceId(),
      workspaceName,
      files: {
        usersPermissions: WORKSPACE_FILE_NAMES.usersPermissions,
        dataRaw: WORKSPACE_FILE_NAMES.dataRaw,
        dataProcessed: WORKSPACE_FILE_NAMES.dataProcessed,
        sampleMaster: WORKSPACE_FILE_NAMES.sampleMaster,
        sampleDistribution: WORKSPACE_FILE_NAMES.sampleDistribution,
        employeeAnswersFolder: WORKSPACE_FILE_NAMES.employeeAnswersFolder,
        systemFolder: WORKSPACE_FILE_NAMES.systemFolder,
        locksFolder: WORKSPACE_FILE_NAMES.locksFolder,
        auditFolder: WORKSPACE_FILE_NAMES.auditFolder
      }
    },
    timestamp
  );
}

export function createDefaultUsersPermissions(
  username: string
): UsersPermissionsFile {
  return createEnvelope("users.permissions", username, {
    users: [],
    roles: [
      {
        id: "employee",
        label: "موظف",
        description: "صلاحيات تشغيلية محدودة حسب الصلاحيات الممنوحة.",
        isSystemRole: true
      },
      {
        id: "supervisor",
        label: "مشرف",
        description: "صلاحيات إشرافية لمراجعة ومتابعة العمل.",
        isSystemRole: true
      },
      {
        id: "admin",
        label: "إدارة",
        description: "صلاحيات إدارة النظام والمستخدمين والصلاحيات.",
        isSystemRole: true
      }
    ],
    permissions: []
  });
}

export function createDefaultRawData(username: string): RawDataFile {
  return createEnvelope("data.raw", username, {
    sourceFileName: null,
    importedAt: null,
    importedBy: null,
    records: []
  });
}

export function createDefaultProcessedData(username: string): ProcessedDataFile {
  return createEnvelope("data.processed", username, {
    processingBatchId: null,
    sourceRawRevision: null,
    processedAt: null,
    processedBy: null,
    rulesVersion: null,
    records: [],
    exclusions: [],
    validationMessages: []
  });
}

export function createDefaultSampleMaster(username: string): SampleMasterFile {
  return createEnvelope("sample.master", username, {
    sampleBatchId: null,
    sourceProcessedRevision: null,
    createdAt: null,
    createdBy: null,
    selectionMethod: null,
    records: []
  });
}

export function createDefaultSampleDistribution(
  username: string
): SampleDistributionFile {
  return createEnvelope("sample.distribution", username, {
    distributionBatchId: null,
    sampleBatchId: null,
    createdAt: null,
    createdBy: null,
    assignments: []
  });
}