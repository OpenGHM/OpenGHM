"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import type { HelpFacts, HelpSection, HelpStep } from "@/lib/workspace/wizard-help";

interface WizardHelp {
  step: HelpStep;
  facts: HelpFacts;
  /** The section whose help is shown, or null for the step's overview. */
  section: HelpSection | null;
  /** Focus moved into a section. The section stays until another one is
   *  focused or hovered, or `showOverview` is used, so the panel does not jump
   *  back when focus is on the page background or on the panel itself. */
  focusSection: (section: HelpSection) => void;
  /** The pointer entered a section. Leaving it changes nothing, so the pointer
   *  can cross to the panel, and the section stays like a focused one. */
  hoverSection: (section: HelpSection) => void;
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
 * focus or by the pointer entering it, whichever came last, and stays until
 * another is chosen or `showOverview` is used. The state starts over when the
 * step changes. Nothing here moves focus.
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
  const [section, setSection] = useState<HelpSection | null>(null);
  const [seenStep, setSeenStep] = useState(step);
  if (seenStep !== step) {
    setSeenStep(step);
    setSection(null);
  }

  const ignoreFocus = useRef(false);
  const focusSection = useCallback((next: HelpSection) => {
    if (!ignoreFocus.current) setSection(next);
  }, []);
  const hoverSection = useCallback((next: HelpSection) => setSection(next), []);
  const showOverview = useCallback(() => setSection(null), []);
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
      section,
      focusSection,
      hoverSection,
      showOverview,
      quietly,
    }),
    [step, climatologyAvailable, section, focusSection, hoverSection, showOverview, quietly]
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
  };
}
