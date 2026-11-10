# Kairo infrastructure

Everything runs on one MacBook (8 GB RAM, Apple silicon) using Docker Desktop's built-in Kubernetes. Postgres runs as a plain Docker container next to the cluster, not inside it, so a cluster reset doesn't lose data.

| Folder | What it holds |
| --- | --- |
| `terraform/` | Installs the platform into the cluster: namespaces, Traefik, Prometheus, Alertmanager, kube-state-metrics, RBAC |
| `monitoring/` | Helm values for Prometheus and the Alertmanager config, read by Terraform |
| `rbac/` | The `kairo-platform` service account and its permissions, read by Terraform |

## 1. Docker Desktop (once)

In Docker Desktop's Settings:

1. **Resources → Advanced:** 4 CPUs, 5 GB memory. Put the disk image on the external SSD (ours is `/Volumes/DockerDisk/Docker/DockerDesktop`) with an 80 GB disk limit. Apply & restart. Changing the disk image location or limit wipes Docker's data, including the `kairo-db` container.
2. **Kubernetes:** turn on Enable Kubernetes and pick the **kubeadm** provisioner. Apply & restart.

Then check:

```bash
kubectl config use-context docker-desktop
kubectl get nodes          # one node, docker-desktop, Ready
docker info --format '{{.NCPU}} CPUs, {{.MemTotal}} bytes'
```

Why these numbers: the cluster, the platform pods, up to 3 user apps, Postgres and image builds all share Docker Desktop's VM. 5 GB leaves about 3 GB for macOS, the backend, Vite and the tunnels. With kubeadm the cluster uses Docker's own engine, so images built on the Mac are visible to the cluster without a registry.

## 2. Postgres

```bash
docker run -d --name kairo-db --restart unless-stopped -p 5432:5432 \
  -e POSTGRES_USER=kairo -e POSTGRES_PASSWORD=kairo -e POSTGRES_DB=kairo postgres:16
```

Then create the tables from `backend/`: `npx prisma migrate deploy`.

## 3. The platform (Terraform)

```bash
cd infra/terraform
terraform init
terraform plan -out=p0.tfplan     # read it: 8 to add on a fresh cluster
terraform apply p0.tfplan
```

It installs, into the `docker-desktop` context only:

| Namespace | What runs there |
| --- | --- |
| `kairo` | The `kairo-platform` service account (`infra/rbac/`), bound to a ClusterRole with the FR-68 verbs |
| `traefik` | Traefik 3 (chart `traefik/traefik` 42.1.3), a LoadBalancer on `localhost:80`, default ingress class, Prometheus metrics on :9100 |
| `monitoring` | Prometheus with 1-day retention, Alertmanager and kube-state-metrics (chart `prometheus-community/prometheus` 29.37.2). No Grafana, no node-exporter, no pushgateway |

User apps get their own `kairo-<slug>` namespaces from the backend, which is why the platform namespaces don't start with `kairo-`.

Alertmanager sends every alert to `http://host.docker.internal:4000/api/alerts`, the backend on the Mac (`alert_webhook_url` variable). Pods can resolve `host.docker.internal` on Docker Desktop.

The backend reaches Prometheus through a port-forward (Traefik doesn't need one):

```bash
kubectl -n monitoring port-forward svc/prometheus-server 9090:80
```

Remove everything with `terraform plan -destroy -out=destroy.tfplan` and `terraform apply destroy.tfplan`. Nothing is left behind: Prometheus and Alertmanager use `emptyDir`, so there are no volume claims, and Traefik is installed without its CRDs (`skip_crds`), which Helm would otherwise leave behind on uninstall.

### Checks

```bash
kubectl get pods -A                                # traefik and monitoring pods Running
curl -i http://localhost/                          # 404 from Traefik = it answers
kubectl auth can-i create deployments -n kairo-apps --as=system:serviceaccount:kairo:kairo-platform
```

### Docker Desktop quirk: per-pod metrics

On Docker Desktop's Docker-engine runtime, kubelet's cAdvisor endpoint labels series only by cgroup path, with no `namespace`, `pod` or `container`. Prometheus scrapes kubelet's `/metrics/resource` endpoint instead (`kubernetes-nodes-resource` job), which has the same metric names (`container_memory_working_set_bytes`, `container_cpu_usage_seconds_total`) with proper labels.
