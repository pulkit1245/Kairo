output "namespaces" {
  value = {
    platform   = kubernetes_namespace_v1.kairo.metadata[0].name
    traefik    = kubernetes_namespace_v1.traefik.metadata[0].name
    monitoring = kubernetes_namespace_v1.monitoring.metadata[0].name
  }
}

output "alert_webhook_url" {
  value = var.alert_webhook_url
}

output "service_account" {
  value = module.rbac.service_account
}

output "prometheus_port_forward" {
  description = "Run this so the backend can query Prometheus on localhost:9090."
  value       = "kubectl -n monitoring port-forward svc/prometheus-server 9090:80"
}
