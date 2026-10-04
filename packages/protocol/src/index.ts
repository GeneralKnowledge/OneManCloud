export const NODE_STATUSES = [
  "ONLINE",
  "OFFLINE",
  "DISABLED",
] as const;

export type NodeStatus = (typeof NODE_STATUSES)[number];

export const JOB_STATUSES = [
  "QUEUED",
  "DISPATCHED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_TYPES = [
  "noop",
  "docker.pull",
  "docker.build",
  "docker.run",
  "docker.stop",
  "docker.rm",
  "docker.logs",
  "deploy",
] as const;

export type JobType = (typeof JOB_TYPES)[number];

export const DEPLOYMENT_STATUSES = [
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "STOPPED",
] as const;

export type DeploymentStatus = (typeof DEPLOYMENT_STATUSES)[number];

export const AGENT_VERSION = "0.1.0";

export interface StatusResponse {
  name: string;
  controlPlane: "ONLINE" | "OFFLINE";
  database: "ONLINE" | "OFFLINE";
  nodes: NodeSummary[];
  applications: ApplicationSummary[];
  queuedJobs: number;
}

export interface NodeSummary {
  id: string;
  name: string;
  status: NodeStatus;
  arch: string | null;
  cpuCount: number | null;
  memoryMb: number | null;
  lastHeartbeatAt: number | null;
  runningApplications: string[];
}

export interface ApplicationSummary {
  id: string;
  name: string;
  status: string;
  public: boolean;
}

export interface NodeRecord {
  id: string;
  name: string;
  status: NodeStatus;
  hostname: string | null;
  arch: string | null;
  cpuCount: number | null;
  memoryMb: number | null;
  diskGb: number | null;
  agentVersion: string | null;
  lastHeartbeatAt: number | null;
  runningApplications: string[];
  createdAt: number;
  updatedAt: number;
}

export interface HeartbeatPayload {
  hostname: string;
  arch: string;
  cpuCount: number;
  memoryMb: number;
  diskGb: number;
  agentVersion: string;
  runningApplications?: string[];
}

export interface RegisterNodeRequest {
  name: string;
  hostname?: string;
  arch?: string;
  cpuCount?: number;
  memoryMb?: number;
  diskGb?: number;
  agentVersion?: string;
}

export interface RegisterNodeResponse {
  node: NodeRecord;
  token: string;
}

export interface JobRecord {
  id: string;
  type: JobType;
  applicationId: string | null;
  nodeId: string | null;
  status: JobStatus;
  payloadJson: string;
  resultJson: string | null;
  attempts: number;
  maxAttempts: number;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface CreateJobRequest {
  type: JobType;
  payload?: Record<string, unknown>;
  applicationId?: string;
  maxAttempts?: number;
}

export interface ApplicationRecord {
  id: string;
  name: string;
  runtime: string;
  sourceType: string;
  sourceRepo: string | null;
  sourceImage: string | null;
  memoryMb: number;
  cpu: number;
  public: boolean;
  port: number | null;
  env: Record<string, string>;
  createdAt: number;
  updatedAt: number;
}

export interface ApplicationConfig {
  name: string;
  runtime: "docker";
  source: {
    type: "github" | "image";
    repository?: string;
    image?: string;
    args?: string[];
  };
  compute?: {
    memory?: string;
    cpu?: number;
  };
  network?: {
    public?: boolean;
    /** Container port; published on the same host port for Tunnel replicas. */
    port?: number;
  };
  /** Plaintext env vars injected into the container (-e). Personal-use only. */
  env?: Record<string, string>;
}

export interface DeploymentRecord {
  id: string;
  applicationId: string;
  nodeId: string | null;
  status: DeploymentStatus;
  publicUrl: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface TunnelSuggestResponse {
  baseDomain: string | null;
  mode: "failover";
  ingress: Array<{
    app: string;
    hostname: string;
    service: string;
    port: number;
  }>;
  checklist: string[];
}
