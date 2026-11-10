import { Icon } from '../common/Icon.jsx';

// "What Kairo found" (Stitch 04, FR-15): each detected fact, its value and
// where it came from. `rule` = read from the repo, `default` = nothing to read.
const LABELS = {
  stack: 'Stack',
  dockerfile: 'Dockerfile',
  packageManager: 'Package manager',
  nodeVersion: 'Node version',
  pythonVersion: 'Python version',
  buildScript: 'Build',
  startCommand: 'Start command',
  testScript: 'Tests',
  port: 'Port',
};

export function FactsPanel({ facts, assumptions }) {
  // in LABELS order: Postgres' JSON column doesn't keep key order
  const order = Object.keys(LABELS);
  const rank = (k) => (order.includes(k) ? order.indexOf(k) : order.length);
  const rows = Object.entries(facts ?? {}).sort(([a], [b]) => rank(a) - rank(b));
  if (!rows.length) return null;

  return (
    <section className="flex flex-col rounded border border-outline-variant bg-surface-container-low" aria-labelledby="facts-title">
      <header className="flex items-center justify-between gap-3 border-b border-outline-variant px-4 py-3">
        <h2 id="facts-title" className="flex items-center gap-2 text-headline-md font-semibold">
          <Icon name="frame_inspect" className="text-[20px] text-primary" /> What Kairo found
        </h2>
        <span className="font-mono text-code-sm text-on-surface-variant">{rows.length} facts</span>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="font-mono text-code-sm uppercase tracking-wider text-on-surface-variant">
              <th className="px-4 py-2 font-normal">Fact</th>
              <th className="px-4 py-2 font-normal">Value</th>
              <th className="px-4 py-2 font-normal">Source</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant">
            {rows.map(([key, f]) => (
              <tr key={key}>
                <td className="px-4 py-2 text-body-lg">{LABELS[key] ?? key}</td>
                <td className="px-4 py-2 font-mono text-code-md">{String(f.value)}</td>
                <td className="px-4 py-2">
                  <SourceTag fact={f} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {assumptions?.length > 0 && (
        <div className="border-t border-outline-variant px-4 py-3">
          <h3 className="font-mono text-code-sm uppercase tracking-wider text-on-surface-variant">Assumptions</h3>
          <ul className="mt-1 list-disc pl-5 text-body-md text-on-surface-variant">
            {assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-auto flex items-center gap-1.5 border-t border-outline-variant px-4 py-2 text-body-sm text-on-surface-variant">
        <Icon name="info" className="text-[14px]" /> Gemini will only fill facts Kairo couldn't read from the repo (P4).
      </p>
    </section>
  );
}

function SourceTag({ fact }) {
  const fromRepo = fact.source === 'rule';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-code-sm ${
        fromRepo ? 'border-outline-variant text-on-surface' : 'border-outline-variant text-on-surface-variant'
      }`}
    >
      <Icon name={fromRepo ? 'description' : 'remove'} className="text-[14px]" />
      {fromRepo ? 'repo' : 'default'}
      <span className="text-on-surface-variant">({fact.from})</span>
    </span>
  );
}
