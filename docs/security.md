# Security model

## Operator authentication

A single administrator token is stored as the Cloudflare Workers secret
`OPERATOR_TOKEN`. The CLI sends it as `Authorization: Bearer …`.

Generate a long random value; do not commit it.

**Never place `OPERATOR_TOKEN` on a compute node.** Compromising a node must
not grant full control-plane admin.

## Node authentication

Register nodes from the operator machine:

```bash
omc node register --name oracle-arm
# copy the one-time node token onto the VM as OMC_NODE_TOKEN
```

Each node receives a unique token at registration. The control plane stores
only the SHA-256 hash. Tokens can be revoked (`omc node revoke <id>`),
which disables the node.

Remote agents join with `OMC_URL` + `OMC_NODE_TOKEN` only (`GET /v1/nodes/me`).
`omc node local` may register using the local `~/.omc` operator config (same
trust boundary as the operator laptop).

## Jobs

Clients cannot submit arbitrary shell commands. Allowed job types are defined
in `@omc/protocol` (`noop`, `docker.pull|build|run|stop|rm|logs`, `deploy`).

## Docker privileges

The node agent uses the Docker socket. That is effectively root on the host
for container operations. Run the agent as a dedicated user in the `docker`
group, keep the node token secret, and prefer Tunnel over opening public ports.

## App env

`env` in app YAML is stored in D1 as plaintext JSON and passed to containers
as `-e`. Fine for personal use; do not put high-value secrets there without
additional controls.

## Secrets

Use:

- Wrangler secrets / `.dev.vars` (gitignored) for the Worker
- `/etc/omc/agent.env` on nodes (mode 600) — `OMC_URL` + `OMC_NODE_TOKEN` only
- `~/.omc/config.json` for the CLI (mode 600)

Never put secrets in Git.
