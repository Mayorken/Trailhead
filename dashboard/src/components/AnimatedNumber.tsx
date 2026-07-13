import { useEffect, useRef } from "react";
import { animate, useMotionValue, useReducedMotion } from "framer-motion";

interface Props {
  /** Target value already converted to a plain number (e.g. via Number(ethers.formatUnits(...))). */
  value: number;
  /** Format the animated float for display, e.g. toLocaleString with fixed decimals. */
  format: (n: number) => string;
  className?: string;
}

// Tweens a numeric display value on change — the count climbs like a trail elevation
// profile filling in, rather than jumping straight to the new total. Purely cosmetic:
// callers should read the exact underlying value (not this component) for any real logic.
//
// animate(motionValue, target) always starts from the motion value's current position, so
// this is safe under StrictMode's mount->cleanup->mount dev double-invoke: the interrupted
// first run's cleanup stops the value wherever it got to, and the second run continues from
// there to the same target — no manual "resume from" bookkeeping needed.
export function AnimatedNumber({ value, format, className }: Props) {
  const spanRef = useRef<HTMLSpanElement>(null);
  const motionValue = useMotionValue(0);
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    if (!spanRef.current) return;

    if (shouldReduceMotion) {
      motionValue.set(value);
      spanRef.current.textContent = format(value);
      return;
    }

    const controls = animate(motionValue, value, {
      duration: 0.9,
      ease: [0.23, 1, 0.32, 1],
      onUpdate: (latest) => {
        if (spanRef.current) spanRef.current.textContent = format(latest);
      },
    });
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, shouldReduceMotion]);

  return (
    <span ref={spanRef} className={className}>
      {format(0)}
    </span>
  );
}
