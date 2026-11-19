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

// FR-65: deleting the namespace removes everything in it (Deployment,
// Service, Ingress, pods). Kubernetes finishes it in the background; already
// gone is fine. Returns 'deleting' or 'gone'.
export async function deleteNamespace(name) {
  try {
    await call((c) => c.makeApiClient(k8s.CoreV1Api).deleteNamespace({ name }));
    return 'deleting';
  } catch (err) {
    if (isNotFound(err)) return 'gone';
    throw err;
  }
}

// How many pods are left in a namespace; 0 once it is gone. FR-68 lets
// kairo-platform list pods but not read namespaces, so this is how Kairo
// knows a deleted app's containers have stopped
export async function podCount(namespace) {
  const pods = await call((c) => c.makeApiClient(k8s.CoreV1Api).listNamespacedPod({ namespace }));
  return pods.items.length;
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

// The most telling reason a pod isn't ready, for a run that fails at
// DEPLOYING and for FR-72's check. A failing health check shows only as a pod
// event (the container itself looks fine, or "Completed" after the kubelet
// restarted it), so the events are read too. If they can't be read (no RBAC
// for events yet, an API error), the pod's own state is used, as before P5f.
async function podTrouble(namespace, app) {
  let pods;
  try {
    pods = await call((c) =>
      c.makeApiClient(k8s.CoreV1Api).listNamespacedPod({ namespace, labelSelector: `app=${app}` }),
    );
  } catch {
    return null;
  }
  let events = [];
  try {
    const list = await call((c) => c.makeApiClient(k8s.CoreV1Api).listNamespacedEvent({ namespace }));
    events = list.items ?? [];
  } catch {
    // no events: the pod's state alone
  }
  return troubleFrom(pods.items ?? [], events);
}

// pulling or starting the container went wrong: no health check ran at all
const START_FAILURES = new Set([
  'ErrImagePull', 'ImagePullBackOff', 'ErrImageNeverPull', 'InvalidImageName',
  'CreateContainerConfigError', 'CreateContainerError', 'RunContainerError',
]);
// exit codes of a container the kubelet stopped (0 after a clean SIGTERM,
// 143 = SIGTERM, 137 = SIGKILL at the end of the grace period), not of a crash
const STOPPED_BY_KUBELET = new Set([0, 137, 143]);

/**
 * A kubelet "Unhealthy" event message in plain words, or null if it isn't a
 * probe failure. Messages look like "Readiness probe failed: HTTP probe failed
 * with statuscode: 400" or "Liveness probe failed: Get "http://…": dial tcp
 * …: connect: connection refused".
 */
export function probeFailureText(message) {
  const m = /^(Readiness|Liveness|Startup) probe failed: (.*)$/s.exec(String(message ?? '').trim());
  if (!m) return null;
  const why = m[2];
  const status = /statuscode: (\d{3})/.exec(why);
  if (status) return `Health check got HTTP ${status[1]} from the app`;
  if (/connection refused/.test(why)) return "Health check couldn't connect: nothing is listening on the app's port";
  if (/deadline exceeded|timeout/i.test(why)) return "Health check timed out: the app didn't answer in time";
  if (/connection reset|EOF|broken pipe/.test(why)) return 'The app closed the health check connection without answering';
  if (/no route to host|network is unreachable/.test(why)) return "Health check couldn't reach the pod";
  return `Health check failed: ${why.replace(/\s+/g, ' ').slice(0, 160)}`;
}

const eventTime = (e) => Date.parse(e.lastTimestamp ?? e.eventTime ?? e.series?.lastObservedTime ?? e.firstTimestamp ?? e.metadata?.creationTimestamp ?? 0) || 0;

/**
 * Pods and their namespace's events → one short reason, or 'not ready' /
 * 'no pods'. Exported for the unit test.
 */
export function troubleFrom(pods, events = []) {
  const probeOf = (pod) => {
    const mine = events
      .filter((e) => e.involvedObject?.kind === 'Pod' && e.involvedObject?.name === pod.metadata?.name && e.reason === 'Unhealthy')
      .sort((a, b) => eventTime(b) - eventTime(a));
    for (const e of mine) {
      const text = probeFailureText(e.message);
      if (text) return text;
    }
    return null;
  };
  let anyProbe = null;
  for (const pod of pods) {
    const probe = probeOf(pod);
    anyProbe ??= probe;
    for (const cs of pod.status?.containerStatuses ?? []) {
      const waiting = cs.state?.waiting?.reason;
      const last = cs.lastState?.terminated;
      if (waiting && START_FAILURES.has(waiting)) return waiting;
      if (last?.reason === 'OOMKilled') return 'last exit: OOMKilled';
      // the app runs (or ran until the kubelet stopped it) but fails its health check
      if (probe && (!last || STOPPED_BY_KUBELET.has(last.exitCode))) {
        const restarts = cs.restartCount ?? 0;
        return restarts > 0 ? `${probe}; Kubernetes restarted it ${restarts} time${restarts === 1 ? '' : 's'}` : probe;
      }
      if (waiting) return waiting;
      if (last?.reason) return `last exit: ${last.reason}`;
    }
    if (pod.status?.phase === 'Pending') return 'pod is Pending';
  }
  if (anyProbe) return anyProbe;
  return pods.length ? 'not ready' : 'no pods';
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

// A GHCR rollout (FR-36): only the container image changes. A strategic merge
// patch matches the container by name and leaves every other field alone. Its
// own field manager, so the next server-side apply by the pipeline (Deploy
// again) takes the field back without a conflict.
export async function setImage(namespace, name, image) {
  await call((c) =>
    k8s.KubernetesObjectApi.makeApiClient(c).patch(
      {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name, namespace },
        spec: { template: { spec: { containers: [{ name, image }] } } },
      },
      undefined,
      undefined,
      'kairo-rollout',
      undefined,
      k8s.PatchStrategy.StrategicMergePatch,
    ),
  );
}

// The image and replica count the Deployment asks for right now
/** @returns {Promise<{ image: string | null, replicas: number }>} */
export async function deploymentSpec(namespace, name) {
  const d = await call((c) => c.makeApiClient(k8s.AppsV1Api).readNamespacedDeployment({ name, namespace }));
  return {
    image: d.spec?.template?.spec?.containers?.find((c) => c.name === name)?.image ?? null,
    replicas: d.spec?.replicas ?? 1,
  };
}

// Scaling (FR-46, FR-47): only spec.replicas changes, with its own field
// manager, like setImage. A later Deploy again sets it back to 1
export async function scaleDeployment(namespace, name, replicas) {
  await call((c) =>
    k8s.KubernetesObjectApi.makeApiClient(c).patch(
      { apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name, namespace }, spec: { replicas } },
      undefined,
      undefined,
      'kairo-heal',
      undefined,
      k8s.PatchStrategy.StrategicMergePatch,
    ),
  );
}

// The app's pods, newest first, without those already being deleted:
// [{ name, ready, image }]
async function appPods(namespace, app) {
  const pods = await call((c) =>
    c.makeApiClient(k8s.CoreV1Api).listNamespacedPod({ namespace, labelSelector: `app=${app}` }),
  );
  return pods.items
    .filter((p) => !p.metadata?.deletionTimestamp)
    .sort((a, b) => new Date(b.metadata.creationTimestamp) - new Date(a.metadata.creationTimestamp))
    .map((p) => ({
      name: p.metadata.name,
      ready: p.status?.conditions?.some((c) => c.type === 'Ready' && c.status === 'True') ?? false,
      image: p.spec?.containers?.find((c) => c.name === app)?.image ?? null,
    }));
}

export async function listAppPods(namespace, app) {
  return (await appPods(namespace, app)).map((p) => p.name);
}

/**
 * FR-58: the newest pod's last `lines` log lines, with Kubernetes' timestamps.
 * A container waiting to restart (crash loop) has no current log, so its last
 * run's log is shown instead. null when the app has no pod.
 * @returns {Promise<{ pod: string, previous: boolean, text: string } | null>}
 */
export async function newestPodLog(namespace, app, lines = 50) {
  const [newest] = await appPods(namespace, app);
  if (!newest) return null;
  const read = (previous) =>
    call((c) =>
      c.makeApiClient(k8s.CoreV1Api).readNamespacedPodLog({
        name: newest.name,
        namespace,
        container: app,
        tailLines: lines,
        timestamps: true,
        previous,
      }),
    );
  try {
    return { pod: newest.name, previous: false, text: (await read(false)) ?? '' };
  } catch (err) {
    // 400: "container ... is waiting to start" (no current run to read)
    if (!(err instanceof k8s.ApiException) || err.code !== 400) throw err;
    return { pod: newest.name, previous: true, text: (await read(true).catch(() => '')) ?? '' };
  }
}

/**
 * FR-53: an incident's log lines, for Gemini. The alert's pod when it names
 * one, else the newest. preferPrevious reads the run that ended first (an OOM
 * kill or a crash), falling back to the current run, and the other way round.
 * No timestamps: they only cost tokens. null when there is no pod or no log.
 * @returns {Promise<{ pod: string, previous: boolean, text: string } | null>}
 */
export async function incidentPodLog(namespace, app, { pod = null, lines = 50, preferPrevious = false } = {}) {
  const name = pod ?? (await appPods(namespace, app))[0]?.name;
  if (!name) return null;
  const read = (previous) =>
    call((c) =>
      c.makeApiClient(k8s.CoreV1Api).readNamespacedPodLog({ name, namespace, container: app, tailLines: lines, previous }),
    ).then((t) => (t ?? '').trim() || null, () => null);
  for (const previous of preferPrevious ? [true, false] : [false, true]) {
    const text = await read(previous);
    if (text) return { pod: name, previous, text };
  }
  return null;
}

/**
 * FR-73: did an action take effect? Every desired replica is up to date and
 * ready, and, when given: the Deployment runs `image`, asks for `replicas`,
 * and pod `gone` no longer exists (a restart).
 * @returns {Promise<{ done: boolean, detail?: string }>}
 */
export async function actionTookEffect(namespace, name, { image, replicas, gone } = {}) {
  const d = await call((c) => c.makeApiClient(k8s.AppsV1Api).readNamespacedDeployment({ name, namespace }));
  const want = d.spec?.replicas ?? 1;
  const s = d.status ?? {};
  const running = d.spec?.template?.spec?.containers?.find((c) => c.name === name)?.image;
  if (image && running !== image) return { done: false, detail: `the Deployment runs ${running ?? 'nothing'}, not ${image}` };
  if (replicas !== undefined && want !== replicas) return { done: false, detail: `the Deployment asks for ${want} replicas, not ${replicas}` };
  if ((s.observedGeneration ?? 0) < (d.metadata?.generation ?? 1)) return { done: false, detail: 'the change is not picked up yet' };
  const ready = (s.readyReplicas ?? 0) === want && (s.updatedReplicas ?? 0) === want && (s.replicas ?? 0) === want;
  if (!ready) {
    // a pod's own reason (CrashLoopBackOff...) says more than a count; a plain
    // "not ready" says less (e.g. a replica that couldn't even be created)
    const trouble = await podTrouble(namespace, name);
    const count = `${s.readyReplicas ?? 0} of ${want} replicas ready`;
    return { done: false, detail: trouble && trouble !== 'not ready' && trouble !== 'no pods' ? `${trouble}, ${count}` : count };
  }
  // the Deployment's own counts lag behind: right after a pod is deleted they
  // still count it as ready. So the pods themselves must show it: enough
  // Ready pods on the intended image, none of them the deleted one
  const pods = await appPods(namespace, name);
  if (gone && pods.some((p) => p.name === gone)) return { done: false, detail: `pod ${gone} is still there` };
  const readyPods = pods.filter((p) => p.ready && p.name !== gone && (!image || p.image === image)).length;
  if (readyPods < want) return { done: false, detail: `${readyPods} of ${want} pods ready` };
  return { done: true };
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

// FR-65: a merge patch with null removes just this app's key
export async function deleteAlertRules(slug) {
  await call((c) =>
    k8s.KubernetesObjectApi.makeApiClient(c).patch(
      {
        apiVersion: 'v1',
        kind: 'ConfigMap',
        metadata: { ...ALERT_RULES_CONFIGMAP },
        data: { [`${slug}.rules.yml`]: null },
      },
      undefined,
      undefined,
      'kairo',
      undefined,
      k8s.PatchStrategy.MergePatch,
    ),
  );
}
