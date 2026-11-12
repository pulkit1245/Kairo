import { retrySetupPr } from '../generator/pr/pr.service.js';
import { deleteApp, getApp, listApps, sendTraffic, updateApp } from '../services/app.service.js';
import { appLogs } from '../services/logs.service.js';
import { appMetrics } from '../services/metrics.service.js';
import { manualRollback } from '../remediation/healing/rollback.service.js';
import { breakApp } from '../testpanel/break.service.js';
import { onboardRepo } from '../services/deployment.service.js';
import { listRepos } from '../services/repo.service.js';

// GET /api/repos
export async function list(req, res) {
  res.json(await listRepos(req.user.id));
}

// GET /api/apps: the Apps list (Stitch 06)
export async function index(req, res) {
  res.json(await listApps());
}

// POST /api/apps { repoFullName }: start onboarding from a picked repo (FR-3)
export async function onboard(req, res) {
  const deployment = await onboardRepo(req.user.id, req.body?.repoFullName);
  // 202 - accepted, the pipeline runs in the background
  res.status(202).json(deployment);
}

// POST /api/apps/:slug/pr: Try again when the PR couldn't be opened (AQ11)
export async function retryPr(req, res) {
  res.json(await retrySetupPr(req.user.id, req.params.slug));
}

// GET /api/apps/:slug: the app page (Stitch 07 header)
export async function show(req, res) {
  res.json(await getApp(req.params.slug));
}

// PATCH /api/apps/:slug { autoHeal } (FR-51)
export async function update(req, res) {
  res.json(await updateApp(req.params.slug, req.body));
}

// POST /api/apps/:slug/traffic: Send Traffic (FR-62), 202 while it runs
export async function traffic(req, res) {
  res.status(202).json(await sendTraffic(req.params.slug));
}

// POST /api/apps/:slug/break { kind: "kill-pod" | "broken-release" } (FR-63)
export async function breakIt(req, res) {
  res.status(202).json(await breakApp(req.params.slug, req.body?.kind));
}

// POST /api/apps/:slug/rollback { releaseId }: "Roll back to this" (FR-61).
// 202: the rollback ran; its 90 s check continues in the background
export async function rollback(req, res) {
  res.status(202).json(await manualRollback(req.params.slug, req.body?.releaseId, req.user));
}

// GET /api/apps/:slug/metrics: KPIs and the last 30 min (FR-56, FR-57)
export async function metrics(req, res) {
  res.json(await appMetrics(req.params.slug));
}

// GET /api/apps/:slug/logs: the newest pod's last 50 lines (FR-58)
export async function logs(req, res) {
  res.json(await appLogs(req.params.slug));
}

// DELETE /api/apps/:slug { confirm: "<slug>" } (FR-65, FR-66)
export async function remove(req, res) {
  res.json(await deleteApp(req.params.slug, req.body?.confirm));
}
