/**
 * Seedance 2.0 prompt skill distilled for the web assistant.
 * It intentionally contains production rules, not Codex-specific tool routing.
 */
export const SEEDANCE_20_SKILL_CONTEXT = `Seedance 2.0 漫剧提示词规则：
1. 先明确目标、模式（T2V/I2V/V2V/R2V/FLF2V/edit）、时长、比例、参考资产和音频需求；未知平台参数不要编造。
2. 每个参考资产只负责一个主要维度：身份、首帧、尾帧、环境、动作、镜头、音频或风格；写清保持什么、禁止转移什么。
3. 叙事镜头必须有一个可见节拍、一个主要运镜、一个有动机的光源、动作终点和声音意图；避免空泛的“电影感、震撼、超高清”。
4. 角色母版锁定脸部、发型、服装和体态；场景母版锁定空间结构；3D 构图锁定机位、比例、站位和视线；视频模型只负责运动、镜头、声音和连续性。
5. 中文提示词保持短而具体，优先写主体动作、空间变化、镜头路径、光线和声音；对复杂动作按初始状态→触发→变化→响应→收束顺序描述。
6. 出现真人、明星、品牌、版权角色、声音或规避审核意图时，先改写为获得授权的原创描述，不绕过安全限制。`;

export function buildSeedancePrompt(input: {
  nodeLabel: string;
  prompt: string;
  upstream?: string[];
}) {
  return `${SEEDANCE_20_SKILL_CONTEXT}\n\n当前节点：${input.nodeLabel}\n用户要求：${input.prompt}\n${input.upstream?.length ? `上游参考：${input.upstream.join("；")}` : ""}\n请输出：1)可直接提交的中文 Seedance 2.0 提示词；2)模式与参考资产建议；3)一个风险或连续性检查。`;
}
