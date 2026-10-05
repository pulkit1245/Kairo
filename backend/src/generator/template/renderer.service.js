import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nunjucks from 'nunjucks';

// templates live in backend/templates, not inside src/ - they're data, not code.
// resolved relative to this file so it doesn't matter which folder you start node from
const here = path.dirname(fileURLToPath(import.meta.url));
export const TEMPLATES_DIR = path.resolve(here, '../../../templates');

const njk = new nunjucks.Environment(new nunjucks.FileSystemLoader(TEMPLATES_DIR), {
  // we're rendering YAML and Dockerfiles, not HTML. With autoescape on,
  // a quote in a value turns into &quot; and breaks the file
  autoescape: false,
  // fail loudly on a typo'd variable instead of silently rendering ""
  throwOnUndefined: true,
  // strip the newline/indent around {% %} tags so YAML indentation stays sane
  trimBlocks: true,
  lstripBlocks: true,
});

export function render(template, ctx) {
  return njk.render(template, ctx);
}
