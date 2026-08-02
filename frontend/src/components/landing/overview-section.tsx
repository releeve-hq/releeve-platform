"use client";

import { useRef } from "react";
import { motion, useScroll, useTransform, type MotionValue } from "framer-motion";

const LINES = [
  "Every deployment carries risk.",
  "Every transaction changes state.",
  "The best teams don't leave",
  "those outcomes to chance.",
  "They validate them first.",
];
const ALL_WORDS = LINES.flatMap((line) => line.split(" "));
const LINE_BOUNDARIES: number[] = [];
let cum = 0;
for (const line of LINES) {
  LINE_BOUNDARIES.push(cum);
  cum += line.split(" ").length;
}

function AnimatedWord({
  word,
  progress,
  index,
  total,
}: {
  word: string;
  progress: MotionValue<number>;
  index: number;
  total: number;
}) {
  const start = (index / total) * 0.72;
  const end = start + 0.22;
  const color = useTransform(
    progress,
    [start, end],
    ["rgba(255, 255, 255, 0.12)", "rgba(255, 255, 255, 0.95)"]
  );
  return (
    <motion.span style={{ color }} className="inline-block">
      {word}&nbsp;
    </motion.span>
  );
}

export function OverviewSection() {
  const containerRef = useRef<HTMLElement>(null);

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end end"],
  });

  return (
    <section
      id="overview"
      ref={containerRef}
      className="relative min-h-[200svh]"
    >
      <div className="sticky top-0 flex items-start pt-24 sm:pt-28 lg:pt-32 min-h-svh w-full">
        <div className="mx-auto w-full max-w-[1400px] px-6 lg:px-12">
          <p
            className="text-balance leading-[1.04] tracking-[-0.06em]"
            style={{
              fontFamily: "var(--font-display, inherit)",
              fontSize: "clamp(2rem, 4.7vw, 4.4rem)",
            }}
          >
            {LINES.map((line, li) => (
              <span key={li} className="block">
                {line.split(" ").map((word, wi) => {
                  const gi = LINE_BOUNDARIES[li] + wi;
                  return (
                    <AnimatedWord
                      key={`${word}-${gi}`}
                      word={word}
                      progress={scrollYProgress}
                      index={gi}
                      total={ALL_WORDS.length}
                    />
                  );
                })}
              </span>
            ))}
          </p>
        </div>
      </div>
    </section>
  );
}