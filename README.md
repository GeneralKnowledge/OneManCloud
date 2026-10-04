# OneManCloud

A tiny **personal cloud control plane** assembled from free and inexpensive
infrastructure. It is designed for a single trusted operator — not multi-tenant
PaaS, not Kubernetes, not Coolify.

Cloudflare Workers + D1 are the foundation. Compute nodes (a laptop, an Oracle
Always Free ARM VM, …) are optional and disposable. If every node disappears,
the control plane still works; jobs that need compute stay `QUEUED`.

## What is OneManCloud?

OneManCloud is **not** a cheap VPS. It is a small always-on control plane that
registers nodes, queues jobs, and deploys Docker apps through an outbound-only
agent protocol.

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
                    | Worker + D1   |
                    | Control plane |
                    +-------+-------+
                            |
              +-------------+-------------+
              |                           |
              v                           v
        (no nodes OK)              Compute node
                                   outbound HTTPS
                                   Docker apps
```

## Zero-cost mode (no Oracle)

You can run usefully with only:

- Cloudflare Worker
- Cloudflare D1
- GitHub (this repo)
- A domain you already own (optional for later public apps)

```bash
pnpm install
pnpm dev          # local Worker + D1
pnpm omc login --url http://127.0.0.1:8787 --token dev-operator-token-change-me
pnpm omc status
```

Expected:

```
OneManCloud
Control Plane    ONLINE
Database         ONLINE
Nodes
  (none)
Applications
  (none)
Queued Jobs      0
```

## Local mode (with a compute node)

```bash
# terminal 1
pnpm dev

# terminal 2
pnpm omc login --url http://127.0.0.1:8787 --token dev-operator-token-change-me
pnpm omc node local --name local

# terminal 3
pnpm omc jobs create --type noop --payload '{"message":"ping"}'
pnpm omc jobs
pnpm omc logs <job-id>
```

Stop the node, create another job — it stays `QUEUED`. Start the node again —
it runs.

## Oracle mode

Oracle is capacity, not the foundation. See [docs/oracle.md](docs/oracle.md)
and `./scripts/install-node.sh`.

## Deploy a sample app

```bash
pnpm omc apps register --file examples/http-echo.omc.yaml
pnpm omc deploy http-echo
```

With a node online, the agent pulls/runs the image. Public exposure uses
Cloudflare Tunnel — see [docs/tunnel.md](docs/tunnel.md).

## Security model

- Single operator token (`OPERATOR_TOKEN`)
- Per-node tokens (hashed in D1, revocable)
- Typed jobs only — no remote shell API
- Docker on a node is privileged — see [docs/security.md](docs/security.md)

## Development

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm dev
```

No Oracle account is required for development or tests.

## Deploy the control plane

1. Copy `apps/control-plane/wrangler.example.jsonc` → adjust `database_id`.
2. Create D1: `pnpm --filter @omc/control-plane exec wrangler d1 create onemancloud`
3. Apply migrations: `wrangler d1 migrations apply DB --remote`
4. Set secret: `wrangler secret put OPERATOR_TOKEN`
5. Deploy: `pnpm --filter @omc/control-plane deploy`

Point `api.<your-domain>` (or a `workers.dev` URL) at the Worker. Configure
`base_domain` via `omc config set base_domain your.domain`.

## Repository layout

```
apps/control-plane   Cloudflare Worker (Hono + D1)
apps/cli             omc CLI
node/agent           outbound node agent
packages/protocol    shared statuses and types
packages/shared      hashing, ids, logging
packages/config      paths and defaults
database/migrations  D1 SQL
docs/                architecture, security, tunnel, oracle
```

## What we intentionally do not build

Multi-user accounts, billing, Kubernetes, dashboards (MVP), remote shell,
complex IAM, multi-region consensus, automatic cloud purchasing.

## License

MIT (see LICENSE if present; otherwise all rights reserved by the repository
owner until a license file is added).
