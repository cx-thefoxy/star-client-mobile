/** The Star Client mark: a four-point nova. `className` sets the size and colour (it paints with currentColor). */
export function StarMark({ className = "h-[1.125rem] w-[1.125rem] text-accent" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden focusable="false" className={className}>
      <path d="M12 1.8c.8 5.6 3 8.8 10.2 10.2-7.2 1.4-9.4 4.6-10.2 10.2-.8-5.6-3-8.8-10.2-10.2C9 10.6 11.2 7.4 12 1.8z" fill="currentColor" />
    </svg>
  );
}
