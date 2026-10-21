// Only recognized search fields may influence this same-origin return link.
const params = new URLSearchParams(location.search);
const clean = new URLSearchParams();
for (const key of ["q", "industry", "scenario", "capability", "page"])
  if (params.has(key)) clean.set(key, params.get(key));
const back = document.querySelector("#back-to-cases");
if (back instanceof HTMLAnchorElement && clean.size)
  back.href = "/ai-cases/?" + clean.toString();
