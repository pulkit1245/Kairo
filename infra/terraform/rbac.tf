module "rbac" {
  source    = "../rbac"
  namespace = kubernetes_namespace_v1.kairo.metadata[0].name
}
