import { Icon } from './Icon.jsx';
import { TONE_CLASS } from './status.js';

// icon + word, colored by tone. `status` comes from the helpers in status.js
export function StatusBadge({ status, className = '' }) {
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-code-md ${TONE_CLASS[status.tone]} ${className}`}>
      <Icon name={status.icon} spin={status.spin} className="text-[16px]" />
      {status.label}
    </span>
  );
}
