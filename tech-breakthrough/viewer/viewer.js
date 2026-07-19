/* 연구 노트 뷰어 — docs.js(window.DOCS) + marked로 md를 논문처럼 렌더한다. */
(function () {
  'use strict'

  var DOCS = window.DOCS || []

  // build.mjs의 getCategoryPriority/getTrackPriority와 반드시 일치해야 한다.
  // (PDF 내보내기 인쇄 순서, 트랙 헤더 정렬 순서에 쓰인다)
  var CATEGORY_ORDER = ['rag', 'backend-performance', 'backend-stability', 'frontend-performance', 'cicd']
  var TRACK_ORDER = ['learning', 'setup', 'journal']

  function categoryPriority(cat) {
    var i = CATEGORY_ORDER.indexOf(cat)
    return i === -1 ? CATEGORY_ORDER.length : i
  }

  function trackPriority(tr) {
    var i = TRACK_ORDER.indexOf(tr)
    return i === -1 ? TRACK_ORDER.length : i
  }

  function formatLabel(id) {
    if (!id) return '';
    return id.split('-').map(function (w) {
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(' ');
  }

  function getCategoryLabel(id) {
    if (!id) return '';
    var lower = id.toLowerCase();
    if (lower === 'rag') return 'RAG';
    if (lower === 'backend-performance') return '백엔드 성능';
    if (lower === 'backend-stability') return '백엔드 안정성';
    if (lower === 'frontend-performance') return '프론트엔드 성능';
    if (lower === 'cicd' || lower === 'ci-cd' || lower === 'backend-cicd') return 'CI/CD';
    return formatLabel(id);
  }

  // 트랙은 learning/setup/journal 셋 뿐이다(build.mjs A-2 참고).
  function getTrackLabel(id) {
    if (!id) return '';
    var lower = id.toLowerCase();
    if (lower === 'learning') return '개념서';
    if (lower === 'setup') return '기초 환경 설정';
    if (lower === 'journal') return '구현기';
    return formatLabel(id);
  }

  var categories = [];
  DOCS.forEach(function (d) {
    if (d.category && categories.indexOf(d.category) === -1) {
      categories.push(d.category);
    }
  });

  var currentCategory = categories[0] || null;

  var navEl = document.getElementById('nav')
  // renderNav()는 nav__link 목록만 다시 그린다. nav__close 버튼은 nav(aside) 안에
  // 고정으로 존재해야 하므로, innerHTML을 통째로 덮어쓰지 않도록 별도 컨테이너를 쓴다.
  var navListEl = document.getElementById('navList') || navEl
  var paperEl = document.getElementById('paper')
  var tocEl = document.getElementById('toc')
  var topbarDoc = document.getElementById('topbarDoc')
  var menuBtn = document.getElementById('menuBtn')
  var catTabsEl = document.getElementById('catTabs')
  var navScrim = document.getElementById('navScrim')
  var navClose = document.getElementById('navClose')
  var pdfToggle = document.getElementById('pdfToggle')
  var pdfBar = document.getElementById('pdfBar')
  var pdfCount = document.getElementById('pdfCount')

  var current = null
  var spy = null
  // PDF 선택 상태: docHash(doc) 문자열을 담는다. 카테고리 탭을 오가며 renderNav가
  // 다시 그려져도(각 링크 렌더 시 이 Set을 조회해 .selected를 복원하므로) 유지된다.
  var pdfSelected = new Set()

  function slugify(t) {
    return t.trim().toLowerCase()
      .replace(/[^\w가-힣\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
  }

  // URL 해시 라우팅: "#카테고리/슬러그" 형태로 현재 문서를 반영해
  // 새로고침과 브라우저 뒤로/앞으로가기에서 읽던 문서를 잃지 않게 한다.
  function docHash(doc) {
    return encodeURIComponent(doc.category) + '/' + encodeURIComponent(doc.slug)
  }

  function findDocByHash(hash) {
    if (!hash) return null
    var clean = hash.replace(/^#/, '')
    var slashIdx = clean.indexOf('/')
    if (slashIdx === -1) return null
    var cat, slug
    try {
      cat = decodeURIComponent(clean.slice(0, slashIdx))
      slug = decodeURIComponent(clean.slice(slashIdx + 1))
    } catch (e) {
      return null
    }
    return DOCS.filter(function (d) { return d.category === cat && d.slug === slug })[0] || null
  }

  function isPdfSelectMode() {
    return document.body.classList.contains('pdf-select-mode')
  }

  // 상단 카테고리 탭 렌더링
  function renderCategoryTabs() {
    if (!catTabsEl) return;
    var html = '';
    categories.forEach(function (cat) {
      var label = getCategoryLabel(cat);
      var activeClass = cat === currentCategory ? ' active' : '';
      html += '<button class="cat-tab' + activeClass + '" data-category="' + cat + '">' +
        escapeHtml(label) + '</button>';
    });
    catTabsEl.innerHTML = html;

    catTabsEl.querySelectorAll('.cat-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var cat = btn.getAttribute('data-category');
        selectCategory(cat);
      });
    });
  }

  // 카테고리 탭의 active 표시를 갱신하고, 모바일 가로 스크롤 탭에서 활성 탭이
  // 화면 밖에 있으면 보이는 위치로 스크롤한다.
  function activateCategoryTab(cat) {
    if (!catTabsEl) return;
    catTabsEl.querySelectorAll('.cat-tab').forEach(function (btn) {
      var isActive = btn.getAttribute('data-category') === cat;
      btn.classList.toggle('active', isActive);
      if (isActive && btn.scrollIntoView) {
        btn.scrollIntoView({ inline: 'nearest', block: 'nearest' });
      }
    });
  }

  function selectCategory(cat) {
    currentCategory = cat;
    activateCategoryTab(cat);
    renderNav();
    var firstDoc = DOCS.find(function (d) { return d.category === cat; });
    if (firstDoc) {
      selectDoc(firstDoc);
    }
  }

  // 좌측 문서 네비
  function renderNav() {
    var html = '';
    if (!currentCategory) {
      navListEl.innerHTML = '<div class="nav__empty">카테고리 없음</div>';
      return;
    }

    var categoryDocs = DOCS.filter(function (d) { return d.category === currentCategory; });
    var categoryTracks = [];
    categoryDocs.forEach(function (d) {
      if (d.track && categoryTracks.indexOf(d.track) === -1) {
        categoryTracks.push(d.track);
      }
    });
    // 문서 등장 순서에 기대지 않고 learning -> setup -> journal 순서를 명시적으로 강제한다.
    categoryTracks.sort(function (a, b) { return trackPriority(a) - trackPriority(b); });

    var selectMode = isPdfSelectMode();

    categoryTracks.forEach(function (trId) {
      var trLabel = getTrackLabel(trId);
      var docs = categoryDocs.filter(function (d) { return d.track === trId; });
      html += '<div class="nav__track"><div class="nav__track-h">' + escapeHtml(trLabel) + '</div>';
      if (!docs.length) {
        html += '<div class="nav__empty">문서 없음</div>';
      }
      docs.forEach(function (d, i) {
        var isActive = current && current.category === d.category && current.slug === d.slug;
        var isSelected = pdfSelected.has(docHash(d));
        var cls = 'nav__link' + (isActive ? ' active' : '') + (isSelected ? ' selected' : '');
        var a11yAttrs = selectMode
          ? ' role="checkbox" aria-checked="' + (isSelected ? 'true' : 'false') + '"'
          : '';
        html += '<button class="' + cls + '" data-category="' + d.category + '" data-slug="' + d.slug + '"' + a11yAttrs + '>' +
          '<span class="nav__check" aria-hidden="true"></span>' +
          '<span class="nav__num">' + (i + 1) + '</span>' +
          '<span class="nav__title">' + escapeHtml(d.title) + '</span>' +
          (d.date ? '<span class="nav__date">' + escapeHtml(d.date) + '</span>' : '') +
          '</button>';
      });
      html += '</div>';
    });

    navListEl.innerHTML = html;

    navListEl.querySelectorAll('.nav__link').forEach(function (b) {
      b.addEventListener('click', function () {
        if (isPdfSelectMode()) {
          toggleDocSelection(b);
          return;
        }
        var cat = b.getAttribute('data-category');
        var slug = b.getAttribute('data-slug');
        var doc = DOCS.find(function (d) { return d.category === cat && d.slug === slug; });
        if (doc) {
          selectDoc(doc);
        }
        closeNav();
      });
    });
  }

  function toggleDocSelection(btn) {
    var cat = btn.getAttribute('data-category');
    var slug = btn.getAttribute('data-slug');
    var doc = DOCS.find(function (d) { return d.category === cat && d.slug === slug; });
    if (!doc) return;
    var key = docHash(doc);
    var nowSelected;
    if (pdfSelected.has(key)) {
      pdfSelected.delete(key);
      nowSelected = false;
    } else {
      pdfSelected.add(key);
      nowSelected = true;
    }
    btn.classList.toggle('selected', nowSelected);
    btn.setAttribute('aria-checked', nowSelected ? 'true' : 'false');
    updatePdfBar();
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  function selectDoc(doc, skipHash) {
    if (!doc) return;

    if (doc.category !== currentCategory) {
      currentCategory = doc.category;
      activateCategoryTab(currentCategory);
      renderNav();
    }

    current = doc;
    paperEl.innerHTML = window.marked.parse(doc.md);
    topbarDoc.textContent = doc.title;

    navListEl.querySelectorAll('.nav__link').forEach(function (b) {
      var isSame = b.getAttribute('data-category') === doc.category && b.getAttribute('data-slug') === doc.slug;
      b.classList.toggle('active', isSame);
    });

    if (!skipHash) {
      var key = docHash(doc);
      if (location.hash.replace(/^#/, '') !== key) {
        location.hash = key;
      }
    }

    wrapTables();
    assignHeadingIds();
    linkifyCrossReferences();
    buildToc();
    window.scrollTo(0, 0);

    var catLabel = getCategoryLabel(doc.category);
    document.title = doc.title + ' — ' + catLabel + ' 연구 노트';
  }

  // 넓은 표가 페이지를 가로로 밀지 않도록 스크롤 컨테이너로 감싼다.
  // 실제로 가로 스크롤이 필요한 표에만 스크롤 가능 힌트 클래스를 준다(C-4).
  function wrapTables() {
    paperEl.querySelectorAll('table').forEach(function (table) {
      if (table.parentElement && table.parentElement.classList.contains('table-wrap')) return;
      var wrap = document.createElement('div');
      wrap.className = 'table-wrap';
      table.parentNode.insertBefore(wrap, table);
      wrap.appendChild(table);
    });
    paperEl.querySelectorAll('.table-wrap').forEach(function (wrap) {
      var table = wrap.querySelector('table');
      if (!table) return;
      var scrollable = table.scrollWidth > wrap.clientWidth + 1;
      wrap.classList.toggle('table-wrap--scrollable', scrollable);
    });
  }

  // 렌더된 h2/h3에 id 부여(목차 앵커용)
  function assignHeadingIds() {
    var seen = {}
    paperEl.querySelectorAll('h2, h3').forEach(function (h) {
      var base = slugify(h.textContent) || 'sec'
      var id = base
      var n = 1
      while (seen[id]) { id = base + '-' + (++n) }
      seen[id] = true
      h.id = id
    })
  }

  // 본문에 다른 문서 파일명이 인라인 코드(`01-rag-basics.md`)로만 언급된 경우
  // 실제로 그 slug을 가진 문서가 존재하면 클릭 가능한 앱 내 링크로 바꾼다(C-7, best-effort).
  // 같은 카테고리 안에서 우선 찾고, 없으면 전체에서 찾는다(같은 순번 파일명이
  // 여러 카테고리에 흩어져 있어 완전히 유일하지는 않기 때문).
  function linkifyCrossReferences() {
    if (!current) return;
    paperEl.querySelectorAll('code').forEach(function (el) {
      if (el.closest('a')) return;
      if (el.closest('pre')) return;
      var text = (el.textContent || '').trim();
      if (!/^\d{2}[\w-]*\.md$/.test(text)) return;
      var slug = text.replace(/\.md$/, '');
      var target = DOCS.find(function (d) { return d.slug === slug && d.category === current.category; }) ||
        DOCS.find(function (d) { return d.slug === slug; });
      if (!target) return;
      var a = document.createElement('a');
      a.href = '#' + docHash(target);
      el.parentNode.insertBefore(a, el);
      a.appendChild(el);
    });
  }

  // 우측 목차
  function buildToc() {
    var heads = paperEl.querySelectorAll('h2, h3')
    // 각주 섹션(ol.footnotes, 문서 본문에 raw HTML로 박혀 있음)에 id를 부여해
    // h2/h3 번호 체계와는 별개로 목차 맨 아래에서 점프할 수 있게 한다(C-5).
    var footnotesEl = paperEl.querySelector('ol.footnotes')
    if (footnotesEl) footnotesEl.id = 'footnotes'

    if (!heads.length && !footnotesEl) { tocEl.innerHTML = ''; return }

    var c2 = 0, c3 = 0
    var html = '<div class="toc__h">이 문서 목차</div>'
    heads.forEach(function (h) {
      var num
      if (h.tagName === 'H2') { c2++; c3 = 0; num = c2 + '.' }
      else { c3++; num = c2 + '.' + c3 }
      var cls = h.tagName === 'H3' ? 'toc__link l3' : 'toc__link'
      html += '<a class="' + cls + '" href="#' + h.id + '" data-id="' + h.id + '">' +
        num + '  ' + escapeHtml(h.textContent) + '</a>'
    })
    if (footnotesEl) {
      html += '<a class="toc__link toc__link--footnotes" href="#footnotes" data-id="footnotes">참고문헌</a>'
    }
    tocEl.innerHTML = html
    tocEl.querySelectorAll('.toc__link').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault()
        var t = document.getElementById(a.getAttribute('data-id'))
        if (t) window.scrollTo({ top: t.getBoundingClientRect().top + window.pageYOffset - 64, behavior: 'smooth' })
      })
    })
    setupSpy(heads)
  }

  // 스크롤 스파이
  function setupSpy(heads) {
    if (spy) spy.disconnect()
    if (!heads.length) return
    var links = {}
    tocEl.querySelectorAll('.toc__link').forEach(function (a) { links[a.getAttribute('data-id')] = a })
    spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          Object.keys(links).forEach(function (k) { links[k].classList.remove('active') })
          if (links[en.target.id]) links[en.target.id].classList.add('active')
        }
      })
    }, { rootMargin: '-64px 0px -70% 0px' })
    heads.forEach(function (h) { spy.observe(h) })
  }

  // ---- 모바일 내비 드로어 ----
  function openNav() {
    navEl.classList.add('open');
    if (navScrim) navScrim.classList.add('visible');
    document.body.style.overflow = 'hidden';
  }

  function closeNav() {
    navEl.classList.remove('open');
    if (navScrim) navScrim.classList.remove('visible');
    document.body.style.overflow = '';
  }

  if (menuBtn) {
    menuBtn.addEventListener('click', function () {
      if (navEl.classList.contains('open')) closeNav(); else openNav();
    });
  }
  if (navClose) navClose.addEventListener('click', closeNav);
  if (navScrim) navScrim.addEventListener('click', closeNav);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && navEl.classList.contains('open')) closeNav();
  });

  // ---- PDF 내보내기 ----
  function updatePdfBar() {
    if (!pdfBar) return;
    var n = pdfSelected.size;
    if (n === 0) {
      pdfBar.classList.remove('visible');
      pdfBar.hidden = true;
      return;
    }
    if (pdfBar.hidden) {
      pdfBar.hidden = false;
      // display:none -> block 직후 바로 opacity를 올리면 트랜지션이 생략되므로
      // 한 프레임 강제 리플로우 후 visible 클래스를 붙인다.
      void pdfBar.offsetWidth;
    }
    pdfBar.classList.add('visible');
    if (pdfCount) pdfCount.textContent = n + '개 선택됨';
  }

  function exitPdfSelectMode() {
    document.body.classList.remove('pdf-select-mode');
    if (pdfToggle) {
      pdfToggle.classList.remove('active');
      pdfToggle.setAttribute('aria-pressed', 'false');
    }
  }

  if (pdfToggle) {
    pdfToggle.addEventListener('click', function () {
      var entering = !isPdfSelectMode();
      document.body.classList.toggle('pdf-select-mode', entering);
      pdfToggle.classList.toggle('active', entering);
      pdfToggle.setAttribute('aria-pressed', entering ? 'true' : 'false');
      if (!entering) {
        pdfSelected.clear();
        updatePdfBar();
      }
      renderNav();
    });
  }

  if (pdfBar) {
    pdfBar.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-act]') : null;
      if (!btn) return;
      var act = btn.getAttribute('data-act');
      if (act === 'all') {
        DOCS.forEach(function (d) { pdfSelected.add(docHash(d)); });
        renderNav();
        updatePdfBar();
      } else if (act === 'clear') {
        pdfSelected.clear();
        renderNav();
        updatePdfBar();
      } else if (act === 'cancel') {
        pdfSelected.clear();
        exitPdfSelectMode();
        renderNav();
        updatePdfBar();
      } else if (act === 'export') {
        exportSelectedToPdf();
      }
    });
  }

  function sortDocsForPrint(list) {
    return list.slice().sort(function (a, b) {
      var cp = categoryPriority(a.category) - categoryPriority(b.category);
      if (cp !== 0) return cp;
      if (a.category !== b.category) return a.category.localeCompare(b.category);
      var tp = trackPriority(a.track) - trackPriority(b.track);
      if (tp !== 0) return tp;
      if (a.track !== b.track) return a.track.localeCompare(b.track);
      return a.order - b.order;
    });
  }

  function exportSelectedToPdf() {
    var selectedDocs = DOCS.filter(function (d) { return pdfSelected.has(docHash(d)); });
    if (!selectedDocs.length) return;

    if (selectedDocs.length > 20) {
      var proceed = window.confirm('선택한 문서가 ' + selectedDocs.length + '개입니다. 이대로 인쇄를 진행할까요?');
      if (!proceed) return;
    }

    selectedDocs = sortDocsForPrint(selectedDocs);

    var existing = document.getElementById('printRoot');
    if (existing) existing.remove();

    var printRoot = document.createElement('div');
    printRoot.id = 'printRoot';

    selectedDocs.forEach(function (d) {
      var section = document.createElement('section');
      section.className = 'print-doc';

      var header = document.createElement('header');
      header.className = 'print-doc__head';

      var meta = document.createElement('div');
      meta.className = 'print-doc__meta';
      var metaParts = [getCategoryLabel(d.category), getTrackLabel(d.track)];
      if (d.date) metaParts.push(d.date);
      meta.textContent = metaParts.join(' · ');
      header.appendChild(meta);

      var title = document.createElement('h1');
      title.className = 'print-doc__title';
      title.textContent = d.title;
      header.appendChild(title);

      section.appendChild(header);

      var paper = document.createElement('div');
      paper.className = 'paper';
      paper.innerHTML = window.marked.parse(d.md);
      section.appendChild(paper);

      printRoot.appendChild(section);
    });

    document.body.appendChild(printRoot);

    var cleaned = false;
    function cleanup() {
      if (cleaned) return;
      cleaned = true;
      var el = document.getElementById('printRoot');
      if (el) el.remove();
      window.removeEventListener('afterprint', cleanup);
    }
    window.addEventListener('afterprint', cleanup);
    if (window.matchMedia) {
      var mq = window.matchMedia('print');
      if (mq && mq.addEventListener) {
        mq.addEventListener('change', function (e) {
          if (!e.matches) cleanup();
        });
      }
    }

    window.print();
  }

  // 뒤로/앞으로가기 및 다른 탭에서 해시를 직접 바꾼 경우를 반영한다.
  // 이미 같은 문서를 보고 있다면(우리가 방금 hash를 설정한 경우) 다시 그리지 않는다.
  window.addEventListener('hashchange', function () {
    var doc = findDocByHash(location.hash);
    if (!doc) return;
    if (current && current.category === doc.category && current.slug === doc.slug) return;
    selectDoc(doc, true);
  });

  // 읽기 진행 바 + 맨 위로 버튼: 긴 문서에서 현재 위치 파악과 빠른 이동을 돕는다.
  var progressEl = document.getElementById('progress');
  var topBtn = document.getElementById('topBtn');

  function updateProgress() {
    var doc = document.documentElement;
    var scrollable = doc.scrollHeight - doc.clientHeight;
    var ratio = scrollable > 0 ? (doc.scrollTop || window.pageYOffset) / scrollable : 0;
    if (progressEl) progressEl.style.width = Math.min(1, Math.max(0, ratio)) * 100 + '%';
    if (topBtn) topBtn.classList.toggle('visible', (doc.scrollTop || window.pageYOffset) > 480);
  }

  window.addEventListener('scroll', updateProgress, { passive: true });
  if (topBtn) {
    topBtn.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  renderCategoryTabs();
  renderNav();

  var initialDoc = findDocByHash(location.hash);
  if (initialDoc) {
    selectDoc(initialDoc, true);
  } else if (DOCS.length) {
    selectDoc(DOCS[0]);
  } else {
    paperEl.innerHTML = '<h1>문서를 준비 중입니다</h1><p>build.mjs를 실행해 docs.js를 생성하세요.</p>';
  }

  updateProgress();
})()
