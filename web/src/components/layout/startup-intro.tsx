import { useEffect, useState } from "react";
import { Film, Image, Sparkles, Type } from "lucide-react";

import "./startup-intro.css";

const particles = Array.from({ length: 20 }, (_, index) => ({
    x: `${8 + ((index * 37) % 84)}%`,
    y: `${10 + ((index * 53) % 78)}%`,
    delay: `${(index % 7) * 0.13}s`,
}));

type PathPoint = readonly [number, number];

function createSmoothPath(points: readonly PathPoint[]) {
    if (points.length < 2) return "";

    const round = (value: number) => Math.round(value * 100) / 100;
    const commands = [`M${points[0][0]} ${points[0][1]}`];

    for (let index = 0; index < points.length - 1; index += 1) {
        const previous = points[index - 1] ?? points[index];
        const current = points[index];
        const next = points[index + 1];
        const following = points[index + 2] ?? next;
        const controlOneX = current[0] + (next[0] - previous[0]) / 6;
        const controlOneY = current[1] + (next[1] - previous[1]) / 6;
        const controlTwoX = next[0] - (following[0] - current[0]) / 6;
        const controlTwoY = next[1] - (following[1] - current[1]) / 6;

        commands.push(`C${round(controlOneX)} ${round(controlOneY)} ${round(controlTwoX)} ${round(controlTwoY)} ${next[0]} ${next[1]}`);
    }

    return commands.join(" ");
}

function createSpiralPath(start: PathPoint, end: PathPoint) {
    const center: PathPoint = [600, 350];
    const startX = start[0] - center[0];
    const startY = start[1] - center[1];
    const endX = end[0] - center[0];
    const endY = end[1] - center[1];
    const startRadius = Math.hypot(startX, startY);
    const endRadius = Math.hypot(endX, endY);
    const startAngle = Math.atan2(startY, startX);
    const endAngle = Math.atan2(endY, endX);
    const shortestAngularDelta = Math.atan2(Math.sin(endAngle - startAngle), Math.cos(endAngle - startAngle));
    const angularTravel = Math.PI * 2 + shortestAngularDelta;
    const sampleCount = 36;
    const points = Array.from({ length: sampleCount + 1 }, (_, index) => {
        const progress = index / sampleCount;
        const angle = startAngle + angularTravel * progress;
        const radius = startRadius + (endRadius - startRadius) * progress;

        return [center[0] + Math.cos(angle) * radius, center[1] + Math.sin(angle) * radius] as const;
    });

    points[0] = start;
    points[points.length - 1] = end;
    return createSmoothPath(points);
}

const convergenceStreamSpecs = [
    {
        id: "north-west",
        delay: 0.08,
        start: [210, 118],
        end: [542, 302],
    },
    {
        id: "north-east",
        delay: 0.14,
        start: [990, 142],
        end: [658, 303],
    },
    {
        id: "south-west",
        delay: 0.2,
        start: [220, 610],
        end: [535, 392],
    },
    {
        id: "south-east",
        delay: 0.26,
        start: [980, 620],
        end: [665, 392],
    },
] as const;

const convergenceStreams = convergenceStreamSpecs.map((stream) => ({ ...stream, path: createSpiralPath(stream.start, stream.end) }));

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
                                        <animateMotion dur={`${duration}s`} begin={`${begin}s`} fill="freeze" rotate="auto" calcMode="paced">
                                            <mpath href={`#${pathId}`} />
                                        </animateMotion>
                                        <animate attributeName="opacity" values={`0;${particle.opacity};${particle.opacity * 0.8};0`} keyTimes="0;0.08;0.72;1" dur={`${duration}s`} begin={`${begin}s`} fill="freeze" />
                                    </ellipse>
                                );
                            })}
                            <ellipse className="startup-intro__stream-head" cx="0" cy="0" rx="22" ry="1.6">
                                <animateMotion dur={`${duration}s`} begin={`${stream.delay}s`} fill="freeze" rotate="auto" calcMode="paced">
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
                <div className="startup-intro__wordmark" aria-label="守守画布，让想象，真正发生。从一个念头，到一个世界。">
                    <span className="startup-intro__brand-name">守守画布</span>
                    <strong className="startup-intro__primary-slogan">让想象，真正发生。</strong>
                    <small className="startup-intro__secondary-slogan">从一个念头，到一个世界。</small>
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
