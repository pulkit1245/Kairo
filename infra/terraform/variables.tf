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

variable "alert_webhook_token" {
  description = "Shared bearer token Alertmanager sends to /api/alerts (FR-45). Same value as ALERT_WEBHOOK_TOKEN in backend/.env. Kept in terraform.tfvars, which is gitignored."
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.alert_webhook_token) >= 32
    error_message = "Use at least 32 characters, e.g. openssl rand -hex 32."
  }
}

variable "prometheus_retention" {
  description = "How long Prometheus keeps data (FR-43)."
  type        = string
  default     = "1d"
}
