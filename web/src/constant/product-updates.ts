export type ProductUpdateItem = {
    type: "新增" | "优化" | "修复";
    title: string;
    description: string;
};

const zhCN: ProductUpdateItem[] = [
    {
        type: "新增",
        title: "漫剧工作流",
        description: "故事、剧本、角色、场景、首尾帧与视频节点可在同一画布自由组合。",
    },
    {
        type: "新增",
        title: "真实模型生成",
        description: "文本、图片与视频节点按能力自动匹配可用模型，并通过服务端安全调用。",
    },
    {
        type: "新增",
        title: "Seedance 漫剧 Skill",
        description: "支持运镜、角色一致性、动作、灯光、声音和连续性提示词整理。",
    },
    {
        type: "优化",
        title: "项目与画布恢复",
        description: "登录后直达默认项目，节点、连线、任务和生成结果可自动保存并在刷新后恢复。",
    },
    {
        type: "优化",
        title: "后台任务",
        description: "生成任务在页面关闭后继续运行，并支持进度恢复、取消和失败重试。",
    },
];

const enUS: ProductUpdateItem[] = [
    {
        type: "新增",
        title: "Drama production workflow",
        description: "Combine story, script, character, scene, keyframe, and video nodes freely on one canvas.",
    },
    {
        type: "新增",
        title: "Live model generation",
        description: "Text, image, and video nodes automatically use compatible models through the secure server gateway.",
    },
    {
        type: "新增",
        title: "Seedance drama skill",
        description: "Refine camera, character continuity, action, lighting, audio, and sequence prompts.",
    },
    {
        type: "优化",
        title: "Project and canvas recovery",
        description: "Open the default project after sign-in and restore nodes, edges, tasks, and results after refresh.",
    },
    {
        type: "优化",
        title: "Background jobs",
        description: "Generation continues after the page closes with progress recovery, cancellation, and retry support.",
    },
];

export function getProductUpdates(language?: string) {
    return language?.toLowerCase().startsWith("en") ? enUS : zhCN;
}
