"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import type { HelpFacts, HelpSection, HelpStep } from "@/lib/workspace/wizard-help";

/** How long a section's help stays after the pointer leaves it, so that the
 *  pointer can cross the gap to the panel without the panel changing under it. */
export const HOVER_LINGER_MS = 300;

interface WizardHelp {
  step: HelpStep;
  facts: HelpFacts;
  /** The section whose help is shown, or null for the step's overview. */
  section: HelpSection | null;
  /** Focus moved into a section. The section stays until another one is
   *  focused or `showOverview` is used, so the panel does not jump back when
   *  focus is on the page background or on the panel itself. */
  focusSection: (section: HelpSection) => void;
  /** The pointer entered (`section`) or left (`null`) a section. */
  hoverSection: (section: HelpSection | null) => void;
  /** The pointer is over the panel: keep what it shows. */
  holdHover: (over: boolean) => void;
  /** Back to the step's overview. */
  showOverview: () => void;
  /** Run `focus` without it counting as the person going to a section (the
   *  wizard focusing the Name input as the step opens). */
  quietly: (focus: () => void) => void;
}

const WizardHelpContext = createContext<WizardHelp | null>(null);

/** The wizard's help state, or null outside a `WizardHelpProvider` (a step
 *  rendered on its own has no panel to feed). */
export function useWizardHelp(): WizardHelp | null {
  return useContext(WizardHelpContext);
}

/**
 * Which part of the screen the help panel is about. A section is chosen by
 * focus (kept) or by the pointer (shown while it is over the section, and for
 * a moment after); the pointer wins while it is there. The state starts over
 * when the step changes. Nothing here moves focus.
 */
export function WizardHelpProvider({
  step,
  facts,
  children,
}: {
  step: HelpStep;
  facts: HelpFacts;
  children: ReactNode;
}) {
  const [focused, setFocused] = useState<HelpSection | null>(null);
  const [hovered, setHovered] = useState<HelpSection | null>(null);
  const [seenStep, setSeenStep] = useState(step);
  if (seenStep !== step) {
    setSeenStep(step);
    setFocused(null);
    setHovered(null);
  }

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const overPanel = useRef(false);
  const ignoreFocus = useRef(false);
  const stop = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => stop, [stop]);

  const focusSection = useCallback((section: HelpSection) => {
    if (!ignoreFocus.current) setFocused(section);
  }, []);
  const hoverSection = useCallback((section: HelpSection | null) => {
    stop();
    if (section !== null) setHovered(section);
    else if (!overPanel.current) timer.current = setTimeout(() => setHovered(null), HOVER_LINGER_MS);
  }, [stop]);
  const holdHover = useCallback((over: boolean) => {
    overPanel.current = over;
    stop();
    if (!over) setHovered(null);
  }, [stop]);
  const showOverview = useCallback(() => {
    stop();
    setFocused(null);
    setHovered(null);
  }, [stop]);
  const quietly = useCallback((focus: () => void) => {
    ignoreFocus.current = true;
    try {
      focus();
    } finally {
      ignoreFocus.current = false;
    }
  }, []);

  const climatologyAvailable = facts.climatologyAvailable;
  const value = useMemo<WizardHelp>(
    () => ({
      step,
      facts: { climatologyAvailable },
      section: hovered ?? focused,
      focusSection,
      hoverSection,
      holdHover,
      showOverview,
      quietly,
    }),
    [step, climatologyAvailable, hovered, focused, focusSection, hoverSection, holdHover, showOverview, quietly]
  );

  return <WizardHelpContext.Provider value={value}>{children}</WizardHelpContext.Provider>;
}

/**
 * Props for the element that is a section of a step (`DraftSection`): focus
 * inside it, or the pointer over it, tells the panel to show `section`'s help.
 * Empty when the section has no help or there is no panel. Touch is left out:
 * a tap focuses a control, which is what counts.
 */
export function useSectionHelp(section: HelpSection | undefined) {
  const help = useWizardHelp();
  if (!help || !section) return {};
  return {
    onFocus: () => help.focusSection(section),
    onPointerEnter: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType !== "touch") help.hoverSection(section);
    },
    onPointerLeave: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType !== "touch") help.hoverSection(null);
    },
  };
}
