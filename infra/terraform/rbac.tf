module "rbac" {
  source               = "../rbac"
  namespace            = kubernetes_namespace_v1.kairo.metadata[0].name
  monitoring_namespace = kubernetes_namespace_v1.monitoring.metadata[0].name
  rules_configmap      = kubernetes_config_map_v1.alert_rules.metadata[0].name
}
