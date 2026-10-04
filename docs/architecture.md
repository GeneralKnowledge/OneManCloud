# OneManCloud Architecture

OneManCloud is a **personal cloud control plane**. Persistent state lives in
Cloudflare D1. Compute nodes (local laptop, Oracle Always Free ARM, etc.) are
disposable and talk **outbound HTTPS only** to the Worker.

```
                         INTERNET
                            |
                            v
                    +---------------+
                    |   Cloudflare  |
                    | DNS / HTTPS   |
                    +-------+-------+
                            |
                            v
                    +---------------+
                    | Cloudflare    |
                    | Worker        |
                    | Control API   |
                    +-------+-------+
                            |
                 +----------+----------+
                 |                     |
                 v                     v
          +-------------+       +-------------+
          | Cloudflare  |       | Compute     |
          | D1          |       | Nodes       |
          | metadata    |       | (optional)  |
          +-------------+       +-------------+
                                      |
                                      v
                              +---------------+
                              | Docker / Apps |
                              +---------------+
```

## Principles

1. Prefer free infrastructure.
2. Keep persistent state outside compute.
3. Treat compute as disposable.
4. Oracle is optional capacity — never required for the control plane.
5. With zero nodes, jobs stay `QUEUED`.

## Node protocol

Every compute node speaks the same outbound protocol: register (operator, from
laptop), join with a node token (`GET /v1/nodes/me`), heartbeat, poll jobs,
report results. Local and Oracle hosts use the identical agent.

## Not Coolify

Coolify/Dokploy run the control plane on the VPS. OneManCloud runs the control
plane on Cloudflare so the platform survives node loss.

## Failover (free)

`omc deploy` fans out one replica job per ONLINE node. Public routing uses
Cloudflare Tunnel **replicas** (same tunnel UUID on each host) — free failover,
not paid Load Balancing. See `docs/tunnel.md`.

## Security

- Single operator Bearer token (`OPERATOR_TOKEN` secret) — laptop / CLI only.
- Per-node tokens, hashed (SHA-256) in D1, revocable. Nodes never store the operator token.
- Jobs are typed (`noop`, `docker.*`, `deploy`) — no remote shell API.
- Docker access on a node is privileged; document and minimize.

## Tunnel

Public apps are preferably exposed with Cloudflare Tunnel from the node to
`https://app.<base-domain>`. Use `omc tunnel` for concrete ingress lines.
Tunnel is not required for internal jobs.

## App lifecycle

- `omc apps register` — store image/github + env + port
- `omc deploy <app> [--wait]` — fan-out deploy jobs
- `omc apps logs <app>` — `docker logs` via a job on a node
- `omc stop <app>` — fan-out `docker.rm`, mark deployments STOPPED

Scale-to-zero / sleep is **not** implemented; omit it from app YAML.
