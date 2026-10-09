import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/**
 * twMerge told about the design's own scale values (see `@theme` in
 * app/globals.css), so `shadow-card` replaces `shadow-xs` and `rounded-card`
 * replaces `rounded-lg` instead of sitting beside them.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      shadow: ["card", "raised"],
      radius: ["card", "panel"],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
