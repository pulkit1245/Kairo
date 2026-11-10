# Prometheus, Alertmanager and kube-state-metrics from one chart (FR-43).
# The plain prometheus chart, not kube-prometheus-stack: no operator and no
# Grafana, which matters inside a 5 GB VM.

# Each app's alert rules, one key per app (<slug>.rules.yml), written by the
# backend at deploy time (AQ6). Prometheus mounts this and reloads on change.
# Terraform only creates it: the backend owns the data, so changes are ignored.
resource "kubernetes_config_map_v1" "alert_rules" {
  metadata {
    name      = "kairo-alert-rules"
    namespace = kubernetes_namespace_v1.monitoring.metadata[0].name
    labels    = local.labels
  }
  data = {}

  lifecycle {
    ignore_changes = [data]
  }
}

# The webhook token as a file Alertmanager reads (credentials_file), so it
# never sits in the Helm values or Alertmanager's config.
resource "kubernetes_secret_v1" "alert_webhook_token" {
  metadata {
    name      = "kairo-alert-webhook-token"
    namespace = kubernetes_namespace_v1.monitoring.metadata[0].name
    labels    = local.labels
  }
  data = {
    token = var.alert_webhook_token
  }
}

resource "helm_release" "prometheus" {
  name       = "prometheus"
  namespace  = kubernetes_namespace_v1.monitoring.metadata[0].name
  repository = "https://prometheus-community.github.io/helm-charts"
  chart      = "prometheus"
  version    = "29.37.2"

  values = [
    templatefile("${path.module}/../monitoring/prometheus/values.yaml", {
      retention       = var.prometheus_retention
      rules_configmap = kubernetes_config_map_v1.alert_rules.metadata[0].name
    }),
    templatefile("${path.module}/../monitoring/alertmanager/values.yaml", {
      webhook_url  = var.alert_webhook_url
      token_secret = kubernetes_secret_v1.alert_webhook_token.metadata[0].name
    }),
  ]

  wait    = true
  timeout = 600
}
