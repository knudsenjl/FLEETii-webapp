// A heading that animates in one character at a time, purely as a visual
// flourish (e.g. LoginPage's welcome text). Accessibility: the animated text
// is aria-hidden and a plain sr-only span with the full text is rendered
// alongside it, so screen readers get the complete heading immediately
// rather than reading it out character-by-character or reading it twice.
import { useEffect, useState } from "react";

interface TypingHeaderProps {
  text: string;
  className?: string;
  /** ms per character */
  speed?: number;
  /** delay before typing starts, in ms */
  startDelay?: number;
  as?: "h1" | "h2" | "h3";
}

/** Heading that types `text` out one character at a time. Restarts from scratch if `text`, `speed`, or `startDelay` change while mounted. */
export function TypingHeader({
  text,
  className,
  speed = 45,
  startDelay = 150,
  as: Tag = "h1",
}: TypingHeaderProps) {
  const [visibleChars, setVisibleChars] = useState(0);

  useEffect(() => {
    setVisibleChars(0);
    let i = 0;
    let interval: ReturnType<typeof setInterval>;

    const timeout = setTimeout(() => {
      interval = setInterval(() => {
        i += 1;
        setVisibleChars(i);
        if (i >= text.length) clearInterval(interval);
      }, speed);
    }, startDelay);

    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [text, speed, startDelay]);

  return (
    <Tag className={className}>
      <span aria-hidden="true">{text.slice(0, visibleChars)}</span>
      <span className="sr-only">{text}</span>
    </Tag>
  );
}
