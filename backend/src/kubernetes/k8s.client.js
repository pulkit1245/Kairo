import * as k8s from '@kubernetes/client-node';

// The one place that talks to the Kubernetes API.
// Credentials come from KUBECONFIG (the kairo-platform service account since P1,
// M18), else ~/.kube/config. Everything Kairo does here must fit the FR-68
// RBAC in infra/rbac/main.tf.

// Lazy so the api can still boot on a machine with no kubeconfig at all
let kc;

function kubeConfig() {
  if (!kc) {
    kc = new k8s.KubeConfig();
    kc.loadFromDefault();
  }
  return kc;
}

// After a cluster reset (new certificates) or a new token, the cached config is
// stale and every call fails until a restart. Dropping it makes the next call
// read the kubeconfig file again.
export function resetClient() {
  kc = undefined;
}

// API errors (404, 409, 403...) are real answers, keep them. Anything else
// (TLS error, refused connection) or a 401 may be a stale config: reload it
// and try once more.
function isStaleConfigError(err) {
  if (err instanceof k8s.ApiException) return err.code === 401;
  return true;
}

async function call(fn) {
  try {
    return await fn(kubeConfig());
  } catch (err) {
    if (!isStaleConfigError(err)) throw err;
    resetClient();
    return fn(kubeConfig());
  }
}

export const isNotFound = (err) => err instanceof k8s.ApiException && err.code === 404;
const isConflict = (err) => err instanceof k8s.ApiException && err.code === 409;

// readable message for logs and pipeline failures, without dumping the whole body
export function k8sErrorMessage(err) {
  if (err instanceof k8s.ApiException) {
    let detail = '';
    try {
      detail = (typeof err.body === 'string' ? JSON.parse(err.body) : err.body)?.message ?? '';
    } catch {
      detail = String(err.body ?? '');
    }
    return `Kubernetes API ${err.code}${detail ? `: ${detail}` : ''}`;
  }
  return err instanceof Error ? err.message : String(err);
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
    const version = call((c) => c.makeApiClient(k8s.VersionApi).getCode());
    await Promise.race([version, timeout]);
    return true;
  } catch {
    // next call reads the kubeconfig again, so a reset cluster comes back by itself
    resetClient();
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// deleting the pod is how we "restart" it - the Deployment's ReplicaSet
// notices it's one short and schedules a fresh one straight away
export async function deletePod(namespace, name) {
  await call((c) => c.makeApiClient(k8s.CoreV1Api).deleteNamespacedPod({ name, namespace }));
}

// Creates the app's namespace. Already there (a redeploy) is fine.
export async function ensureNamespace(name, labels = {}) {
  try {
    await call((c) =>
      c.makeApiClient(k8s.CoreV1Api).createNamespace({ body: { metadata: { name, labels } } }),
    );
    return 'created';
  } catch (err) {
    if (isConflict(err)) return 'exists';
    throw err;
  }
}

// Server-side apply: creates each object or updates it to match, and records
// Kairo as the owner of the fields it set. Same call for first deploy and redeploy.
export async function applyObjects(objects) {
  const applied = [];
  for (const obj of objects) {
    applied.push(
      await call((c) =>
        k8s.KubernetesObjectApi.makeApiClient(c).patch(
          obj,
          undefined,
          undefined,
          'kairo',
          true,
          k8s.PatchStrategy.ServerSideApply,
        ),
      ),
    );
  }
  return applied;
}

// Waits until every replica of the Deployment runs the newest template and is
// ready. Returns { ready: true } or { ready: false, detail } where detail says
// what the pods were stuck on (e.g. "CrashLoopBackOff"), for the failure message.
export async function waitForRollout(namespace, name, { timeoutMs = 180_000, intervalMs = 2000 } = {}) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const d = await call((c) =>
      c.makeApiClient(k8s.AppsV1Api).readNamespacedDeployment({ name, namespace }),
    );
    const want = d.spec?.replicas ?? 1;
    const s = d.status ?? {};
    const current = (s.observedGeneration ?? 0) >= (d.metadata?.generation ?? 1);
    if (current && (s.updatedReplicas ?? 0) === want && (s.readyReplicas ?? 0) === want && (s.replicas ?? 0) === want) {
      return { ready: true };
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  return { ready: false, detail: await podTrouble(namespace, name) };
}

// FR-72's check at the end of a grace window: every desired replica runs this
// image and is ready. Returns { ready: true } or { ready: false, detail }.
export async function releaseReady(namespace, name, image) {
  const d = await call((c) => c.makeApiClient(k8s.AppsV1Api).readNamespacedDeployment({ name, namespace }));
  const want = d.spec?.replicas ?? 1;
  const s = d.status ?? {};
  const running = d.spec?.template?.spec?.containers?.find((c) => c.name === name)?.image;
  if (running !== image) return { ready: false, detail: `the Deployment runs ${running ?? 'nothing'}, not this release` };
  if ((s.observedGeneration ?? 0) < (d.metadata?.generation ?? 1)) return { ready: false, detail: 'a rollout is still going' };
  const ready = (s.readyReplicas ?? 0) === want && (s.updatedReplicas ?? 0) === want && (s.replicas ?? 0) === want;
  if (ready) return { ready: true };
  return { ready: false, detail: (await podTrouble(namespace, name)) ?? `${s.readyReplicas ?? 0} of ${want} replicas ready` };
}

// The most telling reason a pod isn't ready: a waiting reason (CrashLoopBackOff,
// ErrImageNeverPull...), else the last termination reason, else "not ready".
async function podTrouble(namespace, app) {
  try {
    const pods = await call((c) =>
      c.makeApiClient(k8s.CoreV1Api).listNamespacedPod({ namespace, labelSelector: `app=${app}` }),
    );
    for (const pod of pods.items) {
      for (const cs of pod.status?.containerStatuses ?? []) {
        if (cs.state?.waiting?.reason) return cs.state.waiting.reason;
        if (cs.lastState?.terminated?.reason) return `last exit: ${cs.lastState.terminated.reason}`;
      }
      if (pod.status?.phase === 'Pending') return 'pod is Pending';
    }
    return pods.items.length ? 'not ready' : 'no pods';
  } catch {
    return null;
  }
}

// Deployments Kairo manages that have pods, across all namespaces (FR-9).
export async function listRunningApps() {
  const list = await call((c) =>
    c.makeApiClient(k8s.AppsV1Api).listDeploymentForAllNamespaces({
      labelSelector: 'app.kubernetes.io/managed-by=kairo',
    }),
  );
  return list.items
    .filter((d) => (d.status?.replicas ?? 0) > 0)
    .map((d) => ({ namespace: d.metadata.namespace, name: d.metadata.name }));
}

// Each app's alert rules are one key in monitoring/kairo-alert-rules (AQ6).
// A merge patch only touches this app's key.
export const ALERT_RULES_CONFIGMAP = { namespace: 'monitoring', name: 'kairo-alert-rules' };

export async function putAlertRules(slug, content) {
  await call((c) =>
    k8s.KubernetesObjectApi.makeApiClient(c).patch(
      {
        apiVersion: 'v1',
        kind: 'ConfigMap',
        metadata: { ...ALERT_RULES_CONFIGMAP },
        data: { [`${slug}.rules.yml`]: content },
      },
      undefined,
      undefined,
      'kairo',
      undefined,
      k8s.PatchStrategy.MergePatch,
    ),
  );
}
