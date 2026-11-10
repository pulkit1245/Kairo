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
