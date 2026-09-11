import { nanoid } from "nanoid";

export type PromptSource = {
    id: string;
    name: string;
    description: string;
    url: string;
    homepage: string;
    enabled: boolean;
    builtIn: boolean;
};

export const PROMPT_REGISTRY_HOMEPAGE = "https://github.com/yukkcat/image-prompts";
const PROMPT_REGISTRY_SOURCE_BASE = "https://raw.githubusercontent.com/yukkcat/image-prompts/main/dist/sources";

export function createPromptSource(source?: Partial<PromptSource>): PromptSource {
    return {
        id: source?.id?.trim() || nanoid(),
        name: source?.name?.trim() || "",
        description: source?.description?.trim() || "自定义提示词集合",
        url: source?.url?.trim() || "",
        homepage: source?.homepage?.trim() || "",
        enabled: source?.enabled ?? true,
        builtIn: source?.builtIn ?? false,
    };
}

export const DEFAULT_PROMPT_SOURCES: PromptSource[] = [
    {
        id: "seedance-drama-templates",
        name: "Seedance 2.0 漫剧模板库",
        description: "面向漫剧分镜、运镜、角色一致性与声音设计的视频提示词模板。",
        url: "/seedance-prompts.json",
        homepage: "",
        enabled: true,
        builtIn: true,
    },
    registrySource("banana-prompt-quicker", "Banana Prompt Quicker", "适用于 Nano Banana 与 Gemini 的生图、改图和参考图提示词。", "https://glidea.github.io/banana-prompt-quicker/"),
    registrySource("davidwu-gpt-image2-prompts", "DavidWu GPT Image 2", "覆盖界面、海报、产品、人像和插画等分类的 GPT Image 2 精选案例。", "https://github.com/davidwuw0811-boop/awesome-gpt-image2-prompts"),
    registrySource("freestylefly-gpt-image-2", "Freestylefly GPT Image 2", "面向批量生产与工作流复用的结构化 GPT Image 2 提示词模板。", "https://github.com/freestylefly/awesome-gpt-image-2"),
    registrySource("awesome-gpt-image", "Awesome GPT Image", "聚焦写实、风格化与复杂创意实验的 GPT Image 2 提示词示例。", "https://github.com/ZeroLu/awesome-gpt-image"),
    registrySource("awesome-gpt4o-image-prompts", "Awesome GPT-4o", "包含创意说明和效果示例的 GPT-4o 图像提示词合集。", "https://github.com/ImgEdify/Awesome-GPT4o-Image-Prompts"),
    registrySource("youmind-gpt-image-2", "YouMind GPT Image 2", "持续更新的多语言 GPT Image 2 提示词库，覆盖文字排版与商业插画。", "https://github.com/YouMind-OpenLab/awesome-gpt-image-2"),
    registrySource("youmind-nano-banana-pro", "YouMind Nano Banana Pro", "覆盖人物、商品、海报、信息图和多种风格的 Nano Banana Pro 提示词。", "https://github.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts"),
];

function registrySource(id: string, name: string, description: string, homepage: string): PromptSource {
    return { id, name, description, url: `${PROMPT_REGISTRY_SOURCE_BASE}/${id}.json`, homepage, enabled: true, builtIn: true };
}
