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

    /* ---------- 5. MODAL "SAIBA MAIS" (EQUIPAMENTOS) ---------- */
    var EQUIPMENT_INFO = {
        cabeamento: {
            icon: '🔌',
            title: 'Cabeamento Estruturado',
            intro: 'Conexão física via cabos de rede (Ethernet) ligando diretamente cada dispositivo ao roteador ou switch.',
            points: [
                'Entrega a maior velocidade e a menor latência possíveis, sem depender de sinal sem fio.',
                'Não sofre interferência de paredes, outros aparelhos eletrônicos ou redes Wi-Fi vizinhas.',
                'É a escolha ideal para computadores de trabalho, videogames, TVs e qualquer equipamento fixo.',
                'Reduz travamentos e quedas de conexão em videochamadas, transmissões e jogos online.'
            ],
            importance: 'Por ser a base mais estável de qualquer rede, o cabeamento bem planejado evita gargalos e garante que o restante da rede Wi-Fi funcione com o máximo de performance.'
        },
        repetidor: {
            icon: '📶',
            title: 'Repetidor de Sinal',
            intro: 'Equipamento que capta o sinal Wi-Fi já existente e o retransmite, ampliando a área de cobertura.',
            points: [
                'Solução rápida e econômica para eliminar pontos cegos em cômodos distantes do roteador.',
                'Não exige passagem de cabos — basta ligar na tomada dentro do alcance do sinal original.',
                'Pode reduzir a velocidade da conexão, já que retransmite os dados no mesmo canal de rádio.',
                'Mais indicado para casas pequenas ou apartamentos com poucos obstáculos entre os cômodos.'
            ],
            importance: 'É uma ótima solução para resolver áreas com sinal fraco sem grandes investimentos, mas não substitui uma rede bem estruturada em ambientes maiores.'
        },
        'access-point': {
            icon: '📡',
            title: 'Access Point (AP)',
            intro: 'Dispositivo ligado por cabo ao roteador ou switch que cria um novo ponto de emissão de rede Wi-Fi.',
            points: [
                'Gera uma rede sem fio nova e independente, sem perda de velocidade como ocorre no repetidor.',
                'Como recebe os dados por cabo, entrega uma conexão muito mais estável e consistente.',
                'Permite instalar vários pontos cobrindo toda uma casa ou empresa com qualidade uniforme.',
                'É o padrão usado em ambientes profissionais, escritórios e empresas com muitos dispositivos.'
            ],
            importance: 'Para quem precisa de cobertura ampla sem sacrificar desempenho, o Access Point é o equipamento mais indicado — o próximo passo natural quando um repetidor já não é suficiente.'
        },
        mesh: {
            icon: '🛰️',
            title: 'Sistema Mesh',
            intro: 'Conjunto de múltiplos pontos (nós) que trabalham juntos formando uma única rede Wi-Fi inteligente.',
            points: [
                'Cobertura uniforme em toda a casa, mesmo em imóveis grandes ou com vários andares.',
                'Todos os pontos usam o mesmo nome de rede, e o dispositivo troca de nó automaticamente.',
                'Gerenciamento simples, geralmente feito por aplicativo, com visão de toda a rede em um só lugar.',
                'Elimina zonas mortas de forma elegante, sem a perda de velocidade típica dos repetidores.'
            ],
            importance: 'É a solução mais moderna e completa para famílias e casas grandes que precisam de Wi-Fi forte e estável em todos os cômodos, sem complicação técnica.'
        }
    };

    var modal = document.getElementById('equipment-modal');
    var modalOverlay = document.getElementById('equipment-modal-overlay');
    var modalClose = document.getElementById('equipment-modal-close');
    var modalIcon = document.getElementById('equipment-modal-icon');
    var modalTitle = document.getElementById('equipment-modal-title');
    var modalIntro = document.getElementById('equipment-modal-intro');
    var modalPoints = document.getElementById('equipment-modal-points');
    var modalImportance = document.getElementById('equipment-modal-importance');
    var modalTriggers = document.querySelectorAll('[data-modal-target]');

    function openEquipmentModal(key) {
        var info = EQUIPMENT_INFO[key];
        if (!info || !modal) return;

        modalIcon.textContent = info.icon;
        modalTitle.textContent = info.title;
        modalIntro.textContent = info.intro;
        modalImportance.textContent = info.importance;

        modalPoints.innerHTML = '';
        info.points.forEach(function (point) {
            var li = document.createElement('li');
            li.textContent = point;
            modalPoints.appendChild(li);
        });

        modal.hidden = false;
        // Pequeno atraso para permitir a transição de entrada (fade + scale)
        requestAnimationFrame(function () {
            modal.classList.add('is-visible');
        });
        document.body.style.overflow = 'hidden';
    }

    function closeEquipmentModal() {
        if (!modal) return;
        modal.classList.remove('is-visible');
        document.body.style.overflow = '';
        setTimeout(function () {
            modal.hidden = true;
        }, 300);
    }

    modalTriggers.forEach(function (trigger) {
        trigger.addEventListener('click', function () {
            openEquipmentModal(trigger.dataset.modalTarget);
        });
    });

    if (modalClose) {
        modalClose.addEventListener('click', closeEquipmentModal);
    }

    if (modalOverlay) {
        modalOverlay.addEventListener('click', closeEquipmentModal);
    }

    document.addEventListener('keydown', function (evt) {
        if (evt.key === 'Escape' && modal && !modal.hidden) {
            closeEquipmentModal();
        }
    });

});
