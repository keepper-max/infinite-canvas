import { generateChart } from "./engine/algorithm";
import {
  calculateTrueSolarTime,
  isValidGregorianDate,
  resolveZiweiDayOffset,
  shiftGregorianDate,
  formatTrueSolarClock,
} from "./engine/true-solar-time";
import { ziweiInputKey, type ZiweiInput, type ZiweiState } from "./input";

export function generateZiwei(
  input: ZiweiInput,
): NonNullable<ZiweiState["result"]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date))
    throw new Error("请填写有效的公历出生日期");
  const [year, month, day] = input.date.split("-").map(Number);
  if (!isValidGregorianDate(year, month, day))
    throw new Error("出生日期不存在，请检查月份和日期");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time))
    throw new Error("请填写出生时间，格式为 00:00–23:59");
  if (input.gender !== "male" && input.gender !== "female")
    throw new Error("请选择性别");
  if (!input.birthplace.trim()) throw new Error("请填写出生地");
  if (!["next-day", "current-day"].includes(input.lateZishi))
    throw new Error("请选择晚子时口径");
  if (
    !["split", "prev-month", "next-month", "origin-month"].includes(
      input.leapMonth,
    )
  )
    throw new Error("请选择闰月口径");
  const longitude = input.trueSolar ? Number(input.longitude) : undefined;
  if (
    input.trueSolar &&
    (!input.longitude.trim() ||
      !Number.isFinite(longitude) ||
      longitude! < -180 ||
      longitude! > 180)
  )
    throw new Error("真太阳时需要有效经度（−180 至 180，东经为正）");
  const [clockHour, clockMinute] = input.time.split(":").map(Number);
  const solar = calculateTrueSolarTime({
    year,
    month,
    day,
    clockHour,
    clockMinute,
    longitude,
    utcOffsetMinutes: 480,
  });
  const effective = shiftGregorianDate(
    { year, month, day },
    resolveZiweiDayOffset(solar, input.lateZishi),
  );
  const chart = generateChart(
    {
      ...effective,
      hour: solar.branch,
      gender: input.gender,
      origInput: { year, month, day, clockHour, clockMinute },
    },
    { leapMonth: input.leapMonth },
  );
  if (
    chart.palaces.length !== 12 ||
    new Set(chart.palaces.map((p) => p.branch)).size !== 12
  )
    throw new Error("排盘结果不完整，请检查资料后重试");
  return {
    inputKey: ziweiInputKey(input),
    input: { ...input },
    chart,
    effectiveDate: `${effective.year}-${String(effective.month).padStart(2, "0")}-${String(effective.day).padStart(2, "0")}`,
    effectiveTime: formatTrueSolarClock(solar),
    generatedAt: new Date().toISOString(),
  };
}
