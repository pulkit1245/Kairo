import { listIncidents } from '../remediation/incident/incident.service.js';
import { getIncident } from '../services/app.service.js';

export async function list(_req, res) {
  res.json(await listIncidents());
}

// GET /api/incidents/:id: the incident drawer (Stitch 08)
export async function show(req, res) {
  res.json(await getIncident(req.params.id));
}
