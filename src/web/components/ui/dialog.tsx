import React from 'react';
import { Dialog as Primitive } from 'radix-ui';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
export const Dialog = Primitive.Root;
export const DialogTitle = Primitive.Title;
export const DialogDescription = Primitive.Description;
export function DialogContent({ className, children, ...props }: React.ComponentProps<typeof Primitive.Content>) {
  return <Primitive.Portal><Primitive.Overlay className="fixed inset-0 z-50 bg-black/45" />
    <Primitive.Content {...props} className={cn('fixed left-1/2 top-[12%] z-50 flex max-h-[76svh] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 flex-col overflow-hidden rounded-md border bg-background shadow-lg', className)}>
      {children}<Primitive.Close className="absolute right-3 top-3 rounded-sm p-1 text-muted-foreground hover:bg-accent" aria-label="Close"><X className="size-4" /></Primitive.Close>
    </Primitive.Content></Primitive.Portal>;
}
