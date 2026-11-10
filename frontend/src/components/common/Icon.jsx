// Material Symbols icon. Decorative by default: every status also has a word
// next to it, so screen readers skip the icon (status is never icon or color alone).
export function Icon({ name, className = '', spin = false, label }) {
  return (
    <span
      className={`icon ${spin ? 'icon-spin' : ''} ${className}`}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
    >
      {name}
    </span>
  );
}
