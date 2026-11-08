// Screen motion for the portfolio. Everything here is an enhancement: with JS
// off, ?static (used by build-pdf.sh), or reduced motion, the page is complete
// as written in the HTML.
//
// - hero: pinned for one screen on wider viewports while the 3D name recedes
// - statement: words light up as it scrolls through
// - results: numbers count up once; work cards rise in; the record fades in
// - nav: translucent bar appears once the hero has passed
// - print: every tween and pin is reverted before printing, rebuilt after

const STATIC = new URLSearchParams(location.search).has("static");
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const root = document.documentElement;

// ── 3D name, loaded after the page is usable ───────────────────────────────
let hero3d = null;
async function load3d() {
  try {
    const { startHero } = await import("./hero3d.js");
    hero3d = await startHero({
      canvas: document.getElementById("name3d"),
      anchor: document.querySelector(".hero .name"),
      hero: document.querySelector(".hero"),
      reduced,
    });
  } catch (err) {
    console.warn("3D name unavailable, keeping the HTML name", err);
  }
}
const idle = (fn) => ("requestIdleCallback" in window ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 300));
if (!STATIC) {
  if (document.readyState === "complete") idle(load3d);
  else addEventListener("load", () => idle(load3d), { once: true });
}

// ── count-up helpers ────────────────────────────────────────────────────────
const counts = [...document.querySelectorAll("[data-count]")]
  .map((el) => {
    const final = el.textContent.trim();
    const m = final.match(/^(\D*)([\d,]*\.?\d+)(\D*)$/);
    if (!m) return null;
    const [, pre, num, post] = m;
    return { el, final, pre, post, dec: (num.split(".")[1] || "").length, value: parseFloat(num.replace(/,/g, "")) };
  })
  .filter(Boolean);
const fmt = (c, v) =>
  c.pre + v.toLocaleString("en-US", { minimumFractionDigits: c.dec, maximumFractionDigits: c.dec }) + c.post;
const finishCounts = () => counts.forEach((c) => (c.el.textContent = c.final));

// Wrap each word of an element in a span, keeping the spaces as text.
function splitWords(el) {
  if (!el || el.dataset.split) return;
  const text = el.textContent;
  el.textContent = "";
  for (const part of text.split(/(\s+)/)) {
    if (!part) continue;
    if (/^\s+$/.test(part)) el.append(part);
    else {
      const s = document.createElement("span");
      s.className = "word";
      s.textContent = part;
      el.append(s);
    }
  }
  el.dataset.split = "1";
}

// ── the scroll story ────────────────────────────────────────────────────────
function build(gsap) {
  const hero = document.querySelector(".hero");
  const nav = document.querySelector(".topnav");
  const mm = gsap.matchMedia();

  // Desktop: hold the hero for one screen while it recedes.
  mm.add("(min-width: 768px)", () => {
    gsap
      .timeline({
        scrollTrigger: {
          trigger: hero,
          start: "top top",
          end: "+=50%", // half a screen: the 3D moment lands without delaying the evidence
          pin: true,
          scrub: true,
          onUpdate: (st) => hero3d?.setProgress(st.progress),
        },
      })
      .to(".hero-meta", { y: -70, opacity: 0, ease: "none" }, 0)
      .to(".photo", { y: -160, opacity: 0, ease: "none" }, 0)
      .to(".hero .name", { opacity: 0, ease: "none" }, 0.15);
  });
  // Phones: no pin, but the name still reacts as the hero scrolls away.
  mm.add("(max-width: 767px)", () => {
    window.ScrollTrigger.create({
      trigger: hero,
      start: "top top",
      end: "bottom top",
      onUpdate: (st) => hero3d?.setProgress(st.progress),
    });
  });

  const ctx = gsap.context(() => {
    // Statement: grey to white, word by word, tied to scroll. The floor stays at
    // 0.4 so the unlit words still pass AA for large text while someone scans.
    gsap.fromTo(
      ".statement .word",
      { opacity: 0.4 },
      { opacity: 1, ease: "none", stagger: 0.1, scrollTrigger: { trigger: ".statement", start: "top 82%", end: "bottom 48%", scrub: true } }
    );
    gsap.from([".lede", ".open"], {
      y: 28, opacity: 0, duration: 0.9, ease: "power3.out", stagger: 0.12,
      scrollTrigger: { trigger: ".lede", start: "top 88%" },
    });

    // Desk photo: rises in, then drifts inside its frame as the page scrolls.
    gsap.from(".work-photo", {
      y: 60, opacity: 0, scale: 0.96, duration: 1.1, ease: "power3.out",
      scrollTrigger: { trigger: ".work-photo", start: "top 90%" },
    });
    gsap.fromTo(".work-photo img", { yPercent: -5 }, {
      yPercent: 5, ease: "none",
      scrollTrigger: { trigger: ".work-photo", start: "top bottom", end: "bottom top", scrub: true },
    });

    // Companies: logos arrive one after another, row by row.
    gsap.utils.toArray(".logo-row").forEach((row) =>
      gsap.from(row.querySelectorAll(".logo-label, li"), {
        y: 18, opacity: 0, duration: 0.7, ease: "power2.out", stagger: 0.06,
        scrollTrigger: { trigger: row, start: "top 90%" },
      })
    );

    // Results: each tile rises and counts its number up as it arrives. The
    // tile is both trigger and target, so ScrollTrigger measures it untransformed.
    gsap.utils.toArray(".stats > div").forEach((tile, i) => {
      const c = counts.find((x) => tile.contains(x.el));
      const o = { v: 0 };
      if (c) c.el.textContent = fmt(c, 0);
      gsap.from(tile, {
        y: 44, opacity: 0, duration: 0.9, ease: "power3.out", delay: (i % 3) * 0.07,
        scrollTrigger: { trigger: tile, start: "top 94%" },
        onStart: () =>
          c &&
          gsap.to(o, {
            v: c.value, duration: 1.1, ease: "power2.out",
            onUpdate: () => (c.el.textContent = fmt(c, o.v)),
            onComplete: () => (c.el.textContent = c.final),
          }),
      });
    });

    // Selected work: cards rise in a stagger, then hand transform back to the tilt.
    gsap.from(".work article", {
      y: 56, opacity: 0, duration: 1, ease: "power3.out", stagger: 0.08, clearProps: "transform",
      scrollTrigger: { trigger: ".work", start: "top 84%" },
    });

    // Network photos: rise in turn, then drift inside their frames.
    gsap.from(".net-photo", {
      y: 60, opacity: 0, duration: 1, ease: "power3.out", stagger: 0.12,
      scrollTrigger: { trigger: ".net", start: "top 86%" },
    });
    gsap.utils.toArray(".net-frame img").forEach((img) =>
      gsap.fromTo(img, { yPercent: -4 }, {
        yPercent: 4, ease: "none",
        scrollTrigger: { trigger: img.parentElement, start: "top bottom", end: "bottom top", scrub: true },
      })
    );

    // The record: a quick fade so it can be skimmed.
    gsap.utils.toArray("[data-reveal]").forEach((el) =>
      gsap.from(el, { y: 22, opacity: 0, duration: 0.7, ease: "power2.out", scrollTrigger: { trigger: el, start: "top 92%" } })
    );

    // Nav appears once the hero has gone.
    window.ScrollTrigger.create({
      trigger: ".intro",
      start: "top 55%",
      onEnter: () => nav.classList.add("show"),
      onLeaveBack: () => nav.classList.remove("show"),
    });
  });

  return {
    revert() {
      mm.revert();
      ctx.revert();
      finishCounts();
      nav.classList.remove("show");
    },
  };
}

// Cursor tilt on the work cards, smoothed so it settles rather than snaps.
function tilt() {
  if (!matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  for (const card of document.querySelectorAll("[data-tilt]")) {
    let tx = 0, ty = 0, x = 0, y = 0, raf = 0, last = 0;
    const step = (t) => {
      const dt = Math.min(0.05, last ? (t - last) / 1000 : 0.016);
      last = t;
      const k = 1 - Math.exp(-dt * 12);
      x += (tx - x) * k;
      y += (ty - y) * k;
      card.style.transform = `perspective(900px) rotateX(${y.toFixed(3)}deg) rotateY(${x.toFixed(3)}deg)`;
      if (Math.abs(tx - x) > 0.01 || Math.abs(ty - y) > 0.01) raf = requestAnimationFrame(step);
      else {
        raf = 0;
        last = 0;
        if (!tx && !ty) card.style.transform = "";
      }
    };
    card.addEventListener("pointermove", (e) => {
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      tx = px * 7;
      ty = -py * 7;
      card.style.setProperty("--mx", `${(px + 0.5) * 100}%`);
      card.style.setProperty("--my", `${(py + 0.5) * 100}%`);
      if (!raf) raf = requestAnimationFrame(step);
    });
    card.addEventListener("pointerleave", () => {
      tx = 0;
      ty = 0;
      if (!raf) raf = requestAnimationFrame(step);
    });
  }
}

const gsap = window.gsap;
if (!STATIC && !reduced && gsap && window.ScrollTrigger) {
  gsap.registerPlugin(window.ScrollTrigger);
  root.classList.add("motion", "nav-auto");
  splitWords(document.querySelector(".statement"));
  let story = build(gsap);
  tilt();
  addEventListener("beforeprint", () => story.revert());
  addEventListener("afterprint", () => {
    story = build(gsap);
    window.ScrollTrigger.refresh();
  });
  // Fonts change line breaks; re-measure pins and triggers once they land.
  document.fonts?.ready.then(() => window.ScrollTrigger.refresh());
}
