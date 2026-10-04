# Cloudflare Tunnel

Preferred public exposure path:

```
User → https://app.example.com → Cloudflare → Tunnel → Node → Docker container
```

Tunnel is **not** required for internal jobs (`noop`, private deploys).

## Manual setup (MVP)

1. Install `cloudflared` on the compute node.
2. Create a Tunnel in Cloudflare Zero Trust.
3. Add a public hostname, e.g. `http-echo.example.com` → `http://localhost:<published-port>`.
4. Set the OneManCloud base domain:

```bash
omc config set base_domain example.com
```

5. Inspect the tunnel model:

```bash
omc tunnel
```

## Automation

Where Cloudflare API automation is straightforward later, the control plane can
store tunnel metadata in the `configuration` table. The MVP keeps a clear
config model and documents manual steps rather than inventing a fragile API
wrapper.
