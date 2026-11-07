import localforage from "localforage";
import {
  defaultZiweiInput,
  ziweiInputKey,
  ziweiReady,
  type ZiweiInput,
  type ZiweiState,
} from "./input";
import { BRANCHES, STEMS } from "./engine/constants";
import { chartKnowledge } from "./knowledge";
import { interpretationPrompt, createInterpretRequest, requestInterpretation } from "./interpret";

const store = localforage.createInstance({
  name: "shoumiren-ziwei",
  storeName: "birth_chart",
});
const form = document.querySelector<HTMLFormElement>("#birth-form")!;
const fields = document.querySelector<HTMLFieldSetElement>("#birth-fields")!;
const chart = document.querySelector<HTMLDivElement>("#chart")!;
const notice = document.querySelector<HTMLParagraphElement>("#notice")!;
const status = document.querySelector<HTMLSpanElement>("#chart-status")!;
const error =
  document.querySelector<HTMLParagraphElement>("#calculation-error")!;
const save = document.querySelector<HTMLButtonElement>("#save")!;
const copy = document.querySelector<HTMLButtonElement>("#copy")!;
const download = document.querySelector<HTMLButtonElement>("#export")!;
const clear = document.querySelector<HTMLButtonElement>("#clear")!;
const generate = document.querySelector<HTMLButtonElement>("#generate")!;
const interpret = document.querySelector<HTMLButtonElement>("#interpret")!;
const interpretation = document.querySelector<HTMLDivElement>("#interpretation")!;
const interpretationStatus = document.querySelector<HTMLParagraphElement>("#interpretation-status")!;
let state: ZiweiState = { input: { ...defaultZiweiInput } };
let revision = 0;
let busy = false;
let storing = false;
let saved = false;
let interpreting = false;

function control(name: keyof ZiweiInput) {
  return form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement;
}
function readInput(): ZiweiInput {
  return {
    date: control("date").value,
    time: control("time").value,
    gender: control("gender").value as ZiweiInput["gender"],
    birthplace: control("birthplace").value,
    trueSolar: (control("trueSolar") as HTMLInputElement).checked,
    longitude: control("longitude").value,
    lateZishi: control("lateZishi").value as ZiweiInput["lateZishi"],
    leapMonth: control("leapMonth").value as ZiweiInput["leapMonth"],
  };
}
function fillInput(input: ZiweiInput) {
  for (const key of Object.keys(defaultZiweiInput) as (keyof ZiweiInput)[]) {
    if (key === "trueSolar")
      (control(key) as HTMLInputElement).checked = input.trueSolar;
    else control(key).value = String(input[key]);
  }
}
function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
) {
  const result = document.createElement(tag);
  result.className = className;
  if (text !== undefined) result.textContent = text;
  return result;
}
function renderChart() {
  chart.replaceChildren();
  const clues = document.querySelector<HTMLElement>("#pattern-clues")!;
  clues.replaceChildren();
  const result = state.result;
  if (!result) return;
  const knowledge = chartKnowledge(result.chart);
  clues.append(element("h3", "", "格局线索 · 传统规则参考"));
  if (!knowledge.patterns.length) clues.append(element("p", "hint", "当前规则未识别到特定格局，不代表命盘缺少信息。"));
  for (const pattern of knowledge.patterns) {
    const detail = element("details", "settings");
    const level = { excellent: "成格线索", good: "有利线索", neutral: "中性线索", caution: "留意线索" }[pattern.level];
    detail.append(element("summary", "", `${pattern.name} · ${level}`));
    for (const [label, items] of [["成立条件", pattern.conditions?.required], ["加分条件", pattern.conditions?.bonus], ["破格条件", pattern.conditions?.breaking]] as const) {
      if (items?.length) detail.append(element("p", "hint", `${label}：${items.join("；")}`));
    }
    if (pattern.source) detail.append(element("p", "hint", `规则标注出处：${pattern.source}（沿用参考项目标注）`));
    clues.append(detail);
  }
  const center = element("div", "chart-center");
  center.append(
    element("span", "eyebrow", "ZIWEI DOUSHU"),
    element("h3", "", result.chart.wuxingJuName),
  );
  center.append(
    element(
      "strong",
      "",
      `${result.chart.mingZhu || ""} · ${result.chart.shenZhu || ""}`,
    ),
  );
  center.append(
    element("p", "", `${result.effectiveDate} ${result.effectiveTime}`),
  );
  center.append(
    element(
      "p",
      "",
      `${result.input.gender === "male" ? "男" : "女"} · ${result.input.birthplace}`,
    ),
  );
  center.append(
    element(
      "p",
      "",
      result.input.trueSolar ? "真太阳时 · 已校正一次" : "UTC+8 · 标准时间",
    ),
  );
  center.append(element("p", "", "十二宫 · 十四主星"));
  chart.append(center);
  const positions = [14, 13, 12, 8, 4, 0, 1, 2, 3, 7, 11, 15];
  for (const palace of result.chart.palaces) {
    const card = element("article", "palace");
    card.style.gridColumn = String((positions[palace.branch] % 4) + 1);
    card.style.gridRow = String(Math.floor(positions[palace.branch] / 4) + 1);
    card.dataset.life = String(Boolean(palace.isMingGong));
    const title = element(
      "div",
      "palace-title",
      `${palace.name}${palace.isShenGong ? " · 身" : ""}`,
    );
    title.append(
      element("span", "", `${STEMS[palace.stem]}${BRANCHES[palace.branch]}`),
    );
    const stars = (major: boolean) =>
      palace.stars
        .filter((star) => (star.type === "major") === major)
        .map(
          (star) =>
            `${star.name}${star.siHua ? `化${star.siHua}` : ""}${major && star.brightnessRaw ? ` ${star.brightnessRaw}` : ""}`,
        )
        .join(" · ");
    card.append(
      title,
      element("div", "major-stars", stars(true) || "空宫"),
      element("div", "other-stars", stars(false)),
    );
    chart.append(card);
  }
}
function render() {
  const ready = ziweiReady(state);
  const stale = Boolean(state.result && !ready);
  fields.disabled = busy;
  generate.textContent = busy
    ? "正在排盘…"
    : state.result
      ? "重新生成命盘 ↗"
      : "生成十二宫命盘 ↗";
  form.setAttribute("aria-busy", String(busy));
  status.textContent = busy
    ? "正在计算"
    : state.error
      ? "排盘失败"
      : stale
        ? "旧结果 · 请重新排盘"
        : ready
          ? "命盘已生成"
          : "待填写资料";
  status.dataset.state = ready ? "ready" : stale ? "stale" : "idle";
  error.hidden = !state.error;
  error.textContent = state.error || "";
  document.querySelector<HTMLElement>("#longitude-field")!.hidden =
    !state.input.trueSolar;
  document.querySelector<HTMLElement>("#empty-chart")!.hidden = Boolean(
    state.result,
  );
  document.querySelector<HTMLElement>("#stale-note")!.hidden = !stale;
  chart.hidden = !state.result;
  document.querySelector<HTMLElement>("#pattern-clues")!.hidden = !ready;
  save.disabled = busy || storing;
  copy.disabled = download.disabled = busy || !ready;
  clear.disabled = busy || storing || !saved;
  interpret.disabled = busy || interpreting || !ready;
  interpret.textContent = interpreting ? "正在解读，请勿重复提交…" : "在本页生成 AI 解读";
  const currentInterpretation = ready && state.interpretation?.inputKey === state.result?.inputKey;
  interpretation.hidden = !currentInterpretation;
  interpretation.textContent = currentInterpretation ? state.interpretation!.text : "";
}
const onInput = () => {
  revision++;
  state = { ...state, input: readInput(), error: undefined };
  interpretationStatus.textContent = interpreting ? "正在处理先前的命盘；输入已变更，其结果不会用于新资料。" : "同一 IP 滚动 24 小时最多 2 次；发往供应商的请求即计次，失败不自动重试。";
  notice.textContent = saved
    ? "当前修改尚未保存；重新排盘后可更新本机记录。"
    : "资料仅在当前页面，点击「保存本机」后可在同一浏览器恢复。";
  render();
};
form.addEventListener("input", onInput);
form.addEventListener("change", onInput);
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy) return;
  busy = true;
  const input = readInput();
  const key = ziweiInputKey(input);
  state = { ...state, input, error: undefined };
  render();
  try {
    const { generateZiwei } = await import("./calculate");
    const result = generateZiwei(input);
    if (key !== ziweiInputKey(state.input)) return;
    revision++;
    state = { input, result };
    renderChart();
    notice.textContent =
      "命盘已生成。可保存本机、导出结构化结果，或复制不含原始出生资料的 AI 解读资料。";
  } catch (cause) {
    if (key === ziweiInputKey(state.input))
      state = {
        ...state,
        error:
          cause instanceof Error
            ? `排盘失败：${cause.message}`
            : "排盘失败，请检查资料后重试",
      };
  } finally {
    busy = false;
    render();
  }
});
save.addEventListener("click", async () => {
  if (save.disabled) return;
  const snapshot = structuredClone(state),
    version = revision;
  storing = true;
  render();
  try {
    await store.setItem("last-chart", { version: 1, state: snapshot });
    saved = true;
    notice.textContent =
      version === revision
        ? "已保存到本机浏览器，刷新或重新打开本页可恢复。不会跨设备同步。"
        : "已保存点击时的资料；当前新改动尚未保存。";
  } catch {
    notice.textContent =
      "本机保存失败，浏览器可能限制了存储；请导出 JSON 保留记录。";
  } finally {
    storing = false;
    render();
  }
});
clear.addEventListener("click", async () => {
  if (clear.disabled) return;
  storing = true;
  render();
  try {
    await store.removeItem("last-chart");
    saved = false;
    notice.textContent =
      "本机记录已清除，当前页面中的资料仍然保留；再次打开本页将不会自动恢复。";
  } catch {
    notice.textContent = "清除失败，请检查浏览器存储权限后重试。";
  } finally {
    storing = false;
    render();
  }
});
copy.addEventListener("click", async () => {
  if (!ziweiReady(state) || busy) return;
  try {
    const prompt = interpretationPrompt(state);
    await navigator.clipboard.writeText(prompt);
    notice.textContent =
      "已复制命盘资料。打开 AI 文本工作台，粘贴后选择现有模型发送；资料不含原始出生日期、时分和出生地。";
  } catch {
    notice.textContent =
      "浏览器未允许复制，请先导出 JSON；本页不会自动提交模型请求。";
  }
});
download.addEventListener("click", () => {
  if (!ziweiReady(state) || busy) return;
  const record = {
    version: 1,
    source: "https://github.com/Renhuai123/ziwei-doushu",
    state,
  };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(record, null, 2)], { type: "application/json" }),
  );
  const link = element("a", "");
  link.href = url;
  link.download = "shoumiren-ziwei-chart.json";
  document.body.append(link);
  link.click();
  link.remove();
  // The browser has received the download request; no remote service is contacted.
  setTimeout(() => URL.revokeObjectURL(url), 0);
  notice.textContent =
    "已导出 JSON（含出生资料及结构化命盘），请自行妥善保管文件。";
});

function isSavedState(value: unknown): value is ZiweiState {
  if (!value || typeof value !== "object") return false;
  const item = value as ZiweiState;
  if (!item.input || typeof item.input !== "object") return false;
  if (item.interpretation && (typeof item.interpretation.inputKey !== "string" || typeof item.interpretation.text !== "string" || typeof item.interpretation.model !== "string")) return false;
  for (const key of Object.keys(defaultZiweiInput) as (keyof ZiweiInput)[]) {
    if (typeof item.input[key] !== typeof defaultZiweiInput[key]) return false;
  }
  if (
    !["male", "female"].includes(item.input.gender) ||
    !["next-day", "current-day"].includes(item.input.lateZishi) ||
    !["split", "prev-month", "next-month", "origin-month"].includes(
      item.input.leapMonth,
    )
  )
    return false;
  if (!item.result) return true;
  const result = item.result;
  if (
    typeof result.inputKey !== "string" ||
    !result.input ||
    typeof result.effectiveDate !== "string" ||
    typeof result.effectiveTime !== "string"
  )
    return false;
  const palaces = result.chart?.palaces;
  return (
    Array.isArray(palaces) &&
    palaces.length === 12 &&
    new Set(palaces.map((p) => p.branch)).size === 12 &&
    palaces.every(
      (p) =>
        Number.isInteger(p.branch) &&
        p.branch >= 0 &&
        p.branch <= 11 &&
        Number.isInteger(p.stem) &&
        p.stem >= 0 &&
        p.stem <= 9 &&
        typeof p.name === "string" &&
        Array.isArray(p.stars) &&
        p.stars.every((s) => typeof s.name === "string"),
    )
  );
}
async function restore() {
  const version = revision;
  try {
    const record = await store.getItem<{ version: number; state: unknown }>(
      "last-chart",
    );
    if (version !== revision) return;
    if (!record)
      notice.textContent =
        "资料仅在当前页面，点击「保存本机」后可在同一浏览器恢复。";
    else if (record.version !== 1 || !isSavedState(record.state))
      notice.textContent =
        "发现无法读取的旧记录，已保留原记录。你可以重新排盘后保存，或选择清除本机记录。";
    else {
      state = record.state;
      saved = true;
      fillInput(state.input);
      renderChart();
      notice.textContent = state.result
        ? "已恢复本机保存的出生资料与命盘。"
        : "已恢复本机保存的出生资料草稿，尚未生成命盘。";
    }
    if (record) saved = true;
  } catch {
    notice.textContent = "无法读取本机存储，仍可排盘；请导出 JSON 保留结果。";
  } finally {
    fields.disabled = false;
    render();
  }
}
void restore();

interpret.addEventListener("click", async () => {
  if (interpret.disabled || !ziweiReady(state)) return;
  interpreting = true;
  const key = state.result!.inputKey;
  const version = revision;
  const snapshot = structuredClone(state);
  interpretationStatus.textContent = "正在生成本次命盘的解读。请保持页面打开；不会跳转到画布。";
  render();
  try {
    const request = await createInterpretRequest(snapshot);
    // Input may have changed while WebCrypto was running; avoid spending a call.
    if (version !== revision) return;
    const result = await requestInterpretation(request);
    if (version !== revision || !ziweiReady(state) || key !== state.result?.inputKey) {
      interpretationStatus.textContent = "先前命盘的解读已返回，但资料已改变，本次结果未应用。该请求已计次。";
      return;
    }
    state = {...state,interpretation:{inputKey:key,text:result.text,model:result.model || "deepseek-v4.1-flash-1017"}};
    revision++;
    interpretationStatus.textContent = `解读已生成 · DeepSeek V4.1 Flash 1017${typeof result.remainingCalls === "number" ? ` · 本次提交时剩余 ${result.remainingCalls} 次` : ""}。点击「保存本机」可连同命盘保存。`;
  } catch (cause) {
    if (version === revision) interpretationStatus.textContent = cause instanceof Error ? cause.message : "解读暂不可用，请稍后重试";
  } finally { interpreting = false; render(); }
});
