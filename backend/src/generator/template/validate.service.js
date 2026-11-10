import { loadAllYaml } from '@kubernetes/client-node';
import { ALERT_NAMES } from '../../types/index.js';
import { AppError } from '../../utils/AppError.js';

// FR-26: every rendered file is parsed and checked before anything uses it.
// The checks are the fields the rest of Kairo relies on: names and namespace
// for applying, probes and the memory limit for healing, the alert names for
// remediation. Any problem ends the pipeline at GENERATING.

function parse(file) {
  try {
    const docs = loadAllYaml(file.content).filter(Boolean);
    if (docs.length !== 1) return { error: `${file.path}: expected 1 YAML document, got ${docs.length}` };
    return { doc: docs[0] };
  } catch (err) {
    return { error: `${file.path}: not valid YAML (${err.message.split('\n')[0]})` };
  }
}

// small helper: push a message when a condition is false
function checker(file, problems) {
  return (ok, what) => {
    if (!ok) problems.push(`${file.path}: ${what}`);
  };
}

function checkMeta(doc, ctx, check, kind) {
  check(doc.kind === kind, `kind should be ${kind}`);
  check(doc.metadata?.name === ctx.appName, `metadata.name should be ${ctx.appName}`);
  check(doc.metadata?.namespace === ctx.namespace, `metadata.namespace should be ${ctx.namespace}`);
}

const CHECKS = {
  DOCKERFILE(file, ctx, check) {
    check(/^FROM\s+\S+/m.test(file.content), 'no FROM line');
    check(/^CMD\s+\[/m.test(file.content), 'no CMD in exec form');
  },

  DEPLOYMENT(file, ctx, check, doc) {
    checkMeta(doc, ctx, check, 'Deployment');
    const pod = doc.spec?.template;
    const c = pod?.spec?.containers?.[0];
    check(doc.spec?.selector?.matchLabels?.app === ctx.appName, 'selector must match app label');
    check(pod?.metadata?.labels?.app === ctx.appName, 'pod template needs the app label');
    check(c?.name === ctx.appName, 'container name should be the slug (alert rules filter on it)');
    check(c?.image === ctx.image, `image should be ${ctx.image}`);
    check(c?.livenessProbe?.httpGet?.path, 'liveness probe missing');
    check(c?.readinessProbe?.httpGet?.path, 'readiness probe missing');
    check(c?.resources?.limits?.memory === ctx.memoryLimit, `memory limit should be ${ctx.memoryLimit}`);
    check(c?.resources?.requests?.cpu && c?.resources?.requests?.memory, 'resource requests missing');
    check((c?.env ?? []).some((e) => e.name === 'PORT' && e.value === String(ctx.port)), `PORT=${ctx.port} not injected`);
  },

  SERVICE(file, ctx, check, doc) {
    checkMeta(doc, ctx, check, 'Service');
    check(doc.spec?.type === 'ClusterIP', 'type should be ClusterIP (traffic goes through Traefik)');
    check(doc.spec?.selector?.app === ctx.appName, 'selector must match app label');
    check(doc.spec?.ports?.[0]?.port === 80, 'port 80 missing');
  },

  INGRESS(file, ctx, check, doc) {
    checkMeta(doc, ctx, check, 'Ingress');
    const rule = doc.spec?.rules?.[0];
    check(rule?.host === ctx.host, `host should be ${ctx.host}`);
    check(rule?.http?.paths?.[0]?.backend?.service?.name === ctx.appName, 'backend should be the app Service');
  },

  // FR-24: what the GHCR watcher and the cluster depend on
  WORKFLOW(file, ctx, check, doc) {
    const wf = ctx.workflow;
    const branches = doc.on?.push?.branches ?? [];
    check(branches.includes(wf.defaultBranch), `should run on push to ${wf.defaultBranch}`);
    check(doc.permissions?.packages === 'write', 'needs packages: write to push to GHCR');
    const steps = doc.jobs?.image?.steps ?? [];
    const build = steps.find((s) => String(s.uses ?? '').startsWith('docker/build-push-action@'));
    check(build, 'no docker/build-push-action step');
    if (build) {
      const platforms = String(build.with?.platforms ?? '').split(',').map((p) => p.trim());
      check(platforms.includes('linux/amd64') && platforms.includes('linux/arm64'), 'must build linux/amd64 and linux/arm64');
      check(build.with?.push === true, 'must push the image');
      check(String(build.with?.tags ?? '').endsWith(':${{ github.sha }}'), 'tag must be the full commit sha');
    }
    check(doc.env?.IMAGE === wf.image, `image should be ${wf.image}`);
    // a pinned SHA can't be moved under us; a tag can
    for (const s of Object.values(doc.jobs ?? {}).flatMap((j) => j.steps ?? [])) {
      if (s.uses) check(/@[0-9a-f]{40}$/.test(s.uses), `${s.uses} should be pinned to a commit SHA`);
    }
    const trivy = steps.find((s) => /trivy/i.test(String(s.run ?? '')));
    check(trivy && /--exit-code 0/.test(trivy.run), 'Trivy must be report-only (--exit-code 0)');
    check(Boolean(doc.jobs?.test) === Boolean(wf.test), wf.test ? 'test job missing' : 'test job without a real test script');
  },

  ALERT_RULES(file, ctx, check, doc) {
    const rules = doc.groups?.flatMap((g) => g.rules ?? []) ?? [];
    const names = rules.map((r) => r.alert).sort();
    check(JSON.stringify(names) === JSON.stringify([...ALERT_NAMES].sort()), `alerts should be exactly ${ALERT_NAMES.join(', ')}`);
    for (const r of rules) {
      check(typeof r.expr === 'string' && r.expr.trim(), `${r.alert} has no expr`);
      check(r.labels?.app === ctx.appName, `${r.alert} needs the app label`);
    }
  },
};

export function validateConfigs(files, ctx) {
  const problems = [];
  for (const file of files) {
    const check = checker(file, problems);
    if (file.kind === 'DOCKERFILE') {
      // a kept Dockerfile is the owner's file: Kairo builds it as it is (FR-25)
      if (file.origin !== 'KEPT_EXISTING') CHECKS.DOCKERFILE(file, ctx, check);
      continue;
    }
    const { doc, error } = parse(file);
    if (error) {
      problems.push(error);
      continue;
    }
    CHECKS[file.kind]?.(file, ctx, check, doc);
  }

  if (problems.length) {
    throw new AppError(`Generated files failed their checks: ${problems.join('; ')}`);
  }
}
