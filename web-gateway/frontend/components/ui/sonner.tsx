"use client"

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"

/**
 * A toast is a raised card with a coloured edge and icon by kind, larger than
 * Sonner's default. Every toast has a close button; one that must not vanish
 * on its own (an error the person has to read) passes `duration: Infinity`.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      closeButton
      icons={{
        success: <CircleCheckIcon className="size-5 text-success" />,
        info: <InfoIcon className="size-5 text-primary" />,
        warning: <TriangleAlertIcon className="size-5 text-warning" />,
        error: <OctagonXIcon className="size-5 text-destructive" />,
        loading: <Loader2Icon className="size-5 animate-spin" />,
      }}
      toastOptions={{
        classNames: {
          toast:
            "!w-[420px] !max-w-[calc(100vw-32px)] !items-start !gap-3 !rounded-card !border-0 !border-l-4 !p-4 !pr-10 !text-[15px] !leading-snug !font-medium !shadow-raised",
          icon: "!mt-0.5 !size-5",
          title: "!text-[15px] !font-semibold",
          description: "!text-sm !font-normal !text-muted-foreground",
          closeButton:
            "!left-auto !right-2 !top-2 !size-6 !translate-x-0 !translate-y-0 !rounded-full !border-0 !bg-transparent !text-muted-foreground hover:!bg-muted hover:!text-foreground",
          success: "!border-l-success",
          info: "!border-l-primary",
          warning: "!border-l-warning",
          error: "!border-l-destructive",
        },
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius-card)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
