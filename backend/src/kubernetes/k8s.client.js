import * as k8s from '@kubernetes/client-node';

// Lazy so the api can still boot on a machine with no kubeconfig at all
// (frontend devs running the backend locally, CI, etc.)
let kc;

function kubeConfig() {
  if (!kc) {
    kc = new k8s.KubeConfig();
    // ~/.kube/config locally, service account token when running inside the cluster
    kc.loadFromDefault();
  }
  return kc;
}

export function coreApi() {
  return kubeConfig().makeApiClient(k8s.CoreV1Api);
}

export function appsApi() {
  return kubeConfig().makeApiClient(k8s.AppsV1Api);
}

export async function pingCluster(timeoutMs = 2000) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
  });

  try {
    const version = kubeConfig().makeApiClient(k8s.VersionApi).getCode();
    await Promise.race([version, timeout]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// deleting the pod is how we "restart" it - the Deployment's ReplicaSet
// notices it's one short and schedules a fresh one straight away
export async function deletePod(namespace, name) {
  await coreApi().deleteNamespacedPod({ name, namespace });
}
