import { useEffect, useState } from "react";
import { Film, Image, Sparkles, Type } from "lucide-react";

import "./startup-intro.css";

const particles = Array.from({ length: 20 }, (_, index) => ({
    x: `${8 + ((index * 37) % 84)}%`,
    y: `${10 + ((index * 53) % 78)}%`,
    delay: `${(index % 7) * 0.13}s`,
}));

const convergenceStreams = [
    {
        id: "north-west",
        delay: 0.08,
        path: "M210 118 C468 105 650 116 760 250 C868 382 770 530 595 522 C432 515 350 402 410 286 C468 176 634 176 700 280 C756 368 686 446 570 420 C490 402 472 334 542 302",
    },
    {
        id: "north-east",
        delay: 0.14,
        path: "M990 142 C868 302 816 500 630 548 C450 594 304 474 340 302 C374 146 554 78 700 156 C840 234 866 404 750 488 C650 562 502 510 470 396 C446 312 520 246 658 303",
    },
    {
        id: "south-west",
        delay: 0.2,
        path: "M220 610 C350 438 360 236 545 180 C720 128 876 246 860 420 C845 584 680 664 520 596 C366 530 310 342 420 226 C520 122 700 164 770 300 C824 406 754 530 625 524 C520 520 456 426 535 392",
    },
    {
        id: "south-east",
        delay: 0.26,
        path: "M980 620 C732 636 546 600 445 456 C350 316 420 156 585 126 C744 96 884 206 900 366 C914 520 776 620 625 590 C480 562 390 430 435 300 C476 186 620 146 715 226 C800 296 804 420 720 484 C650 538 562 496 665 392",
    },
] as const;

const streamTrail = [
    { lag: 0.022, rx: 18, ry: 1.35, opacity: 0.66 },
    { lag: 0.044, rx: 13, ry: 1.1, opacity: 0.52 },
    { lag: 0.066, rx: 9, ry: 0.9, opacity: 0.4 },
    { lag: 0.088, rx: 5, ry: 0.75, opacity: 0.28 },
] as const;

export function StartupIntro() {
    const [visible, setVisible] = useState(() => !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const [exiting, setExiting] = useState(false);

    useEffect(() => {
        const prelude = document.getElementById("startup-prelude");
        prelude?.remove();
        if (!visible) return;

        const exitTimer = window.setTimeout(() => setExiting(true), 2300);
        const endTimer = window.setTimeout(() => setVisible(false), 2630);
        const skipOnEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") setVisible(false);
        };
        window.addEventListener("keydown", skipOnEscape);
        return () => {
            window.clearTimeout(exitTimer);
            window.clearTimeout(endTimer);
            window.removeEventListener("keydown", skipOnEscape);
        };
    }, [visible]);

    if (!visible) return null;

    return (
        <div className={`startup-intro${exiting ? " startup-intro--exit" : ""}`}>
            <div className="startup-intro__ambient" />
            <div className="startup-intro__grid" />
            <div className="startup-intro__horizon" />
            <div className="startup-intro__scan" />

            <div className="startup-intro__particles" aria-hidden="true">
                {particles.map((particle, index) => (
                    <i key={index} style={{ left: particle.x, top: particle.y, animationDelay: particle.delay }} />
                ))}
            </div>

            <svg className="startup-intro__network" viewBox="0 0 1200 700" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
                {convergenceStreams.map((stream, streamIndex) => {
                    const pathId = `startup-stream-${stream.id}`;
                    const duration = 0.92;

                    return (
                        <g className={`startup-intro__stream startup-intro__stream--${streamIndex + 1}`} key={stream.id}>
                            <path id={pathId} className="startup-intro__stream-guide" pathLength="1" d={stream.path} />
                            {streamTrail.map((particle, particleIndex) => {
                                const begin = stream.delay + particle.lag;

                                return (
                                    <ellipse className="startup-intro__stream-particle" cx="0" cy="0" rx={particle.rx} ry={particle.ry} key={particleIndex}>
                                        <animateMotion dur={`${duration}s`} begin={`${begin}s`} fill="freeze" rotate="auto">
                                            <mpath href={`#${pathId}`} />
                                        </animateMotion>
                                        <animate attributeName="opacity" values={`0;${particle.opacity};${particle.opacity * 0.8};0`} keyTimes="0;0.08;0.72;1" dur={`${duration}s`} begin={`${begin}s`} fill="freeze" />
                                    </ellipse>
                                );
                            })}
                            <ellipse className="startup-intro__stream-head" cx="0" cy="0" rx="22" ry="1.6">
                                <animateMotion dur={`${duration}s`} begin={`${stream.delay}s`} fill="freeze" rotate="auto">
                                    <mpath href={`#${pathId}`} />
                                </animateMotion>
                                <animate attributeName="opacity" values="0;0.96;0.92;0" keyTimes="0;0.06;0.78;1" dur={`${duration}s`} begin={`${stream.delay}s`} fill="freeze" />
                            </ellipse>
                        </g>
                    );
                })}
            </svg>

            <div className="startup-intro__node startup-intro__node--one" aria-hidden="true">
                <Image size={23} strokeWidth={1.4} />
                <span>IMAGE</span>
            </div>
            <div className="startup-intro__node startup-intro__node--two" aria-hidden="true">
                <Film size={23} strokeWidth={1.4} />
                <span>VIDEO</span>
            </div>
            <div className="startup-intro__node startup-intro__node--three" aria-hidden="true">
                <Type size={23} strokeWidth={1.4} />
                <span>TEXT</span>
            </div>
            <div className="startup-intro__node startup-intro__node--four" aria-hidden="true">
                <Sparkles size={23} strokeWidth={1.4} />
                <span>CREATE</span>
            </div>

            <div className="startup-intro__center">
                <div className="startup-intro__halo startup-intro__halo--outer" />
                <div className="startup-intro__halo startup-intro__halo--inner" />
                <div className="startup-intro__logo-frame" aria-hidden="true">
                    <i className="startup-intro__logo-fragment startup-intro__logo-fragment--north" />
                    <i className="startup-intro__logo-fragment startup-intro__logo-fragment--east" />
                    <i className="startup-intro__logo-fragment startup-intro__logo-fragment--south" />
                    <i className="startup-intro__logo-fragment startup-intro__logo-fragment--west" />
                    <i className="startup-intro__logo-flare" />
                </div>
                <div className="startup-intro__wordmark" aria-label="守守画布">
                    <span>守守画布</span>
                    <small>IMAGINATION, CONNECTED.</small>
                </div>
            </div>

            <div className="startup-intro__corner startup-intro__corner--top" aria-hidden="true">
                SS / SHOUSHOUHUABU <span>01—04</span>
            </div>
            <div className="startup-intro__corner startup-intro__corner--bottom" aria-hidden="true">
                <span>CREATIVE SYSTEM ONLINE</span>
                <span className="startup-intro__meter">
                    <i />
                </span>
            </div>
            <button className="startup-intro__skip" type="button" onClick={() => setVisible(false)} aria-label="跳过开场动画">
                跳过 <span>↗</span>
            </button>
        </div>
    );
}
