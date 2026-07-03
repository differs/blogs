/* ============================================
   differs' blog — Main Script
   光暗切换 · 自动目录 · 滚动高亮
   ============================================ */

(function () {
  'use strict';

  // ---------- 1. 光暗模式切换 ----------
  const toggle = document.getElementById('theme-toggle');
  const html = document.documentElement;

  function getPreferredTheme() {
    const saved = localStorage.getItem('theme');
    if (saved) return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function setTheme(theme) {
    html.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }

  // 初始化主题
  setTheme(getPreferredTheme());

  if (toggle) {
    toggle.addEventListener('click', function () {
      const current = html.getAttribute('data-theme');
      setTheme(current === 'dark' ? 'light' : 'dark');
    });
  }

  // 监听系统主题变化
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
    if (!localStorage.getItem('theme')) {
      setTheme(e.matches ? 'dark' : 'light');
    }
  });

  // ---------- 2. 自动生成文章目录 ----------
  const tocNav = document.getElementById('toc-nav');
  const postBody = document.querySelector('.post-body');

  if (tocNav && postBody) {
    const headings = postBody.querySelectorAll('h2, h3');
    if (headings.length > 0) {
      const tocList = document.createElement('ul');
      let lastH2Item = null;

      headings.forEach(function (heading, index) {
        // 给 heading 加 id（如果没有的话）
        if (!heading.id) {
          heading.id = 'section-' + index;
        }

        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = '#' + heading.id;
        a.textContent = heading.textContent;

        if (heading.tagName === 'H3') {
          a.classList.add('toc-h3');
          if (lastH2Item) {
            // 找或创建 h2 下的子 ul
            let subUl = lastH2Item.querySelector('ul');
            if (!subUl) {
              subUl = document.createElement('ul');
              lastH2Item.appendChild(subUl);
            }
            const subLi = document.createElement('li');
            subLi.appendChild(a);
            subUl.appendChild(subLi);
            return; // 跳过下面的 appendChild
          }
        } else {
          lastH2Item = li;
        }

        li.appendChild(a);
        tocList.appendChild(li);
      });

      tocNav.appendChild(tocList);

      // ---------- 3. 滚动时高亮当前章节 ----------
      const tocLinks = tocNav.querySelectorAll('a');
      const allHeadings = postBody.querySelectorAll('h2, h3');

      function updateActiveToc() {
        let currentId = '';
        const scrollPos = window.scrollY + 100;

        allHeadings.forEach(function (h) {
          if (h.offsetTop <= scrollPos) {
            currentId = h.id;
          }
        });

        tocLinks.forEach(function (link) {
          link.classList.remove('active');
          if (link.getAttribute('href') === '#' + currentId) {
            link.classList.add('active');
            // 滚动到可视区域
            const parent = link.closest('ul');
            if (parent) {
              const parentRect = parent.getBoundingClientRect();
              const linkRect = link.getBoundingClientRect();
              if (linkRect.bottom > parentRect.bottom || linkRect.top < parentRect.top) {
                link.scrollIntoView({ block: 'nearest' });
              }
            }
          }
        });
      }

      // 用 requestAnimationFrame 节流
      let ticking = false;
      window.addEventListener('scroll', function () {
        if (!ticking) {
          requestAnimationFrame(function () {
            updateActiveToc();
            ticking = false;
          });
          ticking = true;
        }
      });

      // 点击 TOC 链接平滑滚动
      tocLinks.forEach(function (link) {
        link.addEventListener('click', function (e) {
          e.preventDefault();
          const target = document.querySelector(this.getAttribute('href'));
          if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            history.replaceState(null, '', this.getAttribute('href'));
          }
        });
      });

      // 初始高亮
      setTimeout(updateActiveToc, 100);
    } else {
      // 没有标题，隐藏目录
      document.getElementById('toc').style.display = 'none';
    }
  }
})();
