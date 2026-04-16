/* bg-floaters.js — screensaver background animation */
(function() {
  const EMOJIS = ['⭐', '🎁', '🏆'];
  const SIZE   = 80;
  const SPEED  = 0.88;
  const OP     = 0.15;

  // inject elements
  document.body.insertAdjacentHTML('afterbegin',
    '<div class="bg-mesh"></div>' +
    EMOJIS.map((e,i) => `<div class="bg-floater" id="bgf${i}">${e}</div>`).join('')
  );

  const W = window.innerWidth;
  const H = window.innerHeight;

  const balls = EMOJIS.map((e, i) => {
    const angle = (Math.PI * 2 / EMOJIS.length) * i + Math.random();
    const spd   = SPEED * (0.8 + Math.random() * 0.4);
    return {
      el: document.getElementById('bgf' + i),
      x: Math.random() * (W - SIZE),
      y: Math.random() * (H - SIZE),
      vx: Math.cos(angle) * spd,
      vy: Math.sin(angle) * spd,
      rot: Math.random() * 360,
      rotV: (Math.random() - 0.5) * 0.4,
    };
  });

  balls.forEach(b => {
    b.el.style.opacity = OP;
    b.el.style.left    = b.x + 'px';
    b.el.style.top     = b.y + 'px';
  });

  function tick() {
    const maxX = window.innerWidth  - SIZE;
    const maxY = window.innerHeight - SIZE;
    balls.forEach(b => {
      b.x   += b.vx;
      b.y   += b.vy;
      b.rot += b.rotV;
      if (b.x <= 0)    { b.x = 0;    b.vx =  Math.abs(b.vx); }
      if (b.x >= maxX) { b.x = maxX; b.vx = -Math.abs(b.vx); }
      if (b.y <= 0)    { b.y = 0;    b.vy =  Math.abs(b.vy); }
      if (b.y >= maxY) { b.y = maxY; b.vy = -Math.abs(b.vy); }
      b.el.style.left      = b.x + 'px';
      b.el.style.top       = b.y + 'px';
      b.el.style.transform = 'rotate(' + b.rot + 'deg)';
    });
    requestAnimationFrame(tick);
  }
  tick();
})();
