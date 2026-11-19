import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Icon } from '../common/Icon.jsx';

const MENU_WIDTH = 208; // w-52

// The signed-in visitor's avatar and @login on the landing page, with a small
// menu: Open dashboard and Sign out. Keyboard as in the WAI-ARIA menu button
// pattern: Enter, Space or the arrows open it, the arrows move, Escape closes.
export function AccountMenu({ user, onSignOut }) {
  // false, or which item gets focus when it opens
  const [open, setOpen] = useState(false);
  // on a phone the button wraps to the left edge: open the menu to the right
  const [alignLeft, setAlignLeft] = useState(false);
  const wrap = useRef(null);
  const button = useRef(null);
  const menu = useRef(null);

  const items = () => [...(menu.current?.querySelectorAll('[role="menuitem"]') ?? [])];
  const focusItem = (i) => {
    const list = items();
    list[(i + list.length) % list.length]?.focus();
  };
  const show = (which) => {
    setAlignLeft((button.current?.getBoundingClientRect().right ?? Infinity) < MENU_WIDTH + 16);
    setOpen(which);
  };
  const close = (refocus) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    focusItem(open === 'last' ? -1 : 0);
    // a click anywhere else closes it
    const onDown = (e) => {
      if (!wrap.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  function onButtonKey(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      show(e.key === 'ArrowUp' ? 'last' : 'first');
    }
  }

  function onMenuKey(e) {
    const list = items();
    const at = list.indexOf(document.activeElement);
    const moves = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: -1 };
    if (e.key in moves) {
      e.preventDefault();
      focusItem(moves[e.key]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
    } else if (e.key === 'Tab') {
      close(false);
    }
  }

  const item =
    'flex w-full items-center gap-2.5 px-3 py-2 text-left text-body-xl text-on-surface outline-none hover:bg-surface-container-highest focus-visible:bg-surface-container-highest';

  return (
    <div ref={wrap} className="relative">
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={Boolean(open)}
        aria-controls="account-menu"
        onClick={() => (open ? close(false) : show('first'))}
        onKeyDown={onButtonKey}
        className="landing-focus inline-flex min-h-11 items-center gap-2.5 rounded-lg border border-outline-variant px-3 text-on-surface hover:bg-surface-container"
      >
        {user.avatarUrl ? (
          <img src={user.avatarUrl} alt="" className="size-7 rounded-full border border-outline-variant" />
        ) : (
          <span className="grid size-7 place-items-center rounded-full bg-surface-container-high font-mono text-code-md uppercase">
            {user.login.slice(0, 1)}
          </span>
        )}
        <span className="font-mono text-body-md">@{user.login}</span>
        <Icon name="expand_more" className={`text-[18px] text-on-surface-variant ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          ref={menu}
          id="account-menu"
          role="menu"
          aria-label={`@${user.login}`}
          onKeyDown={onMenuKey}
          className={`absolute z-10 mt-2 w-52 overflow-hidden ${alignLeft ? 'left-0' : 'right-0'} rounded-lg border border-outline-variant bg-surface-container-high py-1 shadow-xl`}
        >
          <Link role="menuitem" tabIndex={-1} to="/" className={item}>
            <Icon name="space_dashboard" className="text-[18px] text-on-surface-variant" />
            Open dashboard
          </Link>
          <button role="menuitem" tabIndex={-1} type="button" onClick={onSignOut} className={item}>
            <Icon name="logout" className="text-[18px] text-on-surface-variant" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
