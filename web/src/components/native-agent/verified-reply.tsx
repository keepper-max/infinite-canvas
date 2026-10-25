import { useEffect, useState } from "react";
/** Only materialized server-projected text reaches this component, never raw model deltas. */
export default function VerifiedReply({ text, animate }: { text: string; animate: boolean }) {
    const [visible, setVisible] = useState(animate ? 0 : text.length);
    useEffect(() => {
        if (!animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            setVisible(text.length);
            return;
        }
        let frame = 0,
            start: number | undefined;
        const tick = (time: number) => {
            start ??= time;
            const count = Math.min(text.length, Math.floor((time - start) / 4));
            setVisible(count);
            if (count < text.length) frame = requestAnimationFrame(tick);
        };
        const finish = () => {
            if (document.hidden) {
                cancelAnimationFrame(frame);
                setVisible(text.length);
            }
        };
        frame = requestAnimationFrame(tick);
        document.addEventListener("visibilitychange", finish);
        return () => {
            cancelAnimationFrame(frame);
            document.removeEventListener("visibilitychange", finish);
        };
    }, [text, animate]);
    return (
        <div className="whitespace-pre-wrap break-words text-sm leading-7" aria-label="助手回复" aria-busy={visible < text.length}>
            {text.slice(0, visible)}
            {visible < text.length && <span className="sr-only">回复已核验，正在展开</span>}
        </div>
    );
}
