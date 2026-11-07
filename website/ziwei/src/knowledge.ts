import { detectPatterns, getMingGongSummary } from "./engine/patterns";
import type { ZiweiChart } from "./engine/types";

export const KNOWLEDGE_VERSION = "a600484-single-1";
// Original neutral wording. The selection framework references heming-knowledge.ts:
// read 夫妻宫 together with 福德宫 and 命宫; this is a single chart, not a compatibility score.
const RELATIONSHIP_TOPICS: Record<string, string> = {
  紫微: "讨论自主性、相互尊重与共同决策。",
  天机: "讨论变化需求、沟通节奏与适应方式。",
  太阳: "讨论表达关心、主动付出与边界。",
  武曲: "讨论实际责任、资源安排与情感表达。",
  天同: "讨论舒适感、日常陪伴与责任分担。",
  廉贞: "讨论个人边界、情绪表达与关系约定。",
  天府: "讨论稳定感、生活安排与共同目标。",
  太阴: "讨论细腻感受、安全感与沟通偏好。",
  贪狼: "讨论社交需求、共同兴趣与个人空间。",
  巨门: "讨论语言表达、分歧协商与倾听。",
  天相: "讨论公平感、支持方式与合作习惯。",
  天梁: "讨论照顾、责任感与独立性。",
  七杀: "讨论独立需求、行动节奏与冲突修复。",
  破军: "讨论改变、重建习惯与共同适应。",
};

export function chartKnowledge(chart: ZiweiChart) {
  const relationships = chart.palaces.filter(p => ["夫妻", "夫妻宫", "福德", "福德宫", "命宫"].includes(p.name));
  return {
    version: KNOWLEDGE_VERSION,
    scope: "single-person",
    ming: getMingGongSummary(chart),
    patterns: detectPatterns(chart).map(({ name, level, palaces, conditions, source }) => ({ name, level, palaces, conditions, source })),
    relationshipFramework: {
      method: "结合命宫、夫妻宫与福德宫的实际星曜和四化，分别说明证据与不确定性；单人资料不进行双人匹配评分。",
      evidence: relationships.map(p => ({ palace: p.name, stars: p.stars.filter(s => s.type === "major" || s.siHua).map(s => ({ name: s.name, siHua: s.siHua || null })) })),
      topics: [...new Set(relationships.filter(p => p.name.startsWith("夫妻")).flatMap(p => p.stars.filter(s => s.type === "major").map(s => RELATIONSHIP_TOPICS[s.name]).filter(Boolean)))],
      emptyPalace: relationships.some(p => p.name.startsWith("夫妻") && !p.stars.some(s => s.type === "major")),
    },
  };
}
