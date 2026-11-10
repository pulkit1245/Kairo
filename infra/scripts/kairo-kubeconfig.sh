#!/usr/bin/env bash
# Writes a kubeconfig for the kairo-platform service account, for the backend
# (M18). It uses the long-lived token in Secret kairo/kairo-platform-token,
# which Terraform creates, so it never expires mid-demo.
#
#   infra/scripts/kairo-kubeconfig.sh            -> ~/.kube/kairo-platform.yaml
#   infra/scripts/kairo-kubeconfig.sh <path>     -> <path>
#
# Then set KUBECONFIG=<that path> in backend/.env.
# The token goes straight from kubectl into the file; it is never printed.
# Run it again after a cluster reset or a terraform destroy/apply, since
# both create a new token.
set -euo pipefail

OUT="${1:-$HOME/.kube/kairo-platform.yaml}"
CONTEXT="docker-desktop"
NAMESPACE="kairo"
SECRET="kairo-platform-token"

server=$(kubectl config view --raw --minify --context "$CONTEXT" -o jsonpath='{.clusters[0].cluster.server}')
if [ -z "$server" ]; then
  echo "No server found for context $CONTEXT. Is Docker Desktop's Kubernetes running?" >&2
  exit 1
fi

if ! kubectl --context "$CONTEXT" -n "$NAMESPACE" get secret "$SECRET" >/dev/null 2>&1; then
  echo "Secret $NAMESPACE/$SECRET not found. Run terraform apply in infra/terraform first." >&2
  exit 1
fi

umask 077
mkdir -p "$(dirname "$OUT")"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

ca=$(kubectl --context "$CONTEXT" -n "$NAMESPACE" get secret "$SECRET" -o jsonpath='{.data.ca\.crt}')

{
  cat <<EOF
apiVersion: v1
kind: Config
clusters:
  - name: docker-desktop
    cluster:
      server: $server
      certificate-authority-data: $ca
users:
  - name: kairo-platform
    user:
      token: $(kubectl --context "$CONTEXT" -n "$NAMESPACE" get secret "$SECRET" -o jsonpath='{.data.token}' | base64 -d)
contexts:
  - name: kairo-platform
    context:
      cluster: docker-desktop
      user: kairo-platform
current-context: kairo-platform
EOF
} > "$tmp"

mv "$tmp" "$OUT"
chmod 600 "$OUT"
trap - EXIT
echo "Wrote $OUT (kairo-platform, server $server). Set KUBECONFIG=$OUT in backend/.env."
