'use client';
import { useFormStatus } from 'react-dom';
import type { ReactNode } from 'react';

/** Submit button that shows progress and can ask for confirmation first. */
export default function Submit({
  children, className = 'btn', confirm, name, value, disabled,
}: { children: ReactNode; className?: string; confirm?: string; name?: string; value?: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      className={className}
      type="submit"
      name={name}
      value={value}
      disabled={pending || disabled}
      aria-busy={pending}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {pending ? 'Working…' : children}
    </button>
  );
}
