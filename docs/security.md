# Security model

## Operator authentication

A single administrator token is stored as the Cloudflare Workers secret
`OPERATOR_TOKEN`. The CLI sends it as `Authorization: Bearer …`.

Generate a long random value; do not commit it.

## Node authentication

Each node receives a unique token at registration. The control plane stores
only the SHA-256 hash. Tokens can be revoked (`POST /v1/nodes/:id/revoke`),
which disables the node.

## Jobs

Clients cannot submit arbitrary shell commands. Allowed job types are defined
in `@omc/protocol` (`noop`, `docker.pull|build|run|stop|rm`, `deploy`).

## Docker privileges

The node agent uses the Docker socket. That is effectively root on the host
for container operations. Run the agent as a dedicated user in the `docker`
group, keep the node token secret, and prefer Tunnel over opening public ports.

## Secrets

Use:

- Wrangler secrets / `.dev.vars` (gitignored) for the Worker
- `/etc/omc/agent.env` on nodes (mode 600)
- `~/.omc/config.json` for the CLI (mode 600)

Never put secrets in Git.
