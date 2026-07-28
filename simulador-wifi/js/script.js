/* =========================================================================
   SIMULADOR DE COBERTURA WI-FI
   Script principal — física do sinal, renderização e interação
   ========================================================================= */

(function () {
    'use strict';

    /* =====================================================================
       1. DADOS DA PLANTA (ÚNICA FONTE DE VERDADE)
       As paredes são usadas tanto para desenhar o SVG quanto para o
       cálculo de obstrução do sinal, evitando duplicação de coordenadas.
       Cada parede é um segmento de reta {x1, y1, x2, y2} no sistema de
       coordenadas do viewBox (0 0 900 650). As lacunas entre segmentos
       representam as portas dos cômodos.
       ===================================================================== */
    var HOUSE_BOUNDS = { minX: 40, minY: 40, maxX: 860, maxY: 610 };

    var WALLS = [
        // Perímetro externo
        { x1: 40, y1: 40, x2: 860, y2: 40 },      // topo
        { x1: 860, y1: 40, x2: 860, y2: 610 },    // direita
        { x1: 40, y1: 610, x2: 860, y2: 610 },    // base
        { x1: 40, y1: 40, x2: 40, y2: 150 },      // esquerda (acima da porta)
        { x1: 40, y1: 210, x2: 40, y2: 610 },     // esquerda (abaixo da porta) -> porta de entrada

        // Sala | Cozinha (parede vertical x=460, porta y=150-210)
        { x1: 460, y1: 40, x2: 460, y2: 150 },
        { x1: 460, y1: 210, x2: 460, y2: 330 },

        // Divisão entre cômodos superiores e inferiores (y=330), com 3 portas
        { x1: 40, y1: 330, x2: 150, y2: 330 },
        { x1: 210, y1: 330, x2: 390, y2: 330 },
        { x1: 430, y1: 330, x2: 650, y2: 330 },
        { x1: 710, y1: 330, x2: 860, y2: 330 },

        // Quarto 1 | Banheiro (parede vertical x=320, porta y=440-500)
        { x1: 320, y1: 330, x2: 320, y2: 440 },
        { x1: 320, y1: 500, x2: 320, y2: 610 },

        // Banheiro | Quarto 2 (parede vertical x=500, porta y=440-500)
        { x1: 500, y1: 330, x2: 500, y2: 440 },
        { x1: 500, y1: 500, x2: 500, y2: 610 }
    ];

    /* =====================================================================
       2. PERFIS DOS DISPOSITIVOS
       Cada tipo de equipamento tem alcance máximo e perda de sinal por
       parede atravessada diferentes, simulando suas características reais.
       O Repetidor não tem sinal próprio: ele depende de captar o sinal
       de um Roteador já posicionado (ver função signalFromRepeater).
       ===================================================================== */
    var DEVICE_PROFILES = {
        router: {
            label: 'Roteador',
            maxRange: 420,
            wallLoss: 16,
            multiNode: false,
            dependsOnRouter: false,
            instructions: 'Clique em qualquer ponto da planta para posicionar o Roteador.'
        },
        repeater: {
            label: 'Repetidor',
            maxRange: 320,
            wallLoss: 20,
            multiNode: true,
            dependsOnRouter: true,
            instructions: 'Clique na planta para posicionar um Repetidor. Ele precisa estar dentro do alcance do Roteador para funcionar.'
        },
        accesspoint: {
            label: 'Access Point',
            maxRange: 520,
            wallLoss: 10,
            multiNode: false,
            dependsOnRouter: false,
            instructions: 'Clique em qualquer ponto da planta para posicionar o Access Point.'
        },
        mesh: {
            label: 'Mesh',
            maxRange: 360,
            wallLoss: 14,
            multiNode: true,
            dependsOnRouter: false,
            instructions: 'Clique na planta para adicionar pontos Mesh. Cada clique soma um novo nó à rede.'
        }
    };

    // Eficiência da retransmissão: o repetidor nunca devolve mais sinal
    // do que recebeu do Roteador, apenas propaga essa força para mais longe.
    var REPEATER_EFFICIENCY = 0.92;

    /* =====================================================================
       3. ESTADO DA APLICAÇÃO
       Todos os tipos de dispositivo coexistem na mesma planta, formando
       uma pequena rede: Roteador e Access Point são únicos (o novo clique
       substitui o anterior); Repetidor e Mesh aceitam múltiplos pontos.
       ===================================================================== */
    var state = {
        activeType: 'router',
        network: {
            router: null,       // {x, y, type} ou null
            accesspoint: null,  // {x, y, type} ou null
            repeater: [],       // lista de {x, y, type}
            mesh: []            // lista de {x, y, type}
        }
    };

    /* =====================================================================
       4. REFERÊNCIAS DO DOM
       ===================================================================== */
    var wallsLayer = document.getElementById('walls-layer');
    var devicesLayer = document.getElementById('devices-layer');
    var canvas = document.getElementById('heatmap-canvas');
    var ctx = canvas.getContext('2d');
    var viewport = document.getElementById('stage-viewport');
    var tooltip = document.getElementById('signal-tooltip');
    var stageHint = document.getElementById('stage-hint');
    var stageWarning = document.getElementById('stage-warning');
    var deviceNote = document.getElementById('device-note');
    var specRange = document.getElementById('spec-range');
    var specWallLoss = document.getElementById('spec-wallloss');
    var specNodes = document.getElementById('spec-nodes');
    var btnClear = document.getElementById('btn-clear');
    var deviceSelector = document.getElementById('device-selector');

    var VIEW_W = 900;
    var VIEW_H = 650;
    var BLOCK_SIZE = 8; // resolução do mapa de calor em pixels do viewBox

    /* =====================================================================
       5. GEOMETRIA — interseção de segmentos de reta
       Usada para contar quantas paredes o sinal atravessa entre o
       dispositivo e cada ponto da planta.
       ===================================================================== */
    function orientation(a, b, c) {
        return (c.y - a.y) * (b.x - a.x) - (b.y - a.y) * (c.x - a.x);
    }

    function segmentsIntersect(p1, p2, p3, p4) {
        var d1 = orientation(p3, p4, p1);
        var d2 = orientation(p3, p4, p2);
        var d3 = orientation(p1, p2, p3);
        var d4 = orientation(p1, p2, p4);

        return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
               ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
    }

    function countWallsCrossed(from, to) {
        var count = 0;
        for (var i = 0; i < WALLS.length; i++) {
            var wall = WALLS[i];
            var w1 = { x: wall.x1, y: wall.y1 };
            var w2 = { x: wall.x2, y: wall.y2 };
            if (segmentsIntersect(from, to, w1, w2)) {
                count++;
            }
        }
        return count;
    }

    /* =====================================================================
       6. FÍSICA DO SINAL
       ===================================================================== */

    // Intensidade (0 a 100) de uma fonte de sinal própria (Roteador,
    // Access Point ou um nó Mesh) em um ponto qualquer da planta.
    function signalFromDevice(point, device) {
        var profile = DEVICE_PROFILES[device.type];
        var dx = point.x - device.x;
        var dy = point.y - device.y;
        var distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > profile.maxRange) {
            return 0;
        }

        // Curva de queda não linear: forte perto da origem, cai mais
        // rapidamente perto do limite de alcance.
        var normalized = distance / profile.maxRange;
        var baseStrength = Math.max(0, 1 - Math.pow(normalized, 1.6)) * 100;

        var walls = countWallsCrossed(device, point);
        var strength = baseStrength - (walls * profile.wallLoss);

        return Math.max(0, Math.min(100, strength));
    }

    // O Repetidor não gera sinal próprio: ele primeiro "escuta" o sinal do
    // Roteador na sua própria posição e só então retransmite uma versão
    // atenuada dele. Sem Roteador ao alcance, o Repetidor fica inativo.
    function signalFromRepeater(point, repeater) {
        var profile = DEVICE_PROFILES.repeater;

        if (!state.network.router) {
            return 0;
        }

        var receivedAtRepeater = signalFromDevice(repeater, state.network.router);
        if (receivedAtRepeater <= 0) {
            return 0;
        }

        var dx = point.x - repeater.x;
        var dy = point.y - repeater.y;
        var distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > profile.maxRange) {
            return 0;
        }

        var normalized = distance / profile.maxRange;
        var localCurve = Math.max(0, 1 - Math.pow(normalized, 1.6));
        var walls = countWallsCrossed(repeater, point);

        // O sinal retransmitido nunca ultrapassa o que o repetidor recebeu.
        var outputAtSelf = receivedAtRepeater * REPEATER_EFFICIENCY;
        var strength = (outputAtSelf * localCurve) - (walls * profile.wallLoss);

        return Math.max(0, Math.min(100, strength));
    }

    // Retorna se um repetidor específico está recebendo sinal do Roteador.
    function repeaterHasSignal(repeater) {
        if (!state.network.router) {
            return false;
        }
        return signalFromDevice(repeater, state.network.router) > 0;
    }

    // Combina a contribuição de todos os dispositivos ativos da rede em
    // um único ponto, usando sempre o maior sinal disponível ali (como um
    // roaming real entre roteador, access point, mesh e repetidores).
    function totalSignalAtPoint(point) {
        var best = 0;

        if (state.network.router) {
            best = Math.max(best, signalFromDevice(point, state.network.router));
        }
        if (state.network.accesspoint) {
            best = Math.max(best, signalFromDevice(point, state.network.accesspoint));
        }
        state.network.mesh.forEach(function (node) {
            best = Math.max(best, signalFromDevice(point, node));
        });
        state.network.repeater.forEach(function (node) {
            best = Math.max(best, signalFromRepeater(point, node));
        });

        return best;
    }

    // Lista plana de todos os dispositivos posicionados, usada para
    // renderização e para o raio da animação de propagação.
    function getAllDevices() {
        var list = [];
        if (state.network.router) list.push(state.network.router);
        if (state.network.accesspoint) list.push(state.network.accesspoint);
        list = list.concat(state.network.repeater, state.network.mesh);
        return list;
    }

    function distanceToNearestDevice(point, devices) {
        var nearest = Infinity;
        for (var i = 0; i < devices.length; i++) {
            var dx = point.x - devices[i].x;
            var dy = point.y - devices[i].y;
            var d = Math.sqrt(dx * dx + dy * dy);
            if (d < nearest) {
                nearest = d;
            }
        }
        return nearest;
    }

    /* =====================================================================
       7. CLASSIFICAÇÃO DE COR POR FAIXA DE SINAL
       ===================================================================== */
    function colorForStrength(strength) {
        if (strength >= 75) return { rgb: '34, 197, 94', alpha: 0.38 + (strength / 100) * 0.3 };   // verde
        if (strength >= 50) return { rgb: '250, 204, 21', alpha: 0.38 + (strength / 100) * 0.3 };  // amarelo
        if (strength >= 25) return { rgb: '251, 146, 60', alpha: 0.38 + (strength / 100) * 0.3 };  // laranja
        if (strength > 0) return { rgb: '239, 68, 68', alpha: 0.38 + (strength / 100) * 0.3 };     // vermelho
        return null;
    }

    function labelForStrength(strength) {
        if (strength >= 75) return 'Excelente';
        if (strength >= 50) return 'Bom';
        if (strength >= 25) return 'Fraco';
        if (strength > 0) return 'Muito fraco';
        return 'Sem sinal';
    }

    /* =====================================================================
       8. DESENHO DAS PAREDES (SVG)
       ===================================================================== */
    function renderWalls() {
        wallsLayer.innerHTML = '';
        var ns = 'http://www.w3.org/2000/svg';

        WALLS.forEach(function (wall) {
            var line = document.createElementNS(ns, 'line');
            line.setAttribute('x1', wall.x1);
            line.setAttribute('y1', wall.y1);
            line.setAttribute('x2', wall.x2);
            line.setAttribute('y2', wall.y2);
            line.setAttribute('class', 'wall-line');
            wallsLayer.appendChild(line);
        });
    }

    /* =====================================================================
       9. DESENHO DOS DISPOSITIVOS (SVG)
       ===================================================================== */
    var DEVICE_ICONS = {
        router: '📡',
        repeater: '🔁',
        accesspoint: '📶',
        mesh: '🛰️'
    };

    var MARKER_COLORS = {
        router: '#0B5FFF',
        repeater: '#8E44AD',
        accesspoint: '#16A085',
        mesh: '#E67E22'
    };

    function renderDevices() {
        devicesLayer.innerHTML = '';
        var ns = 'http://www.w3.org/2000/svg';

        getAllDevices().forEach(function (device) {
            var color = MARKER_COLORS[device.type] || '#0A1931';
            var isInactiveRepeater = device.type === 'repeater' && !repeaterHasSignal(device);

            var group = document.createElementNS(ns, 'g');
            if (isInactiveRepeater) {
                group.setAttribute('class', 'device-marker--inactive');
            }

            var pulse = document.createElementNS(ns, 'circle');
            pulse.setAttribute('cx', device.x);
            pulse.setAttribute('cy', device.y);
            pulse.setAttribute('class', 'device-marker__pulse');
            pulse.style.stroke = color;
            if (isInactiveRepeater) {
                pulse.style.display = 'none';
            }
            group.appendChild(pulse);

            var core = document.createElementNS(ns, 'circle');
            core.setAttribute('cx', device.x);
            core.setAttribute('cy', device.y);
            core.setAttribute('r', 13);
            core.setAttribute('class', 'device-marker__core');
            core.style.fill = isInactiveRepeater ? '#9CA3AF' : color;
            group.appendChild(core);

            var icon = document.createElementNS(ns, 'text');
            icon.setAttribute('x', device.x);
            icon.setAttribute('y', device.y);
            icon.setAttribute('class', 'device-marker__icon');
            icon.textContent = DEVICE_ICONS[device.type] || '📡';
            group.appendChild(icon);

            devicesLayer.appendChild(group);
        });
    }

    /* =====================================================================
       10. RENDERIZAÇÃO DO MAPA DE CALOR (CANVAS)
       waveRadius limita o quanto da propagação já foi "revelado",
       permitindo a animação de propagação em tempo real.
       ===================================================================== */
    function renderHeatmap(waveRadius) {
        ctx.clearRect(0, 0, VIEW_W, VIEW_H);

        var devices = getAllDevices();
        if (devices.length === 0) {
            return;
        }

        for (var y = HOUSE_BOUNDS.minY; y < HOUSE_BOUNDS.maxY; y += BLOCK_SIZE) {
            for (var x = HOUSE_BOUNDS.minX; x < HOUSE_BOUNDS.maxX; x += BLOCK_SIZE) {
                var point = { x: x + BLOCK_SIZE / 2, y: y + BLOCK_SIZE / 2 };

                // Só desenha o bloco se a "onda" de propagação já alcançou
                // a distância até o nó mais próximo (efeito de animação).
                if (waveRadius !== Infinity) {
                    var nearest = distanceToNearestDevice(point, devices);
                    if (nearest > waveRadius) {
                        continue;
                    }
                }

                var strength = totalSignalAtPoint(point);
                var color = colorForStrength(strength);

                if (color) {
                    ctx.fillStyle = 'rgba(' + color.rgb + ', ' + color.alpha.toFixed(2) + ')';
                    ctx.fillRect(x, y, BLOCK_SIZE, BLOCK_SIZE);
                }
            }
        }
    }

    /* =====================================================================
       11. ANIMAÇÃO DE PROPAGAÇÃO DO SINAL
       Anima uma frente de onda saindo de cada dispositivo até cobrir o
       alcance máximo do equipamento recém-posicionado.
       ===================================================================== */
    var animationFrameId = null;

    function getMaxActiveRange() {
        var max = 0;
        Object.keys(state.network).forEach(function (key) {
            var value = state.network[key];
            var hasDevice = Array.isArray(value) ? value.length > 0 : !!value;
            if (hasDevice) {
                max = Math.max(max, DEVICE_PROFILES[key].maxRange);
            }
        });
        return max || 300;
    }

    function animatePropagation() {
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
        }

        var duration = 900; // milissegundos
        var maxWave = getMaxActiveRange() * 1.25;
        var startTime = performance.now();

        function step(now) {
            var elapsed = now - startTime;
            var t = Math.min(1, elapsed / duration);
            var eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
            var currentRadius = eased * maxWave;

            renderHeatmap(currentRadius);

            if (t < 1) {
                animationFrameId = requestAnimationFrame(step);
            } else {
                renderHeatmap(Infinity);
                animationFrameId = null;
            }
        }

        animationFrameId = requestAnimationFrame(step);
    }

    /* =====================================================================
       12. ATUALIZAÇÃO DO PAINEL LATERAL
       ===================================================================== */
    function updatePanel() {
        var profile = DEVICE_PROFILES[state.activeType];

        specRange.textContent = profile.maxRange + ' px';
        specWallLoss.textContent = profile.wallLoss + '% por parede';
        specNodes.textContent = getAllDevices().length;

        stageHint.textContent = profile.instructions;
        deviceNote.textContent = profile.multiNode
            ? (state.activeType === 'mesh'
                ? 'No modo Mesh, cada clique adiciona um novo ponto de rede.'
                : 'No modo Repetidor, cada clique adiciona um novo ponto. Cada um precisa estar dentro do alcance do Roteador.')
            : '';
        deviceNote.classList.toggle('is-visible', profile.multiNode);

        // Aviso de repetidor(es) sem sinal do roteador para captar
        var inactiveRepeaters = state.network.repeater.filter(function (r) {
            return !repeaterHasSignal(r);
        });

        if (!state.network.router && state.network.repeater.length > 0) {
            stageWarning.textContent = '⚠ Nenhum Roteador posicionado — o Repetidor não tem sinal para amplificar.';
            stageWarning.hidden = false;
        } else if (inactiveRepeaters.length > 0) {
            stageWarning.textContent = '⚠ ' + inactiveRepeaters.length + ' repetidor(es) fora do alcance do Roteador.';
            stageWarning.hidden = false;
        } else if (state.activeType === 'repeater' && !state.network.router) {
            stageWarning.textContent = '⚠ Posicione um Roteador antes de adicionar um Repetidor.';
            stageWarning.hidden = false;
        } else {
            stageWarning.hidden = true;
        }
    }

    function setActiveDeviceButton() {
        var buttons = deviceSelector.querySelectorAll('.device-btn');
        buttons.forEach(function (btn) {
            btn.classList.toggle('is-active', btn.dataset.device === state.activeType);
        });
    }

    /* =====================================================================
       13. CONVERSÃO DE COORDENADAS DO CLIQUE
       Converte a posição do clique/toque na tela para o sistema de
       coordenadas do viewBox (0 0 900 650), independente do tamanho
       renderizado na página.
       ===================================================================== */
    function getPointFromEvent(evt) {
        var rect = viewport.getBoundingClientRect();
        var scaleX = VIEW_W / rect.width;
        var scaleY = VIEW_H / rect.height;

        var x = (evt.clientX - rect.left) * scaleX;
        var y = (evt.clientY - rect.top) * scaleY;

        // Mantém o clique dentro dos limites internos da casa
        x = Math.max(HOUSE_BOUNDS.minX, Math.min(HOUSE_BOUNDS.maxX, x));
        y = Math.max(HOUSE_BOUNDS.minY, Math.min(HOUSE_BOUNDS.maxY, y));

        return { x: x, y: y };
    }

    /* =====================================================================
       14. EVENTOS
       ===================================================================== */
    viewport.addEventListener('click', function (evt) {
        var point = getPointFromEvent(evt);
        point.type = state.activeType;

        if (state.activeType === 'router' || state.activeType === 'accesspoint') {
            state.network[state.activeType] = point; // único: substitui o anterior
        } else {
            state.network[state.activeType].push(point); // múltiplo: adiciona
        }

        renderDevices();
        updatePanel();
        animatePropagation();
    });

    viewport.addEventListener('mousemove', function (evt) {
        var devices = getAllDevices();
        if (devices.length === 0) {
            tooltip.hidden = true;
            return;
        }

        var point = getPointFromEvent(evt);
        var strength = totalSignalAtPoint(point);

        var rect = viewport.getBoundingClientRect();
        var offsetX = evt.clientX - rect.left;
        var offsetY = evt.clientY - rect.top;

        tooltip.hidden = false;
        tooltip.style.left = offsetX + 'px';
        tooltip.style.top = offsetY + 'px';
        tooltip.textContent = 'Sinal: ' + Math.round(strength) + '% (' + labelForStrength(strength) + ')';
    });

    viewport.addEventListener('mouseleave', function () {
        tooltip.hidden = true;
    });

    deviceSelector.addEventListener('click', function (evt) {
        var button = evt.target.closest('.device-btn');
        if (!button) return;

        // Trocar o dispositivo selecionado no painel não remove os
        // equipamentos já posicionados: eles continuam formando a rede.
        state.activeType = button.dataset.device;

        setActiveDeviceButton();
        updatePanel();
    });

    btnClear.addEventListener('click', function () {
        state.network = { router: null, accesspoint: null, repeater: [], mesh: [] };
        renderDevices();
        updatePanel();
        renderHeatmap(Infinity);
        tooltip.hidden = true;
    });

    window.addEventListener('resize', function () {
        // O SVG e o canvas são responsivos via CSS; apenas garantimos que
        // o mapa de calor atual seja redesenhado sem reiniciar a animação.
        renderHeatmap(Infinity);
    });

    /* =====================================================================
       15. INICIALIZAÇÃO
       ===================================================================== */
    function init() {
        renderWalls();
        renderDevices();
        updatePanel();
        setActiveDeviceButton();
    }

    init();

})();
