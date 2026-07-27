/* =========================================================================
   MATHEUS LUZ - REDES & INFORMÁTICA
   Script principal (JavaScript puro, sem dependências)
   ========================================================================= */

document.addEventListener('DOMContentLoaded', function () {

    /* ---------- 1. NAVBAR: MUDANÇA DE COR AO ROLAR ---------- */
    var navbar = document.getElementById('navbar');
    var scrollThreshold = 40;

    function updateNavbarState() {
        if (window.scrollY > scrollThreshold) {
            navbar.classList.add('is-scrolled');
        } else {
            navbar.classList.remove('is-scrolled');
        }
    }

    updateNavbarState();
    window.addEventListener('scroll', updateNavbarState);

    /* ---------- 2. MENU MOBILE (HAMBÚRGUER) ---------- */
    var navToggle = document.getElementById('navbar-toggle');
    var navMenu = document.getElementById('navbar-nav');

    navToggle.addEventListener('click', function () {
        var isOpen = navMenu.classList.toggle('is-open');
        navToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    /* Fecha o menu mobile ao clicar em qualquer link */
    var navLinks = navMenu.querySelectorAll('a');
    navLinks.forEach(function (link) {
        link.addEventListener('click', function () {
            navMenu.classList.remove('is-open');
            navToggle.setAttribute('aria-expanded', 'false');
        });
    });

    /* ---------- 3. SCROLL REVEAL (FADE-IN AO ROLAR) ---------- */
    var revealElements = document.querySelectorAll('.reveal');

    var revealObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
            if (entry.isIntersecting) {
                entry.target.classList.add('is-visible');
                revealObserver.unobserve(entry.target);
            }
        });
    }, {
        threshold: 0.15,
        rootMargin: '0px 0px -60px 0px'
    });

    revealElements.forEach(function (element) {
        revealObserver.observe(element);
    });

    /* ---------- 4. ANO ATUAL NO RODAPÉ ---------- */
    var yearElement = document.getElementById('current-year');
    if (yearElement) {
        yearElement.textContent = new Date().getFullYear();
    }

});
