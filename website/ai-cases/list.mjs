import { presentCases } from "./present.mjs";
import {
  PAGE_SIZE,
  FILTERS,
  readState,
  findCases,
  queryString,
} from "./core.mjs";

const form = /** @type {HTMLFormElement} */ (
  document.querySelector("#case-filters")
);
const results = /** @type {HTMLElement} */ (
  document.querySelector("#case-results")
);
const cards = [...results.querySelectorAll("article")];
const pagination = /** @type {HTMLElement} */ (
  document.querySelector("#pagination")
);
const empty = /** @type {HTMLElement} */ (
  document.querySelector("#empty-results")
);
const error = /** @type {HTMLElement} */ (
  document.querySelector("#case-error")
);
try {
  const response = await fetch("/ai-cases/cases.json");
  if (!response.ok) throw new Error("案例数据加载失败");
  const records = await response.json();
  if (!Array.isArray(records)) throw new Error("案例数据无效");
  const cases = presentCases(records);
  if (
    !Array.isArray(cases) ||
    cases.length !== cards.length ||
    cases.some(
      (c) =>
        !Array.isArray(c.capabilities) ||
        !cards.some((card) => card.dataset.caseId === c.id),
    )
  )
    throw new Error("案例数据与页面不一致");
  function render() {
    const state = readState(location.search, cases);
    for (const key of ["q", ...FILTERS]) {
      const control = form.elements.namedItem(key);
      if (
        control instanceof HTMLInputElement ||
        control instanceof HTMLSelectElement
      )
        control.value = state[key];
    }
    const matches = findCases(cases, state);
    const pages = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
    state.page = Math.min(state.page, pages);
    history.replaceState(null, "", "/ai-cases/" + queryString(state));
    const visible = new Set(
      matches
        .slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE)
        .map((c) => c.id),
    );
    for (const card of cards) {
      card.hidden = !visible.has(card.dataset.caseId);
      const link = card.querySelector("a");
      if (link)
        link.href =
          "/ai-cases/" + card.dataset.caseId + "/" + queryString(state);
    }
    empty.hidden = matches.length !== 0;
    document.querySelector("#case-status").textContent =
      `找到 ${matches.length} 个案例（共 ${cases.length} 个）` +
      (matches.length ? ` · 第 ${state.page} / ${pages} 页` : "");
    pagination.replaceChildren();
    if (pages > 1)
      for (let page = 1; page <= pages; page++) {
        const link = document.createElement("a");
        link.href = "/ai-cases/" + queryString({ ...state, page });
        link.textContent = String(page);
        link.setAttribute("aria-label", `第 ${page} 页`);
        if (page === state.page) link.setAttribute("aria-current", "page");
        pagination.append(link);
      }
  }
  const navigate = (search) => {
    history.pushState(null, "", "/ai-cases/" + search);
    render();
  };
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const values = new FormData(form);
    const params = new URLSearchParams();
    for (const [key, value] of values)
      if (typeof value === "string") params.set(key, value);
    const state = readState(params.toString(), cases);
    state.page = 1;
    navigate(queryString(state));
  });
  form.addEventListener("change", (event) => {
    if (event.target instanceof HTMLSelectElement) form.requestSubmit();
  });
  const clear = /** @type {HTMLAnchorElement} */ (
    document.querySelector("#clear-filters")
  );
  clear.addEventListener("click", (event) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    navigate("");
  });
  pagination.addEventListener("click", (event) => {
    const link =
      event.target instanceof Element ? event.target.closest("a") : null;
    if (
      !link ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    navigate(new URL(link.href).search);
    const status = /** @type {HTMLElement} */ (
      document.querySelector("#case-status")
    );
    status.tabIndex = -1;
    status.focus({ preventScroll: true });
    status.scrollIntoView({ block: "center" });
  });
  window.addEventListener("popstate", render);
  render();
} catch {
  cards.forEach((card) => {
    card.hidden = false;
  });
  empty.hidden = true;
  pagination.replaceChildren();
  error.hidden = false;
  document.querySelector("#case-status").textContent =
    `已显示 ${cards.length} 个案例，筛选暂时不可用。`;
  for (const control of form.querySelectorAll("input,select,button")) {
    if (
      control instanceof HTMLInputElement ||
      control instanceof HTMLSelectElement ||
      control instanceof HTMLButtonElement
    )
      control.disabled = true;
  }
}
