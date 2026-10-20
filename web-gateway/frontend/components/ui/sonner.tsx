"use client"

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react"
import { Toaster as Sonner, type ToasterProps } from "sonner"

/**
 * Toasts drawn by us rather than Sonner (`unstyled`: Sonner keeps only the
 * stacking, swiping and timing). A card with the kind's icon in a tinted disc,
 * the message, and a close button. It sits below the site header rather than
 * on it. A toast that must not vanish on its own (an error the person has to
 * read) passes `duration: Infinity`; every toast can be closed.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      // The site has no dark mode (no ThemeProvider), so Sonner must not
      // follow the OS into its dark one.
      theme="light"
      className="toaster group"
      closeButton
      offset={{ top: 88 }}
      mobileOffset={{ top: 76, left: 16, right: 16 }}
      icons={{
        success: <CircleCheckIcon />,
        info: <InfoIcon />,
        warning: <TriangleAlertIcon />,
        error: <OctagonXIcon />,
        loading: <Loader2Icon className="animate-spin" />,
        close: <XIcon />,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: [
            "group/toast flex w-full items-start gap-3 rounded-[18px] border border-border/80 bg-popover p-3.5 pr-11 text-popover-foreground",
            "shadow-[0_1px_2px_rgba(16,40,58,0.06),0_16px_36px_-12px_rgba(16,40,58,0.28)]",
          ].join(" "),
          icon: [
            "flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-foreground [&_svg]:size-[18px]",
            "group-data-[type=success]/toast:bg-success/12 group-data-[type=success]/toast:text-success",
            "group-data-[type=info]/toast:bg-primary/12 group-data-[type=info]/toast:text-primary",
            "group-data-[type=warning]/toast:bg-warning/12 group-data-[type=warning]/toast:text-warning",
            "group-data-[type=error]/toast:bg-destructive/12 group-data-[type=error]/toast:text-destructive",
          ].join(" "),
          content: "flex min-w-0 flex-1 flex-col gap-0.5 self-center py-0.5",
          title: "text-[14.5px] leading-snug font-semibold text-pretty",
          description: "text-[13.5px] leading-snug text-muted-foreground text-pretty",
          closeButton: [
            "absolute top-3 right-3 flex size-7 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors",
            "hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&_svg]:size-4",
          ].join(" "),
          actionButton:
            "ml-1 shrink-0 self-center rounded-full bg-primary px-3 py-1.5 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90",
          cancelButton:
            "shrink-0 self-center rounded-full px-3 py-1.5 text-[13px] font-medium text-muted-foreground hover:bg-muted",
        },
      }}
      style={{ "--width": "440px" } as React.CSSProperties}
      {...props}
    />
  )
}

export { Toaster }
