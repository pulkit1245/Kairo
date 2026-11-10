import { Link } from 'react-router';
import { duration, relativeTime, repoName, shortSha } from '../common/format.js';
import { stackLabel, runStatus } from '../common/status.js';
import { StatusBadge } from '../common/StatusBadge.jsx';

const th = 'px-4 py-2 text-left font-mono text-code-sm uppercase tracking-wider text-on-surface-variant font-normal';
const td = 'px-4 py-3 align-top';

// One row per pipeline run, newest first, straight from GET /api/deployments
export function DeploymentTable({ deployments }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse">
        <thead className="border-b border-outline-variant">
          <tr>
            <th className={th}>App</th>
            <th className={th}>Status</th>
            <th className={th}>Stack</th>
            <th className={th}>Commit</th>
            <th className={th}>Started</th>
            <th className={`${th} text-right`}>Took</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-outline-variant">
          {deployments.map((d) => (
            <tr key={d.id} className="hover:bg-surface-container">
              <td className={td}>
                <Link to={`/apps/${d.appName}`} className="block font-medium hover:text-primary hover:underline">
                  {d.appName}
                </Link>
                <a
                  href={d.repoUrl.replace(/\.git$/, '')}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-code-sm text-primary hover:underline"
                >
                  {repoName(d.repoUrl)}
                </a>
              </td>
              <td className={td}>
                <Link to={`/deployments/${d.id}`} className="hover:underline" title="Open this run">
                  <StatusBadge status={runStatus(d)} />
                </Link>
                {d.failureReason && (
                  <p className="mt-1 max-w-md text-body-sm text-error">
                    {d.failedStep && <span className="font-mono">at {d.failedStep.toLowerCase()}: </span>}
                    {d.failureReason}
                  </p>
                )}
              </td>
              <td className={`${td} font-mono text-code-md`}>{stackLabel(d.stack)}</td>
              <td className={`${td} font-mono text-code-md text-secondary`} title={d.commitSha ?? ''}>
                {shortSha(d.commitSha)}
              </td>
              <td className={`${td} text-on-surface-variant`} title={d.startedAt}>
                {relativeTime(d.startedAt)}
              </td>
              <td className={`${td} text-right font-mono text-code-md`}>
                {duration(d.startedAt, d.finishedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
