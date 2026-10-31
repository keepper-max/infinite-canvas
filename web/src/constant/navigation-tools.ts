import { BookImage, BookOpen, Box, Clapperboard, Coins, FileText, Gauge, ImagePlus, Images, Maximize2, MessageSquareText, Settings2, Scissors, Video } from "lucide-react";

export const navigationTools = [
    { slug: "knowledge", icon: BookOpen },
    {
        slug: "canvas",
        icon: Maximize2,
    },
    {
        slug: "director",
        icon: Clapperboard,
    },
    {
        slug: "director-desk",
        icon: Box,
    },
    { slug: "pose-costume", icon: BookImage },
    {
        slug: "image",
        icon: ImagePlus,
    },
    {
        slug: "video",
        icon: Video,
    },
    { slug: "autocut", icon: Scissors },
    {
        slug: "text",
        icon: MessageSquareText,
    },
    {
        slug: "prompts",
        icon: FileText,
    },
    {
        slug: "assets",
        icon: Images,
    },
    {
        slug: "credits",
        icon: Coins,
    },
    {
        slug: "config",
        icon: Settings2,
    },
    {
        slug: "operations",
        icon: Gauge,
    },
] as const;

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];

export function navigationToolHref(slug: NavigationToolSlug, pathname: string) {
    if (slug === "pose-costume" && /^\/canvas\/[^/]+\/?$/.test(pathname)) return `${pathname.replace(/\/$/, "")}?open=pose-costume`;
    return `/${slug}`;
}
