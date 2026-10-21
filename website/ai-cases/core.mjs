export const PAGE_SIZE = 6;
export const FILTERS = ["industry", "scenario", "capability"];

export function safeSource(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function readState(search, cases) {
  const params = new URLSearchParams(search);
  const state = {
    q: (params.get("q") || "").trim(),
    industry: "",
    scenario: "",
    capability: "",
    page: 1,
  };
  for (const key of FILTERS) {
    const value = params.get(key) || "";
    if (
      cases.some((c) =>
        key === "capability"
          ? c.capabilities.includes(value)
          : c[key] === value,
      )
    )
      state[key] = value;
  }
  const page = params.get("page") || "1";
  state.page =
    /^\d+$/.test(page) && Number.isSafeInteger(Number(page))
      ? Math.max(1, Number(page))
      : 1;
  return state;
}

export function queryString(state) {
  const params = new URLSearchParams();
  for (const key of ["q", ...FILTERS])
    if (state[key]) params.set(key, state[key]);
  if (state.page > 1) params.set("page", String(state.page));
  return params.size ? "?" + params.toString() : "";
}

export function findCases(cases, state) {
  const terms = state.q.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return cases.filter((c) => {
    const text = [
      c.title,
      c.company,
      c.industry,
      c.scenario,
      ...c.capabilities,
      c.background,
      c.problem,
      c.solution,
      c.outcome,
    ]
      .join(" ")
      .toLocaleLowerCase();
    return (
      terms.every((term) => text.includes(term)) &&
      FILTERS.every(
        (key) =>
          !state[key] ||
          (key === "capability"
            ? c.capabilities.includes(state[key])
            : c[key] === state[key]),
      )
    );
  });
}
