# The kairo-platform service account and only the verbs Kairo uses (FR-68).
# Namespaces are cluster-wide and every app gets its own kairo-<slug>
# namespace, so this has to be a ClusterRole rather than a namespaced Role.
#
# Since P1 the backend runs as this account (M18): infra/scripts/kairo-kubeconfig.sh
# writes ~/.kube/kairo-platform.yaml from the long-lived token below.

variable "namespace" {
  description = "Namespace that holds the service account."
  type        = string
}

variable "monitoring_namespace" {
  description = "Namespace of Prometheus, where the alert-rules ConfigMap lives."
  type        = string
}

variable "rules_configmap" {
  description = "Name of the ConfigMap the backend writes each app's alert rules into."
  type        = string
}

resource "kubernetes_service_account_v1" "kairo_platform" {
  metadata {
    name      = "kairo-platform"
    namespace = var.namespace
  }
}

resource "kubernetes_cluster_role_v1" "kairo_platform" {
  metadata {
    name = "kairo-platform"
  }

  # one namespace per app, created on onboarding, deleted with the app (FR-29, FR-65)
  rule {
    api_groups = [""]
    resources  = ["namespaces"]
    verbs      = ["create", "delete"]
  }

  # create: first deploy (added to FR-68 on 10 Nov). get/list: status checks.
  # patch: rollout, rollback, scaling
  rule {
    api_groups = ["apps"]
    resources  = ["deployments"]
    verbs      = ["create", "get", "list", "patch"]
  }

  # delete = restart
  rule {
    api_groups = [""]
    resources  = ["pods"]
    verbs      = ["get", "list", "delete"]
  }

  rule {
    api_groups = [""]
    resources  = ["pods/log"]
    verbs      = ["get"]
  }

  # create: first deploy. patch: server-side apply on every later deploy (added in P1)
  rule {
    api_groups = [""]
    resources  = ["services"]
    verbs      = ["create", "patch"]
  }

  rule {
    api_groups = ["networking.k8s.io"]
    resources  = ["ingresses"]
    verbs      = ["create", "patch"]
  }
}

# The one ConfigMap Prometheus loads app alert rules from (P1, AQ6).
# A namespaced Role limited by name: nothing else in monitoring is reachable.
resource "kubernetes_role_v1" "alert_rules" {
  metadata {
    name      = "kairo-platform-alert-rules"
    namespace = var.monitoring_namespace
  }

  rule {
    api_groups     = [""]
    resources      = ["configmaps"]
    resource_names = [var.rules_configmap]
    verbs          = ["get", "patch"]
  }
}

resource "kubernetes_role_binding_v1" "alert_rules" {
  metadata {
    name      = "kairo-platform-alert-rules"
    namespace = var.monitoring_namespace
  }

  role_ref {
    api_group = "rbac.authorization.k8s.io"
    kind      = "Role"
    name      = kubernetes_role_v1.alert_rules.metadata[0].name
  }

  subject {
    kind      = "ServiceAccount"
    name      = kubernetes_service_account_v1.kairo_platform.metadata[0].name
    namespace = var.namespace
  }
}

# Long-lived token for the backend's kubeconfig. A token Secret never expires,
# unlike a TokenRequest token, so it can't run out mid-demo (agreed 10 Nov).
# The token ends up in the local Terraform state, which is gitignored.
resource "kubernetes_secret_v1" "kairo_platform_token" {
  metadata {
    name      = "kairo-platform-token"
    namespace = var.namespace
    annotations = {
      "kubernetes.io/service-account.name" = kubernetes_service_account_v1.kairo_platform.metadata[0].name
    }
  }
  type                           = "kubernetes.io/service-account-token"
  wait_for_service_account_token = true
}

resource "kubernetes_cluster_role_binding_v1" "kairo_platform" {
  metadata {
    name = "kairo-platform"
  }

  role_ref {
    api_group = "rbac.authorization.k8s.io"
    kind      = "ClusterRole"
    name      = kubernetes_cluster_role_v1.kairo_platform.metadata[0].name
  }

  subject {
    kind      = "ServiceAccount"
    name      = kubernetes_service_account_v1.kairo_platform.metadata[0].name
    namespace = var.namespace
  }
}

output "token_secret" {
  value = "${var.namespace}/${kubernetes_secret_v1.kairo_platform_token.metadata[0].name}"
}

output "service_account" {
  value = "${var.namespace}/${kubernetes_service_account_v1.kairo_platform.metadata[0].name}"
}
