import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

interface SearchOverlayProps {
  /** Escape or Cancel. The host restores focus to the trigger. */
  onClose: () => void;
  children: ReactNode;
}

const TABBABLE = 'button:not([tabindex="-1"]):not([disabled]), input:not([disabled]), a[href]:not([tabindex="-1"])';

/** The full-screen search dialog below xl: scroll lock, Escape to close, and a Tab trap inside the dialog. */
const SearchOverlay = ({ onClose, children }: SearchOverlayProps) => {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key !== "Tab" || !rootRef.current) {
      return;
    }

    const tabbable = Array.from(rootRef.current.querySelectorAll<HTMLElement>(TABBABLE));
    if (tabbable.length === 0) {
      return;
    }

    const first = tabbable[0];
    const last = tabbable[tabbable.length - 1];
    const current = document.activeElement;
    if (event.shiftKey && (current === first || !rootRef.current.contains(current))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (current === last || !rootRef.current.contains(current))) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="Search"
      data-global-search-overlay=""
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-[200] flex h-dvh flex-col bg-surface pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]"
    >
      <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col">{children}</div>
    </div>
  );
};

export default SearchOverlay;
