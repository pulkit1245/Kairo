variable "kube_context" {
  description = "kubeconfig context to install into. Docker Desktop's built-in cluster."
  type        = string
  default     = "docker-desktop"
}

variable "kubeconfig_path" {
  description = "Path to the kubeconfig file."
  type        = string
  default     = "~/.kube/config"
}

variable "alert_webhook_url" {
  description = "Where Alertmanager sends alerts: the backend on the Mac, reached from inside the cluster."
  type        = string
  default     = "http://host.docker.internal:4000/api/alerts"
}

variable "prometheus_retention" {
  description = "How long Prometheus keeps data (FR-43)."
  type        = string
  default     = "1d"
}
