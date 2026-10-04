# Oracle Always Free node

Oracle Cloud Always Free ARM VMs are an **optional** compute backend. The
control plane does not call the Oracle API; the VM simply runs the OneManCloud
agent.

## Steps

1. Create an Ubuntu ARM64 Always Free instance.
2. From your laptop (operator CLI), register the node and save the token:

```bash
omc node register --name oracle-arm
# prints OMC_NODE_TOKEN — save it
```

3. Clone this repository onto the VM (or copy a release tarball).
4. Run the installer as root with the **node** token (not the operator token):

```bash
export OMC_URL="https://api.your-domain.com"
export OMC_NODE_TOKEN="…"   # from omc node register
export OMC_NODE_NAME="oracle-arm"
sudo -E ./scripts/install-node.sh
```

5. Confirm:

```bash
omc nodes
# oracle-arm   ONLINE   arm64   …
```

## Safe script retrieval

Prefer:

```bash
git clone https://github.com/<you>/OneManCloud.git
cd OneManCloud
./scripts/install-node.sh
```

Avoid `| bash` from arbitrary URLs. If you host `install-node.sh`, pin a
release checksum.

## When Oracle is unavailable

The control plane and D1 keep working. Jobs requiring compute remain `QUEUED`
until any node (local or Oracle) comes online.
