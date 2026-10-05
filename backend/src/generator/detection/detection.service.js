import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../../utils/AppError.js';

const NODE_PORT = 3000;
const PYTHON_PORT = 8000;
const PYTHON_ENTRYPOINTS = ['main.py', 'app.py', 'server.py'];

// Deliberately dumb: look for a marker file in the repo root and that's it.
// package.json wins if a repo somehow has both.
//
// returns { stack, port, startCommand }
//   port         - what we tell the app to listen on via $PORT. apps have to respect it
//   startCommand - array (exec form), goes straight into the Dockerfile CMD
export async function detectStack(dir) {
  if (await exists(dir, 'package.json')) return detectNode(dir);
  if (await exists(dir, 'requirements.txt')) return detectPython(dir);

  throw new AppError(
    'Unsupported project - expected package.json (Node) or requirements.txt (Python) in the repo root',
  );
}

async function detectNode(dir) {
  let pkg;
  try {
    pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
  } catch {
    throw new AppError('package.json exists but is not valid JSON');
  }

  let startCommand;
  if (pkg.scripts?.start) {
    startCommand = ['npm', 'start'];
  } else if (pkg.main) {
    startCommand = ['node', pkg.main];
  } else if (await exists(dir, 'index.js')) {
    startCommand = ['node', 'index.js'];
  } else {
    throw new AppError('Node project has no "start" script, no "main" field and no index.js');
  }

  return { stack: 'NODE', port: NODE_PORT, startCommand };
}

async function detectPython(dir) {
  for (const file of PYTHON_ENTRYPOINTS) {
    if (await exists(dir, file)) {
      return { stack: 'PYTHON', port: PYTHON_PORT, startCommand: ['python', file] };
    }
  }
  throw new AppError(
    `Python project needs one of ${PYTHON_ENTRYPOINTS.join(', ')} in the repo root`,
  );
}

async function exists(dir, file) {
  try {
    await access(path.join(dir, file));
    return true;
  } catch {
    return false;
  }
}
