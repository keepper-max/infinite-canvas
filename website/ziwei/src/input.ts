import type { LunarMonthPolicy } from "./engine/algorithm";
import type { ZiweiChart } from "./engine/types";

export type ZiweiInput = {
  date: string;
  time: string;
  gender: "male" | "female";
  birthplace: string;
  trueSolar: boolean;
  longitude: string;
  lateZishi: "next-day" | "current-day";
  leapMonth: LunarMonthPolicy;
};
export type ZiweiState = {
  input: ZiweiInput;
  interpretation?: { inputKey: string; text: string; model: string };
  result?: {
    inputKey: string;
    input: ZiweiInput;
    chart: ZiweiChart;
    effectiveDate: string;
    effectiveTime: string;
    generatedAt: string;
  };
  error?: string;
};
export const defaultZiweiInput: ZiweiInput = {
  date: "",
  time: "",
  gender: "male",
  birthplace: "",
  trueSolar: false,
  longitude: "",
  lateZishi: "next-day",
  leapMonth: "split",
};
export function ziweiInputKey(input: ZiweiInput) {
  return JSON.stringify([
    input.date,
    input.time,
    input.gender,
    input.birthplace.trim(),
    input.trueSolar,
    input.trueSolar ? input.longitude : "",
    input.lateZishi,
    input.leapMonth,
  ]);
}
export function ziweiReady(state?: ZiweiState) {
  return Boolean(
    state?.result &&
    !state.error &&
    state.result.inputKey === ziweiInputKey(state.input),
  );
}
// Send chart facts and calculation conventions only, excluding the raw birth date, time and birthplace.
export function ziweiContext(state?: ZiweiState): string | undefined {
  if (!ziweiReady(state)) return undefined;
  const { chart } = state!.result!;
  return (
    "紫微斗数命盘（传统文化与内容创作参考）\n" +
    JSON.stringify({
      conventions: {
        calendar: "公历转农历，正月初一换年",
        timezone: "UTC+8 标准时间",
        trueSolar: state!.input.trueSolar,
        lateZishi: state!.input.lateZishi,
        leapMonth: state!.input.leapMonth,
      },
      wuxingJu: chart.wuxingJuName,
      mingZhu: chart.mingZhu,
      shenZhu: chart.shenZhu,
      palaces: chart.palaces.map((p) => ({
        name: p.name,
        branch: p.branch,
        stem: p.stem,
        isMingGong: p.isMingGong,
        isShenGong: p.isShenGong,
        stars: p.stars.map((s) => ({
          name: s.name,
          type: s.type,
          siHua: s.siHua,
          brightness: s.brightnessRaw,
        })),
      })),
    })
  );
}
