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

## ComputeProvider

Providers implement the OneManCloud **node protocol** (register, heartbeat,
poll jobs, report results). The first provider is a generic node agent that
works equally as `local` or `oracle-arm`. Future providers (Cloud Run, other
VPS) only need the same protocol.

## Not Coolify

Coolify/Dokploy run the control plane on the VPS. OneManCloud runs the control
plane on Cloudflare so the platform survives node loss.

## Security

- Single operator Bearer token (`OPERATOR_TOKEN` secret).
- Per-node tokens, hashed (SHA-256) in D1, revocable.
- Jobs are typed (`noop`, `docker.*`, `deploy`) — no remote shell API.
- Docker access on a node is privileged; document and minimize.

## Tunnel

Public apps are preferably exposed with Cloudflare Tunnel from the node to
`https://app.<base-domain>`. Tunnel is not required for internal jobs.
