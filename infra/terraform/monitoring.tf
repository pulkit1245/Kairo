# Prometheus, Alertmanager and kube-state-metrics from one chart (FR-43).
# The plain prometheus chart, not kube-prometheus-stack: no operator and no
# Grafana, which matters inside a 5 GB VM.

resource "helm_release" "prometheus" {
  name       = "prometheus"
  namespace  = kubernetes_namespace_v1.monitoring.metadata[0].name
  repository = "https://prometheus-community.github.io/helm-charts"
  chart      = "prometheus"
  version    = "29.37.2"

  values = [
    templatefile("${path.module}/../monitoring/prometheus/values.yaml", {
      retention = var.prometheus_retention
    }),
    templatefile("${path.module}/../monitoring/alertmanager/values.yaml", {
      webhook_url = var.alert_webhook_url
    }),
  ]

  wait    = true
  timeout = 600
}
