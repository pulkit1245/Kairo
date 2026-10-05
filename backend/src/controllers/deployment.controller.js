import * as deployments from '../services/deployment.service.js';
import { AppError } from '../utils/AppError.js';

export async function create(req, res) {
  const { repoUrl } = req.body ?? {};
  if (typeof repoUrl !== 'string' || !repoUrl.trim()) {
    throw new AppError('repoUrl is required');
  }

  const deployment = await deployments.createDeployment(repoUrl);
  // 202 - accepted, the actual work happens in the background
  res.status(202).json(deployment);
}

export async function list(_req, res) {
  res.json(await deployments.listDeployments());
}

export async function getOne(req, res) {
  res.json(await deployments.getDeployment(req.params.id));
}
