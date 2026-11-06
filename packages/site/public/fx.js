// Page effects: frosted top bar once scrolled, scroll reveal, 3D tilt, hero parallax.
// Reduced-motion users get the static page: no reveal, tilt or parallax.

const html = document.documentElement;
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
if (!reduce) html.classList.add("fx");

// Copyright and "Looks like <year>": static fallback in the HTML, current year here.
for (const el of document.querySelectorAll(".year")) el.textContent = String(new Date().getFullYear());

// --- top bar + hero parallax (one rAF per scroll, no layout reads) ---
const shot = document.getElementById("shot");
let scrollFrame = 0;
function onScroll() {
  cancelAnimationFrame(scrollFrame);
  scrollFrame = requestAnimationFrame(() => {
    html.dataset.scrolled = scrollY > 8 ? "yes" : "no";
    if (reduce || !shot) return;
    // The hero screenshot leans back a little at the top and straightens while it scrolls up, a bit slower than the page.
    const p = Math.min(1, scrollY / 700);
    shot.style.translate = `0 ${p * 24}px`;
    shot.style.rotate = `x ${(1 - p) * 9}deg`;
  });
}
onScroll();
addEventListener("scroll", onScroll, { passive: true });

// --- 3D tilt of [data-tilt-card] towards the pointer (same pattern as marketplace effects.tsx) ---
let card = null;
function release() {
  card?.style.removeProperty("transform");
  card?.classList.remove("is-tilting");
  card = null;
}
addEventListener(
  "pointermove",
  (e) => {
    if (reduce || e.pointerType !== "mouse") return release();
    const el = e.target.closest?.("[data-tilt-card]");
    if (el !== card) release();
    if (!el) return;
    card = el;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    const k = Math.min(1, 480 / r.width); // big cards lean less
    el.classList.add("is-tilting");
    el.style.transform = `perspective(1000px) rotateX(${(0.5 - y) * 7 * k}deg) rotateY(${(x - 0.5) * 9 * k}deg)`;
    el.style.setProperty("--gx", `${x * 100}%`);
    el.style.setProperty("--gy", `${y * 100}%`);
  },
  { passive: true },
);
document.addEventListener("pointerleave", release);

// --- scroll reveal ---
const io =
  !reduce &&
  new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const el = e.target;
        io.unobserve(el);
        el.classList.add("in");
        // Drop the reveal styles once in, so the tilt's own transition takes over.
        setTimeout(() => el.classList.remove("reveal", "in"), 900 + (parseFloat(el.style.getPropertyValue("--d")) || 0));
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
  );

export function reveal(els) {
  if (!io) return;
  for (const el of els) {
    const i = [...el.parentElement.children].indexOf(el);
    el.classList.add("reveal");
    if (i > 0) el.style.setProperty("--d", `${(i % 4) * 80}ms`);
    io.observe(el);
  }
}
reveal(
  document.querySelectorAll(
    "section > .eyebrow, section > h2, .section-lede, .vs-col, .steps li, .tile, .code, .os, .cli, .unsigned, .agents, .support > *",
  ),
);
