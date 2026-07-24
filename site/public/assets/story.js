(function () {
  const frames = Array.from(document.querySelectorAll('.frame'));
  const N = frames.length;
  const space = document.getElementById('scroll-space');
  const rail = document.getElementById('rail');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const PER = 1.0;
  const TAIL = 1.0;

  const dots = frames.map((_, i) => {
    const d = document.createElement('button');
    d.className = 'dot';
    d.setAttribute('aria-label', 'Go to scene ' + (i + 1));
    d.addEventListener('click', () => {
      window.scrollTo({ top: i * PER * window.innerHeight, behavior: reduceMotion ? 'auto' : 'smooth' });
    });
    rail.appendChild(d);
    return d;
  });

  function sizeSpace() {
    space.style.height = ((N - 1) * PER * 100 + TAIL * 100) + 'vh';
  }

  let ticking = false;
  function render() {
    ticking = false;
    const vh = window.innerHeight;
    let t = window.scrollY / (PER * vh);
    t = Math.max(0, Math.min(N - 1, t));
    const activeIdx = Math.round(t);

    for (let i = 0; i < N; i++) {
      const d = t - i;
      const ad = Math.abs(d);
      let op = 1 - (ad - 0.28) / 0.44;
      op = Math.max(0, Math.min(1, op));
      const f = frames[i];
      if (op <= 0.001) {
        f.style.opacity = '0';
        f.style.visibility = 'hidden';
        f.classList.remove('active');
        continue;
      }
      f.style.visibility = 'visible';
      f.style.opacity = op.toFixed(3);
      if (!reduceMotion) {
        const ty = d * -5;
        const sc = 1 - ad * 0.04;
        f.style.transform = 'translateY(' + ty + 'vh) scale(' + sc.toFixed(3) + ')';
      }
      f.classList.toggle('active', i === activeIdx);
      dots.forEach((dot, j) => dot.classList.toggle('on', j === activeIdx));
    }
  }

  function onScroll() {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(render);
    }
  }

  const skipBtn = document.getElementById('skip-btn');
  skipBtn.addEventListener('click', () => {
    window.scrollTo({ top: (N - 1) * PER * window.innerHeight, behavior: reduceMotion ? 'auto' : 'smooth' });
  });
  function updateCorners() {
    const vh = window.innerHeight;
    const t = Math.max(0, Math.min(N - 1, window.scrollY / (PER * vh)));
    skipBtn.classList.toggle('hidden', t > N - 2.5);
  }
  window.addEventListener('scroll', updateCorners, { passive: true });
  updateCorners();

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', () => { sizeSpace(); onScroll(); });
  sizeSpace();
  render();
})();