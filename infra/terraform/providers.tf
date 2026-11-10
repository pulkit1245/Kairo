# Both providers talk to the same cluster through the local kubeconfig.
# The context is pinned so a stray `kubectl config use-context` can't point
# Terraform at some other cluster.

provider "kubernetes" {
  config_path    = var.kubeconfig_path
  config_context = var.kube_context
}

provider "helm" {
  kubernetes = {
    config_path    = var.kubeconfig_path
    config_context = var.kube_context
  }
}
