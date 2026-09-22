import { Coins, FileText, Gauge, ImagePlus, Images, Maximize2, MessageSquareText, Settings2, Video } from "lucide-react";

export const navigationTools = [
    {
        slug: "canvas",
        icon: Maximize2,
    },
    {
        slug: "image",
        icon: ImagePlus,
    },
    {
        slug: "video",
        icon: Video,
    },
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
