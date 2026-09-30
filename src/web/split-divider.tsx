import React from 'react';

export function SplitDivider({ value, onChange, path }: { value: number; onChange: (value: number) => void; path: string }) {
  const clamp = (next: number) => onChange(Math.max(20, Math.min(80, next)));
  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.parentElement!.getBoundingClientRect();
    clamp(100 * (event.clientX - bounds.left) / bounds.width);
  };
  return <div role="separator" aria-label={`Resize split diff ${path}`} aria-orientation="vertical" tabIndex={0}
    aria-valuemin={20} aria-valuemax={80} aria-valuenow={Math.round(value)} aria-valuetext={`${Math.round(value)}% old code, ${Math.round(100 - value)}% new code`}
    className="split-divider absolute inset-y-0 z-10 w-2 -translate-x-1/2 cursor-col-resize touch-none focus-visible:outline-none"
    style={{ left: `${value}%` }} title="Drag to resize · double-click to reset"
    onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); move(event); }}
    onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) move(event); }}
    onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onDoubleClick={() => onChange(50)} onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      if (event.key === 'Enter') onChange(50);
      else if (event.key === 'Home') clamp(20);
      else if (event.key === 'End') clamp(80);
      else clamp(value + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 10 : 2));
    }} />;
}
