import React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './components/ui/dialog';

const shortcuts = [
  ['⌘ / Ctrl K · / · ?', 'Search changes'],
  ['J / K', 'Next / previous layer'],
  ['L / H', 'Next / previous file'],
  ['U', 'Switch split / unified diff'],
  ['[', 'Show / hide sidebar'],
  ['N', 'Show / hide part notes in the code'],
  ['G', 'Show / hide the layer map'],
  ['O', 'Open the merge request in GitLab / GitHub'],
  ['↑ / ↓ · Enter', 'Select and open a search result'],
  ['Esc', 'Close a dialog or side panel'],
  ['Alt + click a code token', 'Look up a symbol'],
  ['Click or drag line numbers', 'Open the original diff or write a comment'],
  ['⌘ / Ctrl Enter in a comment', 'Post the comment to GitLab / GitHub'],
  ['← / → on the divider', 'Resize split diff (Shift for larger steps)'],
  ['Home / End on the divider', 'Set old code width to 20% / 80%'],
  ['Double-click divider · Enter', 'Reset split diff to equal widths'],
] as const;

export function Shortcuts({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent>
    <div className="border-b p-4 pr-12"><DialogTitle className="text-sm font-medium">Keyboard shortcuts</DialogTitle>
      <DialogDescription className="mt-1 text-xs text-muted-foreground">Navigation shortcuts pause while typing or while a panel is open.</DialogDescription></div>
    <dl className="overflow-auto p-4 text-xs">{shortcuts.map(([key, action]) => <div key={key} className="flex items-center justify-between gap-6 py-2">
      <dt className="text-muted-foreground">{action}</dt><dd className="text-right"><kbd className="font-sans">{key}</kbd></dd>
    </div>)}</dl>
  </DialogContent></Dialog>;
}
