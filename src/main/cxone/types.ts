import type { DependencyPathNode } from "@shared/types";

export interface CxProject {
  id: string;
  name: string;
  mainBranch?: string;
  repoUrl?: string;
  tags?: Record<string, string>;
}

export interface CxScan {
  id: string;
  status: string;
  positionInQueue?: number;
  engines?: string[];
  completedEngines?: string[];
  effectiveConfigFingerprint?: string;
  statusDetails?: { name?: string; status?: string; details?: string; errorCode?: string };
  branch?: string;
  createdAt?: string;
  updatedAt?: string;
  projectId?: string;
  projectName?: string;
  sourceOrigin?: string;
  tags?: Record<string, string>;
}

export interface CxScanSummary {
  scanId?: string;
  scans?: { scanId: string; [k: string]: unknown }[];
  high?: number;
  medium?: number;
  low?: number;
  info?: number;
  critical?: number;
  [k: string]: unknown;
}

export interface CxResultNode {
  id?: string;
  line?: number;
  column?: number;
  name?: string;
  fileName?: string;
  fullName?: string;
  method?: string;
  typeName?: string;
}

export interface CxResult {
  id: string;
  type: string;
  label?: string;
  similarityId?: string;
  status?: string;
  state?: string;
  severity?: string;
  created?: string;
  description?: string;
  descriptionHTML?: string;
  comments?: unknown;
  vulnerabilityDetails?: {
    cweId?: string | number;
    cveName?: string;
    cvssScore?: number;
    compliances?: string[];
  };
  data?: {
    queryName?: string;
    group?: string;
    languageName?: string;
    nodes?: CxResultNode[];
    redundancy?: "fix" | "redundant";
    scaType?: string;
    packageIdentifier?: { name?: string; version?: string; packageManager?: string };
    recommendedVersion?: string;
    scaPackageData?: {
      dependencyPaths?: DependencyPathNode[][];
      isDirectDependency?: boolean;
      typeOfDependency?: string;
      fixLink?: string;
      locations?: { path?: string; line?: number }[];
    };
    line?: number;
    filename?: string;
    platform?: string;
  };
}
