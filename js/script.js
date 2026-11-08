/* ==========================================================================
   Kalaatva — interactions & motion

   Progressive enhancement:
   - Core behaviour (menu, header, anchors, form, lightbox) needs no library.
   - Motion (GSAP + ScrollTrigger + SplitText, Lenis smooth scroll) runs only
     when the libraries loaded AND the visitor hasn't asked for reduced motion.
   - If anything in the motion layer throws, every element is put back to its
     natural, visible state.
   ========================================================================== */
;(() => {
  'use strict'

  const root = document.documentElement
  const $ = (sel, ctx = document) => ctx.querySelector(sel)
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel))
  const media = (query) => window.matchMedia(query)
  // Safari < 14 only has the older addListener API on MediaQueryList.
  const onMediaChange = (mql, handler) =>
    mql.addEventListener ? mql.addEventListener('change', handler) : mql.addListener(handler)

  const reducedMotion = media('(prefers-reduced-motion: reduce)').matches
  const finePointer = media('(hover: hover) and (pointer: fine)').matches
  const hasGSAP = Boolean(window.gsap && window.ScrollTrigger)

  // The inline fail-safe in <head> is no longer needed once we're running.
  clearTimeout(window.__kalaatvaFailsafe)

  const PHOTOSWIPE = {
    src: 'https://cdn.jsdelivr.net/npm/photoswipe@5.4.4/dist/umd/photoswipe.umd.min.js',
    integrity: 'sha384-k8EKyYcONphQ7zH4cQ0888JapXwrLTXQl/Ue1/jYgjVYahln1NWpnt2S4IC56LNh',
  }

  const state = {
    lenis: null,
    menuOpen: false,
    setMenu: () => {},
  }

  /* ---------- Small helpers ---------- */

  const session = {
    get(key) {
      try {
        return sessionStorage.getItem(key)
      } catch {
        return null
      }
    },
    set(key, value) {
      try {
        sessionStorage.setItem(key, value)
      } catch {
        /* storage blocked (private mode) — fine, intro just plays again */
      }
    },
  }

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  const imageReady = (img) =>
    !img || (img.complete && img.naturalWidth)
      ? Promise.resolve()
      : new Promise((resolve) => {
          img.addEventListener('load', resolve, { once: true })
          img.addEventListener('error', resolve, { once: true })
        })

  /** Scroll to an element (or the top) and move focus there for keyboard users. */
  function goTo(target) {
    if (!target) return
    const toTop = target.id === 'home' || target.id === 'main'
    if (state.lenis) {
      state.lenis.scrollTo(toTop ? 0 : target, { duration: 1.5 })
    } else {
      const behavior = reducedMotion ? 'auto' : 'smooth'
      if (toTop) window.scrollTo({ top: 0, behavior })
      else target.scrollIntoView({ behavior })
    }
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1')
    target.focus({ preventScroll: true })
  }

  /* ---------- Navigation: mobile menu, hide-on-scroll header, active link ---------- */

  function initNavigation() {
    const header = $('.site-header')
    const toggle = $('.menu-toggle')
    const links = $$('.nav__link')
    const outside = [$('main'), $('.site-footer')].filter(Boolean)
    if (!header) return

    state.setMenu = (open) => {
      if (!toggle || state.menuOpen === open) return
      state.menuOpen = open
      root.classList.toggle('menu-open', open)
      toggle.setAttribute('aria-expanded', String(open))
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu')
      // Keep keyboard focus inside the header while the overlay is open.
      outside.forEach((el) => {
        el.inert = open
      })
      if (state.lenis) open ? state.lenis.stop() : state.lenis.start()
      if (open) header.classList.remove('nav--hidden')
    }

    toggle?.addEventListener('click', () => state.setMenu(!state.menuOpen))

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && state.menuOpen) {
        state.setMenu(false)
        toggle?.focus()
      }
    })

    onMediaChange(media('(min-width: 821px)'), (event) => {
      if (event.matches) state.setMenu(false)
    })

    // Hide on scroll down, reveal on scroll up (original behaviour, now throttled).
    let lastY = window.scrollY
    let ticking = false
    const update = () => {
      ticking = false
      const y = window.scrollY
      header.classList.toggle('is-scrolled', y > 24)
      if (Math.abs(y - lastY) < 4) return
      if (!state.menuOpen) header.classList.toggle('nav--hidden', y > lastY && y > 160)
      lastY = y
    }
    window.addEventListener(
      'scroll',
      () => {
        if (!ticking) {
          ticking = true
          requestAnimationFrame(update)
        }
      },
      { passive: true }
    )
    update()

    // Never let a hidden header swallow keyboard focus.
    header.addEventListener('focusin', () => header.classList.remove('nav--hidden'))

    // Highlight the link for the section in view.
    const sectionToLink = {
      home: '#home',
      intro: '#home',
      about: '#about',
      projects: '#projects',
      gallery: '#projects',
      contact: '#contact',
    }
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return
            const href = sectionToLink[entry.target.id]
            links.forEach((link) => {
              const active = link.getAttribute('href') === href
              link.classList.toggle('is-active', active)
              if (active) link.setAttribute('aria-current', 'true')
              else link.removeAttribute('aria-current')
            })
          })
        },
        { rootMargin: '-45% 0px -50% 0px' }
      )
      Object.keys(sectionToLink).forEach((id) => {
        const section = document.getElementById(id)
        if (section) observer.observe(section)
      })
    }
  }

  /* ---------- In-page links (smooth with Lenis, native otherwise) ---------- */

  function initAnchors() {
    document.addEventListener('click', (event) => {
      const link = event.target.closest('a[href^="#"]')
      if (!link) return
      const hash = link.getAttribute('href')
      const target = hash.length > 1 && document.getElementById(hash.slice(1))
      if (!target) return
      event.preventDefault()
      state.setMenu(false)
      goTo(target)
      history.replaceState(null, '', hash)
    })

    $('.to-top')?.addEventListener('click', () => goTo($('#home')))
  }

  /* ---------- Contact form ---------- */

  function initForm() {
    // Original behaviour: clear the form when leaving so "back" doesn't show stale input.
    window.addEventListener('beforeunload', () => {
      $$('form').forEach((form) => form.reset())
    })

    $$('form').forEach((form) => {
      form.addEventListener('submit', () => {
        const button = form.querySelector('[type="submit"]')
        const label = button?.querySelector('.btn__label')
        if (!button) return
        button.classList.add('is-loading')
        button.setAttribute('aria-busy', 'true')
        if (label) label.textContent = 'Sending…'
      })
    })

    // Restore the button if the visitor comes back from the confirmation page.
    window.addEventListener('pageshow', (event) => {
      if (!event.persisted) return
      $$('.btn.is-loading').forEach((button) => {
        button.classList.remove('is-loading')
        button.removeAttribute('aria-busy')
        const label = button.querySelector('.btn__label')
        if (label) label.textContent = 'Send Message'
      })
    })
  }

  function initYear() {
    const year = String(new Date().getFullYear())
    $$('[data-year]').forEach((el) => {
      el.textContent = year
    })
  }

  /* ---------- Gallery lightbox (PhotoSwipe, loaded on first use) ---------- */

  function initLightbox() {
    const grid = $('#gallery-grid')
    if (!grid) return
    // Captured in source order, before any column re-layout.
    const items = $$('.gallery__item', grid)
    let loading = null

    const loadPhotoSwipe = () => {
      if (window.PhotoSwipe) return Promise.resolve(window.PhotoSwipe)
      if (!loading) {
        loading = new Promise((resolve, reject) => {
          const script = document.createElement('script')
          script.src = PHOTOSWIPE.src
          script.integrity = PHOTOSWIPE.integrity
          script.crossOrigin = 'anonymous'
          script.async = true
          script.onload = () =>
            window.PhotoSwipe ? resolve(window.PhotoSwipe) : reject(new Error('PhotoSwipe missing'))
          script.onerror = () => {
            loading = null
            reject(new Error('PhotoSwipe failed to load'))
          }
          document.head.appendChild(script)
        })
      }
      return loading
    }

    const slides = () =>
      items.map((item) => {
        const img = item.querySelector('img')
        return {
          src: item.href,
          width: Number(item.dataset.pswpWidth),
          height: Number(item.dataset.pswpHeight),
          alt: img?.alt || '',
          msrc: img?.currentSrc || img?.src,
          element: item,
          thumbCropped: true,
        }
      })

    const open = (PhotoSwipe, index) => {
      const pswp = new PhotoSwipe({
        dataSource: slides(),
        index,
        bgOpacity: 0.96,
        showHideAnimationType: 'zoom',
        wheelToZoom: true,
        padding: { top: 48, bottom: 48, left: 16, right: 16 },
        closeTitle: 'Close (Esc)',
        arrowPrevTitle: 'Previous artwork',
        arrowNextTitle: 'Next artwork',
      })
      pswp.on('beforeOpen', () => {
        state.lenis?.stop()
        root.classList.add('lightbox-open')
      })
      pswp.on('destroy', () => {
        state.lenis?.start()
        root.classList.remove('lightbox-open')
      })
      pswp.init()
    }

    grid.addEventListener('click', async (event) => {
      const item = event.target.closest('.gallery__item')
      if (!item || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return
      event.preventDefault()
      try {
        open(await loadPhotoSwipe(), items.indexOf(item))
      } catch {
        window.location.href = item.href // CDN unreachable: show the image itself
      }
    })

    // Warm the lightbox as soon as the visitor shows intent.
    grid.addEventListener('pointerenter', () => loadPhotoSwipe().catch(() => {}), { once: true })
    grid.addEventListener('focusin', () => loadPhotoSwipe().catch(() => {}), { once: true })
  }

  /* ---------- Card spotlight (pure CSS variables) ---------- */

  function initSpotlight() {
    if (!finePointer) return
    $$('[data-card]').forEach((card) => {
      card.addEventListener('pointermove', (event) => {
        const rect = card.getBoundingClientRect()
        card.style.setProperty('--mx', `${event.clientX - rect.left}px`)
        card.style.setProperty('--my', `${event.clientY - rect.top}px`)
      })
    })
  }

  /* ==========================================================================
     Motion layer
     ========================================================================== */

  function initMotion() {
    const { gsap, ScrollTrigger } = window
    const SplitText = window.SplitText || null

    // Start from the top so the intro reads as intended (deep links keep their
    // position). Done before ScrollTrigger registers so it never caches a stale
    // restored scroll position and fires "once" reveals early.
    if (!location.hash) {
      if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
      window.scrollTo(0, 0)
    }

    gsap.registerPlugin(...[ScrollTrigger, SplitText].filter(Boolean))
    gsap.defaults({ ease: 'power3.out', duration: 1 })
    root.classList.add('has-motion')

    initSmoothScroll(gsap, ScrollTrigger)
    const intro = buildHeroIntro(gsap)
    runPreloader(gsap).then(() => intro.play())

    initHeroScroll(gsap)
    initTextReveals(gsap, ScrollTrigger, SplitText)
    initImageReveals(gsap)
    initMarquee(gsap)
    initGalleryMotion(gsap, ScrollTrigger)
    initScrollProgress(gsap)

    if (finePointer) {
      initCursor(gsap)
      initMagnetic(gsap)
      initHeroTilt(gsap)
    }

    // Fonts and late images can shift layout; re-measure trigger positions.
    document.fonts?.ready.then(() => ScrollTrigger.refresh())
    window.addEventListener('load', () => ScrollTrigger.refresh(), { once: true })
  }

  function initSmoothScroll(gsap, ScrollTrigger) {
    if (typeof window.Lenis !== 'function') return
    const lenis = new window.Lenis({
      lerp: 0.1,
      smoothWheel: true,
      autoRaf: false,
      prevent: (node) => Boolean(node.closest?.('.pswp')),
    })
    lenis.on('scroll', ScrollTrigger.update)
    gsap.ticker.add((time) => lenis.raf(time * 1000))
    gsap.ticker.lagSmoothing(0)
    state.lenis = lenis
  }

  /** Brand-mark loader: full sequence once per session, a quick fade afterwards. */
  function runPreloader(gsap) {
    const preloader = $('.preloader')
    const finish = () => {
      root.classList.add('is-loaded')
      state.lenis?.start()
    }
    if (!preloader) {
      finish()
      return Promise.resolve()
    }

    state.lenis?.stop()
    const returning = session.get('kalaatva:intro') === '1'
    session.set('kalaatva:intro', '1')

    const assets = Promise.all([imageReady($('.hero__img')), document.fonts ? document.fonts.ready : null])
    // Never hold the page hostage to a slow network.
    const ready = Promise.race([assets, wait(returning ? 1200 : 3000)])

    return new Promise((resolve) => {
      if (returning) {
        ready.then(() => {
          gsap
            .timeline({ onComplete: finish })
            .to(preloader, { autoAlpha: 0, duration: 0.45, ease: 'power2.out' })
            .add(resolve, 0)
        })
        return
      }

      const logo = $('.preloader__logo', preloader)
      const bar = $('.preloader__bar span', preloader)
      const inner = $('.preloader__inner', preloader)

      const drawn = new Promise((done) => {
        gsap
          .timeline({ onComplete: done })
          .fromTo(
            logo,
            { clipPath: 'inset(0% 100% 0% 0%)' },
            { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.9, ease: 'power2.inOut' }
          )
          .fromTo(bar, { scaleX: 0 }, { scaleX: 0.75, duration: 0.9, ease: 'power2.inOut' }, 0)
      })

      Promise.all([ready, drawn]).then(() => {
        gsap
          .timeline({ onComplete: finish })
          .to(bar, { scaleX: 1, duration: 0.25, ease: 'power2.out' })
          .to(inner, { yPercent: -35, autoAlpha: 0, duration: 0.45, ease: 'power3.in' })
          .fromTo(
            preloader,
            { clipPath: 'inset(0% 0% 0% 0%)' },
            { clipPath: 'inset(0% 0% 100% 0%)', duration: 0.9, ease: 'expo.inOut' },
            '-=0.15'
          )
          .add(resolve, '-=0.6')
      })
    })
  }

  /** The calligraphy "writes" itself in left-to-right, then the chrome settles in. */
  function buildHeroIntro(gsap) {
    const tl = gsap.timeline({ paused: true })
    const img = $('.hero__img')
    const meta = $$('[data-hero-meta]')
    const headerInner = $('.header__inner')

    if (img) {
      tl.fromTo(
        img,
        { clipPath: 'inset(0% 100% 0% 0%)', scale: 1.04 },
        { clipPath: 'inset(0% 0% 0% 0%)', scale: 1, duration: 2.2, ease: 'power2.inOut', clearProps: 'clipPath' },
        0
      )
    }
    if (headerInner) {
      tl.fromTo(
        headerInner,
        { yPercent: -60, autoAlpha: 0 },
        { yPercent: 0, autoAlpha: 1, duration: 1.1, ease: 'expo.out', clearProps: 'transform' },
        0.45
      )
    }
    if (meta.length) {
      tl.fromTo(
        meta,
        { y: 24, autoAlpha: 0 },
        { y: 0, autoAlpha: 1, duration: 1, stagger: 0.12, clearProps: 'transform' },
        1.1
      )
    }
    return tl
  }

  /** Hero art recedes gently as you scroll away. */
  function initHeroScroll(gsap) {
    if (!$('.hero')) return
    const trigger = { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true }
    gsap.to('.hero__media', { yPercent: 16, scale: 0.94, autoAlpha: 0.3, ease: 'none', scrollTrigger: trigger })
    gsap.to('.hero__meta', {
      y: -30,
      autoAlpha: 0,
      ease: 'none',
      scrollTrigger: { ...trigger, end: '35% top' },
    })
  }

  function initTextReveals(gsap, ScrollTrigger, SplitText) {
    // Headlines: words rise out of line masks.
    $$('[data-split]').forEach((el) => {
      if (!SplitText) return
      SplitText.create(el, {
        type: 'words,lines',
        mask: 'lines',
        linesClass: 'split-line',
        autoSplit: true,
        onSplit: (self) =>
          gsap.from(self.words, {
            yPercent: 115,
            duration: 1.2,
            ease: 'expo.out',
            stagger: 0.07,
            scrollTrigger: { trigger: el, start: 'top 88%', once: true },
          }),
      })
    })

    // Statements: words light up as they scroll through the viewport.
    $$('[data-highlight]').forEach((el) => {
      if (!SplitText) return
      SplitText.create(el, {
        type: 'words',
        onSplit: (self) =>
          gsap.fromTo(
            self.words,
            { opacity: 0.16 },
            {
              opacity: 1,
              ease: 'none',
              stagger: 0.1,
              scrollTrigger: { trigger: el, start: 'top 82%', end: 'bottom 55%', scrub: true },
            }
          ),
      })
    })

    // Footer wordmark: letters rise as the page ends.
    const wordmark = $('.footer__wordmark')
    if (wordmark && SplitText) {
      SplitText.create(wordmark, {
        type: 'chars',
        mask: 'chars',
        aria: 'none',
        onSplit: (self) =>
          gsap.from(self.chars, {
            yPercent: 100,
            duration: 1.3,
            ease: 'expo.out',
            stagger: 0.05,
            scrollTrigger: { trigger: wordmark, start: 'top 98%', once: true },
          }),
      })
    }

    // Small supporting elements: a soft rise, batched so groups stagger naturally.
    const batchReveal = (selector, from, stagger) => {
      const els = $$(selector)
      if (!els.length) return
      gsap.set(els, from)
      ScrollTrigger.batch(els, {
        start: 'top 90%',
        once: true,
        onEnter: (batch) =>
          gsap.to(batch, {
            y: 0,
            autoAlpha: 1,
            duration: 1,
            stagger,
            overwrite: true,
            clearProps: 'transform',
          }),
      })
    }
    batchReveal('[data-reveal]', { y: 28, autoAlpha: 0 }, 0.1)
    batchReveal('[data-card]', { y: 60, autoAlpha: 0 }, 0.12)
  }

  /** Images unveil from the bottom with a slow settle, then drift with scroll. */
  function initImageReveals(gsap) {
    $$('.reveal-img').forEach((frame) => {
      const img = frame.querySelector('img')
      if (!img) return
      const parallax = img.hasAttribute('data-parallax')
      gsap
        .timeline({ scrollTrigger: { trigger: frame, start: 'top 85%', once: true } })
        .fromTo(
          frame,
          { clipPath: 'inset(100% 0% 0% 0%)' },
          { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.4, ease: 'expo.inOut' }
        )
        // Parallax images keep a little overscan so the drift never shows an edge.
        .fromTo(img, { scale: 1.35 }, { scale: parallax ? 1.12 : 1, duration: 1.8, ease: 'expo.out' }, 0.1)

      if (parallax) {
        gsap.fromTo(
          img,
          { yPercent: -5 },
          {
            yPercent: 5,
            ease: 'none',
            scrollTrigger: { trigger: frame, start: 'top bottom', end: 'bottom top', scrub: true },
          }
        )
      }
    })
  }

  /** Scroll-driven marquee: moves only while you scroll, so nothing loops on its own. */
  function initMarquee(gsap) {
    const track = $('.marquee__track')
    if (!track) return
    gsap.fromTo(
      track,
      { xPercent: 0 },
      {
        xPercent: -25,
        ease: 'none',
        scrollTrigger: { trigger: '.marquee', start: 'top bottom', end: 'bottom top', scrub: 0.6 },
      }
    )
  }

  /** Gallery: staggered entrance + (desktop) balanced columns drifting at different speeds. */
  function initGalleryMotion(gsap, ScrollTrigger) {
    const grid = $('#gallery-grid')
    if (!grid) return
    const items = $$('.gallery__item', grid)

    const mm = gsap.matchMedia()
    mm.add('(min-width: 900px)', () => {
      const columns = buildColumns(grid, items, 3)
      const drift = [40, -50, 30]
      columns.forEach((column, i) => {
        gsap.fromTo(
          column,
          { y: drift[i] },
          {
            y: -drift[i],
            ease: 'none',
            scrollTrigger: { trigger: grid, start: 'top bottom', end: 'bottom top', scrub: true },
          }
        )
      })
      return () => {
        items.forEach((item) => grid.appendChild(item)) // restore source order
        columns.forEach((column) => column.remove())
        grid.classList.remove('is-columns')
      }
    })

    gsap.set(items, { y: 60, autoAlpha: 0 })
    ScrollTrigger.batch(items, {
      start: 'top 94%',
      once: true,
      onEnter: (batch) =>
        gsap.to(batch, {
          y: 0,
          autoAlpha: 1,
          duration: 1.1,
          stagger: 0.08,
          overwrite: true,
          clearProps: 'transform',
        }),
    })
  }

  /** Distribute items into the shortest column, using each image's aspect ratio. */
  function buildColumns(grid, items, count) {
    const MAX_RATIO = 1.6 // matches the CSS max-height cap on tall images
    const columns = Array.from({ length: count }, () => {
      const column = document.createElement('div')
      column.className = 'gallery__col'
      return column
    })
    const heights = new Array(count).fill(0)
    items.forEach((item) => {
      const ratio = Math.min(
        (Number(item.dataset.pswpHeight) || 1) / (Number(item.dataset.pswpWidth) || 1),
        MAX_RATIO
      )
      const shortest = heights.indexOf(Math.min(...heights))
      columns[shortest].appendChild(item)
      heights[shortest] += ratio + 0.05
    })
    grid.classList.add('is-columns')
    grid.append(...columns)
    return columns
  }

  function initScrollProgress(gsap) {
    const bar = $('.scroll-progress')
    if (!bar) return
    gsap.to(bar, {
      scaleX: 1,
      ease: 'none',
      scrollTrigger: { start: 0, end: 'max', scrub: 0.3 },
    })
  }

  /** A soft ring that trails the (still visible) system cursor. */
  function initCursor(gsap) {
    const cursor = $('.cursor')
    if (!cursor) return
    root.classList.add('has-cursor')
    gsap.set(cursor, { xPercent: -50, yPercent: -50 })
    const xTo = gsap.quickTo(cursor, 'x', { duration: 0.45, ease: 'power3' })
    const yTo = gsap.quickTo(cursor, 'y', { duration: 0.45, ease: 'power3' })
    let visible = false

    const hide = () => {
      visible = false
      cursor.classList.remove('is-visible')
    }

    window.addEventListener(
      'pointermove',
      (event) => {
        if (event.pointerType !== 'mouse') return
        if (!visible) {
          gsap.set(cursor, { x: event.clientX, y: event.clientY })
          cursor.classList.add('is-visible')
          visible = true
        }
        xTo(event.clientX)
        yTo(event.clientY)
      },
      { passive: true }
    )

    document.documentElement.addEventListener('mouseleave', hide)
    $$('iframe').forEach((frame) => frame.addEventListener('mouseenter', hide))

    document.addEventListener('pointerover', (event) => {
      const view = event.target.closest('.gallery__item')
      const interactive = event.target.closest('a, button, input, textarea, label, [data-card]')
      cursor.classList.toggle('is-view', Boolean(view))
      cursor.classList.toggle('is-hover', Boolean(interactive) && !view)
    })
  }

  /** Buttons lean toward the pointer and spring back. */
  function initMagnetic(gsap) {
    $$('[data-magnetic]').forEach((el) => {
      const strength = el.classList.contains('btn') ? 0.22 : 0.38
      const xTo = gsap.quickTo(el, 'x', { duration: 0.9, ease: 'elastic.out(1, 0.4)' })
      const yTo = gsap.quickTo(el, 'y', { duration: 0.9, ease: 'elastic.out(1, 0.4)' })
      el.addEventListener('pointermove', (event) => {
        const rect = el.getBoundingClientRect()
        xTo((event.clientX - (rect.left + rect.width / 2)) * strength)
        yTo((event.clientY - (rect.top + rect.height / 2)) * strength)
      })
      el.addEventListener('pointerleave', () => {
        xTo(0)
        yTo(0)
      })
    })
  }

  /** The hero art floats subtly against the pointer. */
  function initHeroTilt(gsap) {
    const hero = $('.hero')
    const float = $('.hero__float')
    if (!hero || !float) return
    const xTo = gsap.quickTo(float, 'x', { duration: 1.4, ease: 'power3' })
    const yTo = gsap.quickTo(float, 'y', { duration: 1.4, ease: 'power3' })
    hero.addEventListener('pointermove', (event) => {
      const rect = hero.getBoundingClientRect()
      xTo(((event.clientX - rect.left) / rect.width - 0.5) * -22)
      yTo(((event.clientY - rect.top) / rect.height - 0.5) * -14)
    })
    hero.addEventListener('pointerleave', () => {
      xTo(0)
      yTo(0)
    })
  }

  /** If the motion layer fails part-way, put everything back to its natural state. */
  function recoverFromMotionError(error) {
    console.error('[kalaatva] motion disabled:', error)
    try {
      window.ScrollTrigger?.getAll().forEach((trigger) => trigger.kill())
      window.gsap?.globalTimeline.clear()
      window.gsap?.set(
        '.preloader, .hero__img, .hero__media, .hero__meta, [data-hero-meta], .header__inner, [data-reveal], [data-card], .reveal-img, .reveal-img img, .gallery__item, .marquee__track',
        { clearProps: 'all' }
      )
    } catch {
      /* best effort */
    }
    state.lenis?.destroy()
    state.lenis = null
    root.classList.remove('has-motion', 'has-cursor')
    root.classList.add('is-loaded')
  }

  /* ---------- Boot ---------- */

  initNavigation()
  initAnchors()
  initForm()
  initYear()
  initLightbox()
  initSpotlight()

  if (hasGSAP && !reducedMotion) {
    try {
      initMotion()
    } catch (error) {
      recoverFromMotionError(error)
    }
  } else {
    root.classList.add('is-loaded')
  }
})()
