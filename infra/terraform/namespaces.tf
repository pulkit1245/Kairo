# Platform namespaces. User apps get kairo-<slug> from the backend (FR-29, P1),
# so these names deliberately don't start with "kairo-": a repo called
# "monitoring" would otherwise collide with kairo-monitoring.

locals {
  labels = {
    "app.kubernetes.io/managed-by" = "terraform"
    "kairo.dev/part-of"            = "platform"
  }
}

resource "kubernetes_namespace_v1" "kairo" {
  metadata {
    name   = "kairo" # the kairo-platform service account
    labels = local.labels
  }
}

resource "kubernetes_namespace_v1" "traefik" {
  metadata {
    name   = "traefik"
    labels = local.labels
  }
}

resource "kubernetes_namespace_v1" "monitoring" {
  metadata {
    name   = "monitoring" # Prometheus, Alertmanager, kube-state-metrics
    labels = local.labels
  }
}
