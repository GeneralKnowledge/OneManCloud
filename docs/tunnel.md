# Cloudflare Tunnel (free failover)

Preferred public exposure path:

```
User → https://app.example.com → Cloudflare → Tunnel replica → healthy node → Docker
```

Tunnel is **not** required for internal jobs (`noop`, private deploys).

## Failover mode (free)

OneManCloud deploys a container replica onto **every ONLINE node**.
Routing uses **Cloudflare Tunnel replicas**: install the *same* tunnel on
Oracle, a home PC, etc. If one machine dies, Cloudflare continues serving
traffic through another healthy `cloudflared` connector.

This stays on the free Cloudflare Tunnel model. It is **not** paid Cloudflare
Load Balancing (no latency-based steering). Cloudflare picks a live replica.

```
                 app.example.com
                        |
                        v
                 Cloudflare Edge
                        |
         +--------------+--------------+
         |                             |
         v                             v
   cloudflared                   cloudflared
   (Oracle ARM)                  (home PC)
         |                             |
         v                             v
   docker omc-app                docker omc-app
   localhost:PORT                localhost:PORT
```

Both connectors must advertise the **same hostname → localhost:PORT** mapping.
`omc deploy` publishes that port consistently on each node (`network.port` in
the app config).

## Setup

1. Create **one** Tunnel in Cloudflare Zero Trust (free).
2. Add a public hostname, e.g. `http-echo.example.com` → `http://localhost:5678`.
3. On **each** compute node, install `cloudflared` and run that **same** tunnel
   (dashboard install command / token). These are tunnel **replicas**.
4. Set the OneManCloud base domain and app port:

```bash
omc config set base_domain example.com
# in app yaml: network.public: true, network.port: 5678
omc apps register --file examples/http-echo.omc.yaml
omc deploy http-echo
```

5. Inspect the model:

```bash
omc tunnel
```

6. When you add a new node later, run `omc deploy <app>` again so a replica is
   placed on the new ONLINE node, then ensure `cloudflared` is running there too.

## Port convention

Set `network.port` to the container listen port. OneManCloud publishes
`hostPort:containerPort` with the same number on every node so Tunnel ingress
stays identical across replicas.

## What we intentionally do not use (yet)

- Cloudflare Load Balancing (paid) for active-active steering
- Per-node different hostnames
- Automatic Cloudflare API tunnel provisioning (document first; automate later)
