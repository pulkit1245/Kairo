# FR-68, P5c: RBAC can't say "only in namespaces named kairo-*", so the
# ClusterRole above lets kairo-platform create and delete any namespace and
# delete pods, and create or patch Deployments, Services and Ingresses, in
# every namespace, kube-system included. This admission policy narrows its
# writes to what Kairo really does:
#   - namespaces named kairo-<app> (create and delete), never its own `kairo`
#     namespace, which `kairo-` doesn't match, nor any other
#   - anything inside a kairo-<app> namespace
#   - the one alert-rules ConfigMap in monitoring
# Reads are untouched, and so is the Prometheus port-forward (a CONNECT,
# allowed by RBAC in monitoring only).
#
# It matches ONLY requests made as kairo-platform (matchConditions on the
# username): an admin kubeconfig, Terraform and the cluster's own components
# are never evaluated by it.
#
# Switch it off at once, if it ever blocks Kairo:
#   kubectl delete validatingadmissionpolicybinding kairo-platform-writes
# (terraform apply puts it back).

locals {
  platform_user = "system:serviceaccount:${var.namespace}:${kubernetes_service_account_v1.kairo_platform.metadata[0].name}"
  app_ns_prefix = "kairo-"
  writes_policy = "kairo-platform-writes"
}

resource "kubernetes_manifest" "kairo_platform_writes" {
  manifest = {
    apiVersion = "admissionregistration.k8s.io/v1"
    kind       = "ValidatingAdmissionPolicy"
    metadata = {
      name = local.writes_policy
    }
    spec = {
      failurePolicy = "Fail"
      matchConstraints = {
        resourceRules = [{
          apiGroups   = ["*"]
          apiVersions = ["*"]
          operations  = ["CREATE", "UPDATE", "DELETE"]
          # every resource and every subresource (e.g. deployments/scale)
          resources = ["*/*"]
        }]
      }
      # only kairo-platform's own requests are looked at
      matchConditions = [{
        name       = "kairo-platform-only"
        expression = "request.userInfo.username == '${local.platform_user}'"
      }]
      variables = [
        {
          name       = "isNamespace"
          expression = "request.resource.group == '' && request.resource.resource == 'namespaces'"
        },
        {
          # the namespace's own name when the request is about a namespace
          name       = "nsName"
          expression = "request.operation == 'DELETE' ? oldObject.metadata.name : object.metadata.name"
        },
      ]
      validations = [{
        expression = join(" ", [
          "variables.isNamespace",
          "? variables.nsName.startsWith('${local.app_ns_prefix}')",
          ": request.namespace.startsWith('${local.app_ns_prefix}')",
          "|| (request.namespace == '${var.monitoring_namespace}' && request.resource.resource == 'configmaps' && request.name == '${var.rules_configmap}')",
        ])
        messageExpression = "'kairo-platform may only change ${local.app_ns_prefix}<app> namespaces and the ${var.rules_configmap} ConfigMap; refused ' + request.operation + ' ' + request.resource.resource + (variables.isNamespace ? ' ' + variables.nsName : ' in ' + request.namespace)"
        reason            = "Forbidden"
      }]
    }
  }
}

resource "kubernetes_manifest" "kairo_platform_writes_binding" {
  manifest = {
    apiVersion = "admissionregistration.k8s.io/v1"
    kind       = "ValidatingAdmissionPolicyBinding"
    metadata = {
      name = local.writes_policy
    }
    spec = {
      policyName        = local.writes_policy
      validationActions = ["Deny"]
    }
  }

  depends_on = [kubernetes_manifest.kairo_platform_writes]
}

output "writes_policy_off" {
  description = "Switches the kairo-platform write policy off at once (terraform apply puts it back)."
  value       = "kubectl delete validatingadmissionpolicybinding ${local.writes_policy}"
}
