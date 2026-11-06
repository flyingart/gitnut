import { detectCurrent } from "/detect.js";
import { reveal } from "/fx.js";

const $ = (id) => document.getElementById(id);
const origin = location.origin;
const CMD = { sh: `curl -fsSL ${origin}/install.sh | sh`, ps1: `irm ${origin}/install.ps1 | iex` };

// platform → [download key, OS label, sub label, icon]
const DESKTOP = {
  "darwin-arm64": ["desktop-darwin-arm64", "macOS", "Apple Silicon · .dmg", "apple"],
  "darwin-x64": ["desktop-darwin-x64", "macOS", "Intel · .dmg", "apple"],
  "windows-x64": ["desktop-windows-x64", "Windows", "Windows 10, 11 · installer", "windows"],
  "linux-x64": ["desktop-linux-x64", "Linux", "x64 · AppImage", "linux"],
};

for (const el of document.querySelectorAll("[data-cmd]")) el.textContent = CMD[el.dataset.cmd];
$("hero-cmd-text").textContent = CMD.sh;

document.addEventListener("click", async (e) => {
  const btn = e.target.closest(".copy");
  if (!btn) return;
  await navigator.clipboard?.writeText(btn.parentElement.querySelector("code").textContent);
  btn.textContent = "Copied";
  setTimeout(() => (btn.textContent = "Copy"), 1500);
});

detectCurrent().then((d) => {
  document.documentElement.dataset.platform = d.platform ?? "unknown";
  if (d.os === "windows") {
    $("hero-cmd").classList.add("ps");
    $("hero-cmd-text").textContent = CMD.ps1;
  }
  const entry = d.platform && DESKTOP[d.platform];
  const note = $("alt-note");
  if (!entry) {
    if (d.platform) {
      $("primary-label").textContent = "Install the CLI";
      $("primary-sub").textContent = `No desktop build for ${d.platform} yet`;
    }
    return;
  }
  const [key, osLabel, sub, icon] = entry;
  $("primary-dl").href = `/download/${key}`;
  $("primary-label").textContent = `Download for ${osLabel}`;
  $("primary-sub").textContent = sub;
  $("primary-icon").innerHTML = `<use href="#i-${icon}"/>`;
  document.querySelector(`.dl[data-key="${key}"]`)?.classList.add("detected");
  if (d.os === "darwin") {
    note.innerHTML =
      d.arch === "arm64"
        ? `On an Intel Mac? <a href="/download/desktop-darwin-x64">Download the x64 build</a>.`
        : `On Apple Silicon? <a href="/download/desktop-darwin-arm64">Download the arm64 build</a>.`;
  } else if (d.os === "linux") {
    note.innerHTML = `Prefer a package? <a href="/download/desktop-linux-x64-deb">Download the .deb</a>.`;
  }
});

fetch("/manifest.json")
  .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
  .then((m) => {
    const date = m.publishedAt ? ` · ${new Date(m.publishedAt).toLocaleDateString(undefined, { dateStyle: "medium" })}` : "";
    $("version").innerHTML = `<b>v${m.version}</b>${date}`;
    $("dl-version").textContent = `Latest: v${m.version}${date}`;
    const any = m.assets["linux-x64"]?.url;
    if (any) $("sums").innerHTML = `Checksums: <a href="${any.replace(/[^/]+$/, "SHA256SUMS")}"><code>SHA256SUMS</code></a>`;
  })
  .catch(() => ($("version").textContent = "No release published yet"));

fetch("/screenshots.json")
  .then((r) => (r.ok ? r.json() : []))
  .catch(() => [])
  .then((files) => {
    const shot = $("shot");
    if (!files.length) return shot.insertAdjacentHTML("beforeend", mockShot());
    const hero = files.find((f) => /local-changes/i.test(f)) ?? files.find((f) => /hero|log/i.test(f)) ?? files[0];
    shot.insertAdjacentHTML("beforeend", `<img src="/screenshots/${hero}" alt="GitNut client" data-zoom data-caption="${caption(hero)}">`);
    const order = Object.keys(CAPTIONS);
    const rank = (f) => (order.indexOf(f.replace(/\.\w+$/, "")) + 1 || 99);
    $("gallery").innerHTML = files
      .filter((f) => f !== hero)
      .sort((a, b) => rank(a) - rank(b))
      .map((f) => `<figure class="glass" data-tilt-card><img src="/screenshots/${f}" alt="${caption(f)}" loading="lazy" data-zoom><figcaption>${caption(f)}</figcaption></figure>`)
      .join("");
    reveal($("gallery").children);
  });

const CAPTIONS = {
  log: "Every agent branch in one IntelliJ-style graph",
  "multi-select": "Select an agent's commits, review the combined change",
  diff: "Side-by-side diff with connector bands",
  "local-changes": "Live uncommitted changes across worktrees",
  "projects-flat": "All machines, one flat project list",
  "add-projects": "Add single repos or watch a whole folder",
  actions: "Git actions right from the log",
  settings: "Daemon settings from the client",
  "embed-example": "Standalone components and iframe embedding",
};

function caption(f) {
  const key = f.replace(/\.\w+$/, "");
  if (CAPTIONS[key]) return CAPTIONS[key];
  const s = f.replace(/\.\w+$/, "").replace(/^\d+[-_]/, "").replace(/[-_]+/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Placeholder drawing of the client until real screenshots land in public/screenshots.
function mockShot() {
  const lanes = ["#818cf8", "#c084fc", "#f472c6", "#5eead4"];
  const rows = [
    [0, [0, 1]], [1, [0, 1]], [0, [0, 1, 2]], [2, [0, 1, 2]], [1, [0, 1, 2]], [0, [0, 2]],
    [2, [0, 2]], [0, [0, 3]], [3, [0, 3]], [0, [0]], [0, [0]], [0, [0]],
  ];
  let g = "";
  rows.forEach(([lane, active], i) => {
    const y = 74 + i * 34;
    if (i === 2) g += `<rect x="236" y="${y - 15}" width="560" height="30" rx="6" fill="rgb(192 132 252 / 14%)"/>`;
    for (const l of active) if (i < rows.length - 1) g += `<line x1="${262 + l * 18}" y1="${y}" x2="${262 + l * 18}" y2="${y + 34}" stroke="${lanes[l]}" stroke-width="2.5"/>`;
    g += `<circle cx="${262 + lane * 18}" cy="${y}" r="5.5" fill="${lanes[lane]}" stroke="#0c0c10" stroke-width="2"/>`;
    if (i === 0) g += `<rect x="350" y="${y - 9}" width="64" height="18" rx="4" fill="rgb(129 140 248 / 25%)"/><rect x="422" y="${y - 9}" width="88" height="18" rx="4" fill="rgb(244 114 198 / 22%)"/>`;
    const w = 150 + ((i * 97) % 220);
    g += `<rect x="${i === 0 ? 520 : 350}" y="${y - 5}" width="${w}" height="10" rx="5" fill="rgb(255 255 255 / ${i === 2 ? 55 : 22}%)"/>`;
    g += `<rect x="660" y="${y - 4}" width="60" height="8" rx="4" fill="rgb(255 255 255 / 12%)"/><rect x="732" y="${y - 4}" width="44" height="8" rx="4" fill="rgb(255 255 255 / 9%)"/>`;
  });
  let diff = "";
  for (let i = 0; i < 16; i++) {
    const y = 70 + i * 26;
    const kind = [3, 4].includes(i) ? "del" : [5, 6, 7, 11].includes(i) ? "add" : "";
    if (kind) diff += `<rect x="816" y="${y - 11}" width="368" height="22" fill="${kind === "add" ? "rgb(47 191 143 / 13%)" : "rgb(240 82 82 / 13%)"}"/>`;
    diff += `<rect x="830" y="${y - 3}" width="14" height="6" rx="3" fill="rgb(255 255 255 / 12%)"/>`;
    diff += `<rect x="${856 + (i % 3) * 16}" y="${y - 4}" width="${90 + ((i * 53) % 200)}" height="8" rx="4" fill="${kind === "add" ? "rgb(47 191 143 / 55%)" : kind === "del" ? "rgb(240 82 82 / 50%)" : "rgb(255 255 255 / 20%)"}"/>`;
  }
  const side = ["laptop", "  gitnut", "  cabby-web", "dev-vps", "  metar-cloud", "  glassout", "  t3code"]
    .map((s, i) => {
      const y = 70 + i * 30;
      const server = !s.startsWith(" ");
      return `<circle cx="${server ? 26 : 42}" cy="${y}" r="${server ? 4 : 3}" fill="${server ? "#3fd08a" : "rgb(255 255 255 / 30%)"}"/><rect x="${server ? 38 : 54}" y="${y - 4}" width="${server ? 70 : 60 + i * 9}" height="8" rx="4" fill="rgb(255 255 255 / ${server ? 40 : i === 1 ? 60 : 20}%)"/>${i === 1 ? `<rect x="12" y="${y - 13}" width="196" height="26" rx="6" fill="rgb(255 255 255 / 6%)"/>` : ""}`;
    })
    .join("");
  return `<svg class="mock" viewBox="0 0 1200 500" role="img" aria-label="gitnut client mock">
    <rect width="1200" height="500" fill="#07070a"/>
    <rect x="0" y="0" width="220" height="500" fill="rgb(255 255 255 / 2.5%)"/><line x1="220" y1="0" x2="220" y2="500" stroke="rgb(255 255 255 / 8%)"/>
    <line x1="806" y1="0" x2="806" y2="500" stroke="rgb(255 255 255 / 8%)"/>
    <rect x="236" y="20" width="160" height="22" rx="6" fill="rgb(255 255 255 / 5%)" stroke="rgb(255 255 255 / 8%)"/>
    <rect x="826" y="20" width="200" height="22" rx="6" fill="rgb(255 255 255 / 5%)" stroke="rgb(255 255 255 / 8%)"/>
    <rect x="20" y="22" width="80" height="8" rx="4" fill="rgb(255 255 255 / 25%)"/>
    ${side}${g}${diff}
  </svg>`;
}

// Donation buttons: only the links the site server has configured (GITNUT_SPONSOR_*); none = no block.
const SPONSORS = { github: "GitHub Sponsors", kofi: "Ko-fi", paypal: "PayPal" };
fetch("/site.json")
  .then((r) => (r.ok ? r.json() : {}))
  .catch(() => ({}))
  .then(({ sponsors = {} }) => {
    const links = Object.entries(SPONSORS).filter(([k]) => sponsors[k]).map(([k, label]) => {
      const a = document.createElement("a");
      a.className = k === "github" ? "btn primary" : "btn";
      a.href = sponsors[k];
      a.rel = "noopener";
      a.textContent = label;
      return a;
    });
    if (!links.length) return;
    $("sponsors").replaceChildren(...links);
    $("donate").hidden = false;
  });

// Screenshot lightbox on a native <dialog>: Escape closes (built in), so do the X button and a click
// outside the image; arrows and ←/→ step through the zoomable screenshots on the page.
const box = $("lightbox");
const boxImg = box.querySelector("img");
const boxCap = box.querySelector("figcaption");
let shots = [];
let at = 0;
function show(i) {
  at = (i + shots.length) % shots.length;
  const img = shots[at];
  boxImg.src = img.currentSrc || img.src;
  boxImg.alt = img.alt;
  boxCap.textContent = img.dataset.caption ?? img.closest("figure")?.querySelector("figcaption")?.textContent ?? img.alt;
}
document.addEventListener("click", (e) => {
  const img = e.target.closest("img[data-zoom]");
  if (!img) return;
  shots = [...document.querySelectorAll("img[data-zoom]")];
  for (const b of box.querySelectorAll(".lb-nav")) b.hidden = shots.length < 2;
  show(shots.indexOf(img));
  box.showModal();
});
box.addEventListener("click", (e) => {
  if (e.target.closest(".prev")) show(at - 1);
  else if (e.target.closest(".next")) show(at + 1);
  else if (e.target.closest(".lb-close") || !e.target.closest("img")) box.close();
});
box.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft") show(at - 1);
  else if (e.key === "ArrowRight") show(at + 1);
});
