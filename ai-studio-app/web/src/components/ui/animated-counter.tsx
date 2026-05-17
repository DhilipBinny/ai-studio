"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useSpring, useTransform, type MotionValue } from "framer-motion";

interface AnimatedCounterProps {
  value: number;
  className?: string;
}

export function AnimatedCounter({ value, className }: AnimatedCounterProps) {
  const [displayValue, setDisplayValue] = useState(0);
  const prevValue = useRef(0);

  useEffect(() => {
    const start = prevValue.current;
    const end = value;
    if (start === end) return;

    const duration = Math.min(1200, Math.max(400, Math.abs(end - start) * 20));
    const startTime = performance.now();

    function tick(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(start + (end - start) * eased);
      setDisplayValue(current);

      if (progress < 1) {
        requestAnimationFrame(tick);
      } else {
        prevValue.current = end;
      }
    }

    requestAnimationFrame(tick);
  }, [value]);

  return (
    <span className={className}>
      {displayValue.toLocaleString()}
    </span>
  );
}

const DIGIT_HEIGHT = 40;

interface RollingDigitProps {
  value: number;
  fontSize?: number;
}

function SingleDigit({ mv, digit }: { mv: MotionValue<number>; digit: number }) {
  const y = useTransform(mv, (latest) => {
    const placeValue = latest % 10;
    let offset = (10 + digit - placeValue) % 10;
    if (offset > 5) offset -= 10;
    return offset * DIGIT_HEIGHT;
  });

  return (
    <motion.span
      style={{ y }}
      className="absolute inset-0 flex items-center justify-center"
    >
      {digit}
    </motion.span>
  );
}

function Digit({ place, value }: { place: number; value: number }) {
  const rounded = Math.floor(value / place);
  const spring = useSpring(rounded, { stiffness: 100, damping: 20 });

  useEffect(() => {
    spring.set(rounded);
  }, [spring, rounded]);

  return (
    <div
      style={{ height: DIGIT_HEIGHT }}
      className="relative w-[1ch] tabular-nums overflow-hidden"
    >
      {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
        <SingleDigit key={d} mv={spring} digit={d} />
      ))}
    </div>
  );
}

export function RollingCounter({ value, fontSize = 30 }: RollingDigitProps) {
  const digits: number[] = [];
  let remaining = Math.max(1, value);
  while (remaining >= 1) {
    digits.unshift(remaining % 10);
    remaining = Math.floor(remaining / 10);
  }

  const places = digits.map((_, i) => Math.pow(10, digits.length - 1 - i));

  return (
    <span
      style={{ fontSize }}
      className="inline-flex overflow-hidden leading-none font-semibold"
    >
      {places.map((place, i) => (
        <Digit key={place} place={place} value={value} />
      ))}
    </span>
  );
}
