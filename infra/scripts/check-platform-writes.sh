#!/usr/bin/env bash
# FR-68: what kairo-platform may write, checked with server-side dry runs
# (nothing is created, changed or deleted). Each line says ALLOWED or REFUSED
# and what was expected with the write policy in place
# (infra/rbac/admission.tf). Exits 1 if any line differs from that.
#
#   infra/scripts/check-platform-writes.sh            (context docker-desktop)
#   KUBE_CONTEXT=other infra/scripts/check-platform-writes.sh
set -u
CTX="${KUBE_CONTEXT:-docker-desktop}"
SA="system:serviceaccount:kairo:kairo-platform"
APP_NS="${APP_NS:-$(kubectl --context "$CTX" get ns -o name | sed -n 's#namespace/\(kairo-.*\)#\1#p' | head -1)}"
KS_POD="$(kubectl --context "$CTX" -n kube-system get pods -o name | head -1)"
bad=0

check() { # expected  label  kubectl args...
  local want="$1" label="$2"; shift 2
  local out got
  out="$(kubectl --context "$CTX" "$@" --dry-run=server 2>&1)" && got=ALLOWED || got=REFUSED
  local mark="ok"; [ "$got" = "$want" ] || { mark="UNEXPECTED"; bad=1; }
  printf '%-10s %-8s %-48s %s\n' "$mark" "$got" "$label" "$( [ "$got" = REFUSED ] && echo "$out" | head -1 | cut -c1-120)"
}

echo "== as kairo-platform: outside its namespaces (expect REFUSED)"
check REFUSED "delete a pod in kube-system" -n kube-system delete "$KS_POD" --as="$SA"
check REFUSED "create a Deployment in default" -n default create deployment p5c-probe --image=nginx --as="$SA"
check REFUSED "create a Service in kube-system" -n kube-system create service clusterip p5c-probe --tcp=80 --as="$SA"
check REFUSED "create a Service in kairo (platform)" -n kairo create service clusterip p5c-probe --tcp=80 --as="$SA"
check REFUSED "delete namespace kairo" delete namespace kairo --as="$SA"
check REFUSED "delete namespace default" delete namespace default --as="$SA"
check REFUSED "create namespace p5c-probe" create namespace p5c-probe --as="$SA"

echo "== as kairo-platform: what Kairo does (expect ALLOWED)"
check ALLOWED "create namespace kairo-p5c-probe" create namespace kairo-p5c-probe --as="$SA"
check ALLOWED "create a Deployment in $APP_NS" -n "$APP_NS" create deployment p5c-probe --image=nginx --as="$SA"
check ALLOWED "patch monitoring/kairo-alert-rules" -n monitoring patch configmap kairo-alert-rules --type=merge -p '{"metadata":{"labels":{"p5c-probe":"x"}}}' --as="$SA"

echo "== as admin (your kubeconfig; never evaluated by the policy, expect ALLOWED)"
check ALLOWED "create namespace p5c-probe" create namespace p5c-probe
check ALLOWED "delete a pod in kube-system" -n kube-system delete "$KS_POD"

exit $bad
