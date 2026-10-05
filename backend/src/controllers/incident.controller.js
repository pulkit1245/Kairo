import { listIncidents } from '../remediation/incident/incident.service.js';

export async function list(_req, res) {
  res.json(await listIncidents());
}
