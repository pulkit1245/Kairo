import { retrySetupPr } from '../generator/pr/pr.service.js';
import { onboardRepo } from '../services/deployment.service.js';
import { listRepos } from '../services/repo.service.js';

// GET /api/repos
export async function list(req, res) {
  res.json(await listRepos(req.user.id));
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
