# Traefik is the only way into user apps (FR-23, FR-39). Docker Desktop binds
# a LoadBalancer Service to the Mac, so it answers on http://localhost:80.

resource "helm_release" "traefik" {
  name       = "traefik"
  namespace  = kubernetes_namespace_v1.traefik.metadata[0].name
  repository = "https://traefik.github.io/charts"
  chart      = "traefik"
  version    = "42.1.3"

  values = [file("${path.module}/../monitoring/traefik-values.yaml")]

  # Kairo only writes plain Ingress objects (the CRD provider is off in the
  # values), so don't install Traefik's 25 CRDs. Helm never deletes CRDs on
  # uninstall, so installing them would break "terraform destroy removes it" (FR-69)
  skip_crds = true

  wait    = true
  timeout = 300
}
