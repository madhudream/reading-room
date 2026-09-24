#!/usr/bin/env bash
# Forward TwinDB on twindb-1 (no public IP) to localhost:18093 through IAP, reconnecting forever.
# Needs: gcloud logged in to project all-madhu, and the twindb-allow-iap-ssh firewall rule (tcp:22 from 35.235.240.0/20).
set -u
PORT="${TUNNEL_PORT:-18093}"
while true; do
  echo "[tunnel] localhost:$PORT -> twindb-1:8080 ($(date +%H:%M:%S))"
  gcloud compute ssh twindb-1 --project all-madhu --zone us-central1-a --tunnel-through-iap --quiet -- \
    -N -L "$PORT:localhost:8080" -o ExitOnForwardFailure=yes -o ServerAliveInterval=20 -o ServerAliveCountMax=3 2>&1 | grep -v NumPy | grep -v increasing_the_tcp
  echo "[tunnel] dropped; reconnecting in 2 s"; sleep 2
done
