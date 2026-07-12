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
