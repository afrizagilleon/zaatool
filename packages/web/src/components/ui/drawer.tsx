import * as React from "react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { XIcon } from "@phosphor-icons/react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

/**
 * A panel that slides in from an edge.
 *
 * The same Radix dialog underneath — modal, focus-trapped, closed by Escape and by the
 * overlay — laid out against a side rather than centred. That is the whole difference,
 * and it is the difference between a control row that overflows a phone and one that
 * does not: a toolbar with ten controls has to put nine of them somewhere, and a drawer
 * is somewhere with room to label them.
 *
 * Not a second dialog implementation. If a panel needs to be read *while* the thing
 * behind it is being used, this is the wrong component — that is a popover.
 */

const Drawer = DialogPrimitive.Root
const DrawerTrigger = DialogPrimitive.Trigger
const DrawerClose = DialogPrimitive.Close

function DrawerContent({
  className,
  children,
  side = "right",
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  side?: "left" | "right"
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className="fixed inset-0 z-50 bg-black/40 duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
      />
      <DialogPrimitive.Content
        data-slot="drawer-content"
        className={cn(
          // `max-w-[85vw]` so the page behind stays visible: a panel that covers
          // everything reads as a new screen, and then Escape feels like going back.
          "fixed inset-y-0 z-50 flex w-80 max-w-[85vw] flex-col overflow-y-auto bg-popover text-popover-foreground ring-1 ring-foreground/10 duration-150 outline-none",
          side === "right"
            ? "right-0 data-open:animate-in data-open:slide-in-from-right data-closed:animate-out data-closed:slide-out-to-right"
            : "left-0 data-open:animate-in data-open:slide-in-from-left data-closed:animate-out data-closed:slide-out-to-left",
          className
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close asChild>
          <Button variant="ghost" size="icon-sm" className="absolute top-2 right-2">
            <XIcon />
            <span className="sr-only">Close</span>
          </Button>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

function DrawerHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-header"
      className={cn("shrink-0 border-b border-border px-4 py-3", className)}
      {...props}
    />
  )
}

const DrawerTitle = ({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) => (
  <DialogPrimitive.Title
    className={cn("text-[10px] font-semibold uppercase tracking-widest text-muted-foreground", className)}
    {...props}
  />
)

const DrawerDescription = DialogPrimitive.Description

/**
 * One labelled row in a drawer. Tall enough to hit with a thumb.
 *
 * `shrink-0` because a flex column shrinks its children by default: a row whose contents
 * wrapped onto two lines was squeezed back to one line's worth of height, and the row
 * after it was drawn on top of the overflow.
 */
function DrawerRow({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-row"
      className={cn("flex min-h-11 shrink-0 items-center gap-2 px-4 py-2", className)}
      {...props}
    />
  )
}

export {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerRow,
  DrawerTitle,
  DrawerTrigger,
}
