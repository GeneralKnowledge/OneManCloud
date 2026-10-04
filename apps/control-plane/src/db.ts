import type {
  ApplicationRecord,
  DeploymentRecord,
  DeploymentStatus,
  JobRecord,
  JobStatus,
  JobType,
  NodeRecord,
  NodeStatus,
} from "@omc/protocol";

export interface NodeRow {
  id: string;
  name: string;
  status: string;
  hostname: string | null;
  arch: string | null;
  cpu_count: number | null;
  memory_mb: number | null;
  disk_gb: number | null;
  agent_version: string | null;
  last_heartbeat_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface JobRow {
  id: string;
  type: string;
  application_id: string | null;
  node_id: string | null;
  status: string;
  payload_json: string;
  result_json: string | null;
  attempts: number;
  max_attempts: number;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  finished_at: number | null;
}

export interface AppRow {
  id: string;
  name: string;
  runtime: string;
  source_type: string;
  source_repo: string | null;
  source_image: string | null;
  source_args_json: string | null;
  memory_mb: number;
  cpu: number;
  public: number;
  sleep: number;
  created_at: number;
  updated_at: number;
}

export interface DeploymentRow {
  id: string;
  application_id: string;
  node_id: string | null;
  status: string;
  public_url: string | null;
  created_at: number;
  updated_at: number;
}

export function mapNode(row: NodeRow): NodeRecord {
  return {
    id: row.id,
    name: row.name,
    status: row.status as NodeStatus,
    hostname: row.hostname,
    arch: row.arch,
    cpuCount: row.cpu_count,
    memoryMb: row.memory_mb,
    diskGb: row.disk_gb,
    agentVersion: row.agent_version,
    lastHeartbeatAt: row.last_heartbeat_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapJob(row: JobRow): JobRecord {
  return {
    id: row.id,
    type: row.type as JobType,
    applicationId: row.application_id,
    nodeId: row.node_id,
    status: row.status as JobStatus,
    payloadJson: row.payload_json,
    resultJson: row.result_json,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export function mapApp(row: AppRow): ApplicationRecord & { sourceArgsJson: string | null } {
  return {
    id: row.id,
    name: row.name,
    runtime: row.runtime,
    sourceType: row.source_type,
    sourceRepo: row.source_repo,
    sourceImage: row.source_image,
    memoryMb: row.memory_mb,
    cpu: row.cpu,
    public: row.public === 1,
    sleep: row.sleep === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sourceArgsJson: row.source_args_json,
  };
}

export function mapDeployment(row: DeploymentRow): DeploymentRecord {
  return {
    id: row.id,
    applicationId: row.application_id,
    nodeId: row.node_id,
    status: row.status as DeploymentStatus,
    publicUrl: row.public_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getConfigValue(
  db: D1Database,
  key: string,
): Promise<string | null> {
  const row = await db
    .prepare("SELECT value FROM configuration WHERE key = ?")
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? null;
}

export async function setConfigValue(
  db: D1Database,
  key: string,
  value: string,
): Promise<void> {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO configuration (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(key, value, now)
    .run();
}

export function heartbeatTimeoutMs(env: Env): number {
  const raw = env.HEARTBEAT_TIMEOUT_SECONDS ?? "90";
  const seconds = Number(raw);
  return (Number.isFinite(seconds) && seconds > 0 ? seconds : 90) * 1000;
}

export async function markStaleNodesOffline(
  db: D1Database,
  timeoutMs: number,
): Promise<string[]> {
  const cutoff = Date.now() - timeoutMs;
  const stale = await db
    .prepare(
      `SELECT id FROM nodes
       WHERE status IN ('ONLINE', 'REGISTERING', 'DRAINING')
         AND (last_heartbeat_at IS NULL OR last_heartbeat_at < ?)`,
    )
    .bind(cutoff)
    .all<{ id: string }>();

  const ids = (stale.results ?? []).map((r) => r.id);
  if (ids.length === 0) return [];

  const now = Date.now();
  for (const id of ids) {
    await db
      .prepare(
        `UPDATE nodes SET status = 'OFFLINE', updated_at = ? WHERE id = ?`,
      )
      .bind(now, id)
      .run();
  }
  return ids;
}

export async function reclaimJobsForOfflineNodes(
  db: D1Database,
): Promise<number> {
  const now = Date.now();
  const stuck = await db
    .prepare(
      `SELECT j.id, j.attempts, j.max_attempts
       FROM jobs j
       JOIN nodes n ON n.id = j.node_id
       WHERE j.status IN ('DISPATCHED', 'RUNNING')
         AND n.status = 'OFFLINE'`,
    )
    .all<{ id: string; attempts: number; max_attempts: number }>();

  let count = 0;
  for (const job of stuck.results ?? []) {
    if (job.attempts >= job.max_attempts) {
      await db
        .prepare(
          `UPDATE jobs
           SET status = 'FAILED',
               result_json = ?,
               updated_at = ?,
               finished_at = ?
           WHERE id = ?`,
        )
        .bind(
          JSON.stringify({ error: "Node went offline" }),
          now,
          now,
          job.id,
        )
        .run();
    } else {
      await db
        .prepare(
          `UPDATE jobs
           SET status = 'QUEUED',
               node_id = NULL,
               updated_at = ?,
               started_at = NULL
           WHERE id = ?`,
        )
        .bind(now, job.id)
        .run();
    }
    count += 1;
  }
  return count;
}
