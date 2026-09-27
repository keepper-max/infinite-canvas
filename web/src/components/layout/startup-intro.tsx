import { useEffect, useState } from "react";
import { Film, Image, Sparkles, Type } from "lucide-react";

import "./startup-intro.css";

const particles = Array.from({ length: 20 }, (_, index) => ({
    x: `${8 + ((index * 37) % 84)}%`,
    y: `${10 + ((index * 53) % 78)}%`,
    delay: `${(index % 7) * 0.13}s`,
}));

export function StartupIntro() {
    const [visible, setVisible] = useState(() => !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const [exiting, setExiting] = useState(false);

    useEffect(() => {
        const prelude = document.getElementById("startup-prelude");
        prelude?.remove();
        if (!visible) return;

        const exitTimer = window.setTimeout(() => setExiting(true), 2250);
        const endTimer = window.setTimeout(() => setVisible(false), 2580);
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
                <path pathLength="1" d="M0 95 Q220 80 395 268 L542 302" />
                <path pathLength="1" d="M1200 95 Q970 100 805 255 L658 303" />
                <path pathLength="1" d="M0 600 Q250 610 420 430 L535 392" />
                <path pathLength="1" d="M1200 610 Q940 600 785 438 L665 392" />
                <path pathLength="1" d="M290 0 Q400 140 510 250 L570 329" />
                <path pathLength="1" d="M910 700 Q790 540 685 450 L634 329" />
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
