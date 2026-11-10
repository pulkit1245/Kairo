# The kairo-platform service account and only the verbs Kairo uses (FR-68).
# Namespaces are cluster-wide and every app gets its own kairo-<slug>
# namespace, so this has to be a ClusterRole rather than a namespaced Role.
#
# Note: the backend still uses ~/.kube/config (admin) today, so these limits
# only bite once it runs with this account's token (architecture M18).

variable "namespace" {
  description = "Namespace that holds the service account."
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

  rule {
    api_groups = [""]
    resources  = ["services"]
    verbs      = ["create"]
  }

  rule {
    api_groups = ["networking.k8s.io"]
    resources  = ["ingresses"]
    verbs      = ["create"]
  }
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

output "service_account" {
  value = "${var.namespace}/${kubernetes_service_account_v1.kairo_platform.metadata[0].name}"
}
