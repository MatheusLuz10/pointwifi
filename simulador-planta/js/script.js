/* =========================================================================
   SIMULADOR INTELIGENTE DE PLANTA
   Editor de planta + cálculo de cobertura Wi-Fi
   100% HTML/CSS/JS puro. Sem IA, sem APIs, sem bibliotecas externas.
   Funciona offline. Salva automaticamente no localStorage.
   ========================================================================= */

(function () {
    'use strict';

    /* =====================================================================
       1. CONSTANTES E TIPOS
       ===================================================================== */
    var STORAGE_KEY = 'pointwifi-planta-v1';

    var GRID_COLS = 12; // largura do terreno, em metros
    var GRID_ROWS = 16; // profundidade do terreno, em metros

    var ROOM_TYPES = {
        sala:       { label: 'Sala',        icon: '🏠', color: '#EAF1FF', w: 4, h: 4 },
        quarto:     { label: 'Quarto',      icon: '🛏️', color: '#F0FFF4', w: 3, h: 3 },
        cozinha:    { label: 'Cozinha',     icon: '🍳', color: '#FFF6E5', w: 3, h: 3 },
        banheiro:   { label: 'Banheiro',    icon: '🚿', color: '#F2F0FF', w: 2, h: 2 },
        garagem:    { label: 'Garagem',     icon: '🚗', color: '#F0F0F0', w: 5, h: 3 },
        varanda:    { label: 'Varanda',     icon: '🌳', color: '#EAFBF0', w: 3, h: 2 },
        escritorio: { label: 'Escritório',  icon: '🖥️', color: '#FFF0F5', w: 3, h: 3 },
        lavanderia: { label: 'Lavanderia',  icon: '📦', color: '#F5F0E8', w: 2, h: 2 },
        outro:      { label: 'Outro Ambiente', icon: '➕', color: '#F5F7FA', w: 3, h: 3 }
    };

    var DEVICE_TYPES = {
        celular:    { label: 'Celular',    icon: '📱' },
        notebook:   { label: 'Notebook',   icon: '💻' },
        tv:         { label: 'Smart TV',   icon: '📺' },
        console:    { label: 'Console',    icon: '🎮' },
        impressora: { label: 'Impressora', icon: '🖨️' }
    };

    // Alcance e perda por parede em unidades do mundo (metros / % por parede) —
    // mesma lógica do simulador de cobertura existente, adaptada para metros reais.
    var NETWORK_TYPES = {
        router: { label: 'Roteador',     icon: '📡', maxRange: 9,  wallLoss: 16 },
        ap:     { label: 'Access Point', icon: '📶', maxRange: 12, wallLoss: 10 }
    };

    // Peso de atenuação por tipo de abertura, relativo a uma parede cheia (1.0)
    var OPENING_WEIGHT = { none: 1, window: 0.2, door: 0.05 };
    var OPENING_TOLERANCE = 0.15; // fração da parede considerada "coberta" pela porta/janela
    var PLACEMENT_TOLERANCE = 0.8; // metros — distância máxima do toque até uma parede válida

    var COLOR_BLOCK = 8; // tamanho do bloco do mapa de calor, em pixels de tela

    /* =====================================================================
       2. ESTADO DA APLICAÇÃO
       ===================================================================== */
    var state = {
        rooms: [],     // { id, type, x, y, w, h }  — x,y,w,h em metros
        openings: [],  // { id, roomId, edge, t, type }
        devices: [],   // { id, kind, x, y }
        selection: null,   // { type: 'room'|'device', id }
        activeTool: null,  // { tool, roomType|deviceType|networkType }
        showCoverage: false,
        nextId: 1
    };

    function newId() {
        return 'id' + (state.nextId++);
    }

    /* =====================================================================
       3. REFERÊNCIAS DO DOM
       ===================================================================== */
    var stage = document.getElementById('stage');
    var canvas = document.getElementById('plant-canvas');
    var ctx = canvas.getContext('2d');
    var editorHint = document.getElementById('editor-hint');
    var toolbar = document.getElementById('toolbar');
    var contextBar = document.getElementById('context-bar');
    var contextBarLabel = document.getElementById('context-bar-label');
    var toast = document.getElementById('toast');

    var btnReport = document.getElementById('btn-report');
    var btnClear = document.getElementById('btn-clear');
    var btnCoverage = document.getElementById('btn-coverage');
    var btnWhatsapp = document.getElementById('btn-whatsapp');

    var reportModal = document.getElementById('report-modal');
    var reportOverlay = document.getElementById('report-overlay');
    var reportClose = document.getElementById('report-close');
    var reportGrid = document.getElementById('report-grid');
    var reportCritical = document.getElementById('report-critical');
    var reportSuggestions = document.getElementById('report-suggestions');
    var btnExportJson = document.getElementById('btn-export-json');
    var btnExportPng = document.getElementById('btn-export-png');

    /* =====================================================================
       4. GRADE / CONVERSÃO DE COORDENADAS (metros ↔ pixels)
       O grid tem zoom automático: recalcula quantos pixels equivalem a
       1 metro de acordo com o tamanho real da tela do aparelho.
       ===================================================================== */
    var view = { ppm: 20, originX: 0, originY: 0, dpr: 1 };

    function resizeCanvas() {
        var rect = stage.getBoundingClientRect();
        var dpr = window.devicePixelRatio || 1;

        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        var ppm = Math.min(rect.width / GRID_COLS, rect.height / GRID_ROWS);
        view.ppm = ppm;
        view.dpr = dpr;
        view.originX = (rect.width - GRID_COLS * ppm) / 2;
        view.originY = (rect.height - GRID_ROWS * ppm) / 2;
        view.cssWidth = rect.width;
        view.cssHeight = rect.height;

        render();
    }

    function worldToPixel(mx, my) {
        return { x: view.originX + mx * view.ppm, y: view.originY + my * view.ppm };
    }

    function pixelToWorld(px, py) {
        return { x: (px - view.originX) / view.ppm, y: (py - view.originY) / view.ppm };
    }

    function getPointerWorld(evt) {
        var rect = canvas.getBoundingClientRect();
        var px = evt.clientX - rect.left;
        var py = evt.clientY - rect.top;
        return pixelToWorld(px, py);
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function snap(value) {
        return Math.round(value);
    }

    /* =====================================================================
       5. GEOMETRIA — arestas dos cômodos (paredes automáticas)
       Cada cômodo tem 4 arestas. "t" é a posição normalizada (0 a 1) ao
       longo da aresta, na mesma direção usada tanto para posicionar
       portas/janelas quanto para checar cruzamento de sinal.
       ===================================================================== */
    function getRoomEdges(room) {
        return {
            top:    { x1: room.x,         y1: room.y,         x2: room.x + room.w, y2: room.y },
            right:  { x1: room.x + room.w, y1: room.y,         x2: room.x + room.w, y2: room.y + room.h },
            bottom: { x1: room.x,         y1: room.y + room.h, x2: room.x + room.w, y2: room.y + room.h },
            left:   { x1: room.x,         y1: room.y,         x2: room.x,         y2: room.y + room.h }
        };
    }

    function distancePointToSegment(px, py, x1, y1, x2, y2) {
        var dx = x2 - x1;
        var dy = y2 - y1;
        var lengthSq = dx * dx + dy * dy;
        var t = lengthSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lengthSq;
        t = clamp(t, 0, 1);
        var cx = x1 + t * dx;
        var cy = y1 + t * dy;
        var dist = Math.sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy));
        return { dist: dist, t: t };
    }

    // Interseção entre a linha de visada (sinal) e uma parede, retornando
    // também "s" (posição ao longo da parede) para cruzar com portas/janelas.
    function segmentIntersection(p1, p2, p3, p4) {
        var denom = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
        if (denom === 0) return null;

        var t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / denom;
        var s = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / denom;

        if (t < 0 || t > 1 || s < 0 || s > 1) return null;
        return { s: s };
    }

    // Encontra a aresta de cômodo mais próxima de um ponto — usado para
    // posicionar portas e janelas ao tocar perto de uma parede.
    function findNearestEdge(worldPoint) {
        var best = null;
        state.rooms.forEach(function (room) {
            var edges = getRoomEdges(room);
            Object.keys(edges).forEach(function (edgeName) {
                var e = edges[edgeName];
                var result = distancePointToSegment(worldPoint.x, worldPoint.y, e.x1, e.y1, e.x2, e.y2);
                if (!best || result.dist < best.dist) {
                    best = { dist: result.dist, t: result.t, roomId: room.id, edge: edgeName };
                }
            });
        });
        return best;
    }

    /* =====================================================================
       6. FÍSICA DE COBERTURA (sem IA — só regras)
       Reaproveita o mesmo princípio do simulador de planta fixa: queda de
       sinal pela distância + atenuação por parede cruzada. Aqui as
       paredes são derivadas automaticamente das arestas dos cômodos.
       ===================================================================== */
    function wallAttenuationBetween(from, to) {
        var totalWeight = 0;

        state.rooms.forEach(function (room) {
            var edges = getRoomEdges(room);
            Object.keys(edges).forEach(function (edgeName) {
                var e = edges[edgeName];
                var hit = segmentIntersection(from, to, { x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 });
                if (!hit) return;

                var weight = OPENING_WEIGHT.none;
                for (var i = 0; i < state.openings.length; i++) {
                    var op = state.openings[i];
                    if (op.roomId === room.id && op.edge === edgeName && Math.abs(op.t - hit.s) <= OPENING_TOLERANCE) {
                        weight = OPENING_WEIGHT[op.type];
                        break;
                    }
                }
                totalWeight += weight;
            });
        });

        // Cada parede cruzada é contada 2x (aresta de saída de um cômodo +
        // aresta de entrada do vizinho); dividir por 2 evita penalizar em dobro.
        return totalWeight / 2;
    }

    function signalFromDevice(point, device) {
        var profile = NETWORK_TYPES[device.kind];
        if (!profile) return 0;

        var dx = point.x - device.x;
        var dy = point.y - device.y;
        var distance = Math.sqrt(dx * dx + dy * dy);
        if (distance > profile.maxRange) return 0;

        var normalized = distance / profile.maxRange;
        var base = Math.max(0, 1 - Math.pow(normalized, 1.6)) * 100;

        var weight = wallAttenuationBetween(device, point);
        var strength = base - (weight * profile.wallLoss);

        return clamp(strength, 0, 100);
    }

    function getNetworkDevices() {
        return state.devices.filter(function (d) { return d.kind === 'router' || d.kind === 'ap'; });
    }

    function signalAtPoint(point, networkDevices) {
        var best = 0;
        for (var i = 0; i < networkDevices.length; i++) {
            var v = signalFromDevice(point, networkDevices[i]);
            if (v > best) best = v;
        }
        return best;
    }

    function colorForStrength(strength) {
        if (strength >= 75) return { rgb: '34, 197, 94', label: 'Excelente' };
        if (strength >= 50) return { rgb: '250, 204, 21', label: 'Bom' };
        if (strength >= 25) return { rgb: '251, 146, 60', label: 'Regular' };
        if (strength > 0) return { rgb: '239, 68, 68', label: 'Ruim' };
        return null;
    }

    /* =====================================================================
       7. DESENHO (tudo em 1 único canvas — inclusive o mapa de calor,
       para permitir exportação em PNG com um simples toDataURL)
       ===================================================================== */
    function render() {
        ctx.clearRect(0, 0, view.cssWidth, view.cssHeight);

        drawGrid();
        drawRooms();
        if (state.showCoverage) drawCoverage();
        drawWalls();
        drawOpenings();
        drawDevices();
        drawSelection();
    }

    function drawGrid() {
        ctx.save();
        ctx.strokeStyle = 'rgba(10, 25, 49, 0.06)';
        ctx.lineWidth = 1;
        for (var col = 0; col <= GRID_COLS; col++) {
            var x = worldToPixel(col, 0).x;
            ctx.beginPath();
            ctx.moveTo(x, view.originY);
            ctx.lineTo(x, view.originY + GRID_ROWS * view.ppm);
            ctx.stroke();
        }
        for (var row = 0; row <= GRID_ROWS; row++) {
            var y = worldToPixel(0, row).y;
            ctx.beginPath();
            ctx.moveTo(view.originX, y);
            ctx.lineTo(view.originX + GRID_COLS * view.ppm, y);
            ctx.stroke();
        }
        ctx.restore();
    }

    function drawRooms() {
        state.rooms.forEach(function (room) {
            var def = ROOM_TYPES[room.type];
            var topLeft = worldToPixel(room.x, room.y);
            var w = room.w * view.ppm;
            var h = room.h * view.ppm;

            ctx.fillStyle = def.color;
            ctx.fillRect(topLeft.x, topLeft.y, w, h);

            // Ícone + nome
            ctx.fillStyle = 'rgba(10, 25, 49, 0.75)';
            ctx.font = '600 12px Poppins, sans-serif';
            ctx.textBaseline = 'top';
            ctx.fillText(def.icon + ' ' + def.label, topLeft.x + 6, topLeft.y + 5);

            // Dimensões (largura x comprimento — área)
            var area = (room.w * room.h).toFixed(1).replace('.0', '');
            ctx.fillStyle = 'rgba(10, 25, 49, 0.5)';
            ctx.font = '500 10px Inter, sans-serif';
            ctx.fillText(room.w + ' x ' + room.h + 'm — ' + area + 'm²', topLeft.x + 6, topLeft.y + h - 16);
        });
    }

    function drawWalls() {
        ctx.save();
        ctx.strokeStyle = '#0A1931';
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        state.rooms.forEach(function (room) {
            var edges = getRoomEdges(room);
            Object.keys(edges).forEach(function (edgeName) {
                var e = edges[edgeName];
                var p1 = worldToPixel(e.x1, e.y1);
                var p2 = worldToPixel(e.x2, e.y2);
                ctx.beginPath();
                ctx.moveTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y);
                ctx.stroke();
            });
        });
        ctx.restore();
    }

    function drawOpenings() {
        state.openings.forEach(function (op) {
            var room = state.rooms.filter(function (r) { return r.id === op.roomId; })[0];
            if (!room) return;
            var edges = getRoomEdges(room);
            var e = edges[op.edge];
            if (!e) return;

            var span = op.type === 'door' ? 0.9 : 1.1; // metros
            var dx = e.x2 - e.x1;
            var dy = e.y2 - e.y1;
            var len = Math.sqrt(dx * dx + dy * dy) || 1;
            var half = (span / 2) / len;

            var t1 = clamp(op.t - half, 0, 1);
            var t2 = clamp(op.t + half, 0, 1);

            var p1 = worldToPixel(e.x1 + dx * t1, e.y1 + dy * t1);
            var p2 = worldToPixel(e.x1 + dx * t2, e.y1 + dy * t2);

            ctx.save();
            ctx.strokeStyle = op.type === 'door' ? '#FFFFFF' : '#BFE0FF';
            ctx.lineWidth = op.type === 'door' ? 6 : 5;
            ctx.lineCap = 'butt';
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();

            if (op.type === 'window') {
                ctx.strokeStyle = '#0B5FFF';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y);
                ctx.stroke();
            }
            ctx.restore();
        });
    }

    function drawCoverage() {
        var networkDevices = getNetworkDevices();
        if (networkDevices.length === 0) return;

        ctx.save();
        ctx.filter = 'blur(7px)';

        state.rooms.forEach(function (room) {
            var startX = Math.max(room.x, 0);
            var startY = Math.max(room.y, 0);
            var endX = room.x + room.w;
            var endY = room.y + room.h;

            for (var wy = startY; wy < endY; wy += COLOR_BLOCK / view.ppm) {
                for (var wx = startX; wx < endX; wx += COLOR_BLOCK / view.ppm) {
                    var point = { x: wx + (COLOR_BLOCK / view.ppm) / 2, y: wy + (COLOR_BLOCK / view.ppm) / 2 };
                    var strength = signalAtPoint(point, networkDevices);
                    var color = colorForStrength(strength);
                    if (!color) continue;

                    var alpha = 0.35 + (strength / 100) * 0.3;
                    var pixel = worldToPixel(wx, wy);
                    ctx.fillStyle = 'rgba(' + color.rgb + ', ' + alpha.toFixed(2) + ')';
                    ctx.fillRect(pixel.x, pixel.y, COLOR_BLOCK, COLOR_BLOCK);
                }
            }
        });

        ctx.restore();
    }

    function drawDevices() {
        state.devices.forEach(function (device) {
            var isNetwork = device.kind === 'router' || device.kind === 'ap';
            var def = isNetwork ? NETWORK_TYPES[device.kind] : DEVICE_TYPES[device.kind];
            var pixel = worldToPixel(device.x, device.y);
            var radius = isNetwork ? 16 : 13;

            ctx.save();
            ctx.beginPath();
            ctx.arc(pixel.x, pixel.y, radius, 0, Math.PI * 2);
            ctx.fillStyle = isNetwork ? '#0B5FFF' : '#0A1931';
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = '#FFFFFF';
            ctx.stroke();

            ctx.font = (isNetwork ? 16 : 13) + 'px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(def.icon, pixel.x, pixel.y + 1);
            ctx.restore();
            ctx.textAlign = 'start';
        });
    }

    function drawSelection() {
        if (!state.selection) return;

        if (state.selection.type === 'room') {
            var room = findRoomById(state.selection.id);
            if (!room) return;
            var topLeft = worldToPixel(room.x, room.y);
            var w = room.w * view.ppm;
            var h = room.h * view.ppm;

            ctx.save();
            ctx.strokeStyle = '#0B5FFF';
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 4]);
            ctx.strokeRect(topLeft.x, topLeft.y, w, h);
            ctx.setLineDash([]);

            // alça de redimensionar (canto inferior direito)
            var handle = getResizeHandlePixel(room);
            ctx.fillStyle = '#0B5FFF';
            ctx.beginPath();
            ctx.arc(handle.x, handle.y, 9, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#FFFFFF';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.restore();
        } else {
            var device = findDeviceById(state.selection.id);
            if (!device) return;
            var pixel = worldToPixel(device.x, device.y);
            ctx.save();
            ctx.strokeStyle = '#0B5FFF';
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            ctx.arc(pixel.x, pixel.y, 22, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();
        }
    }

    function getResizeHandlePixel(room) {
        return worldToPixel(room.x + room.w, room.y + room.h);
    }

    /* =====================================================================
       8. BUSCA DE ITENS
       ===================================================================== */
    function findRoomById(id) {
        return state.rooms.filter(function (r) { return r.id === id; })[0] || null;
    }

    function findDeviceById(id) {
        return state.devices.filter(function (d) { return d.id === id; })[0] || null;
    }

    function hitTestRoom(worldPoint) {
        for (var i = state.rooms.length - 1; i >= 0; i--) {
            var r = state.rooms[i];
            if (worldPoint.x >= r.x && worldPoint.x <= r.x + r.w && worldPoint.y >= r.y && worldPoint.y <= r.y + r.h) {
                return r;
            }
        }
        return null;
    }

    function hitTestDevice(worldPoint) {
        var tolerance = 26 / view.ppm; // ~26px de área de toque, convertida para metros
        for (var i = state.devices.length - 1; i >= 0; i--) {
            var d = state.devices[i];
            var dist = Math.sqrt(Math.pow(worldPoint.x - d.x, 2) + Math.pow(worldPoint.y - d.y, 2));
            if (dist <= tolerance) return d;
        }
        return null;
    }

    function hitTestResizeHandle(pixelPoint) {
        if (!state.selection || state.selection.type !== 'room') return false;
        var room = findRoomById(state.selection.id);
        if (!room) return false;
        var handle = getResizeHandlePixel(room);
        var dist = Math.sqrt(Math.pow(pixelPoint.x - handle.x, 2) + Math.pow(pixelPoint.y - handle.y, 2));
        return dist <= 22; // área de toque generosa para o dedo
    }

    /* =====================================================================
       9. FERRAMENTAS — adicionar cômodo / dispositivo / porta / janela
       ===================================================================== */
    function placeRoom(roomType, worldPoint) {
        var def = ROOM_TYPES[roomType];
        var x = clamp(snap(worldPoint.x - def.w / 2), 0, GRID_COLS - def.w);
        var y = clamp(snap(worldPoint.y - def.h / 2), 0, GRID_ROWS - def.h);

        var room = { id: newId(), type: roomType, x: x, y: y, w: def.w, h: def.h };
        state.rooms.push(room);
        state.selection = { type: 'room', id: room.id };
        showToast(def.icon + ' ' + def.label + ' adicionado — arraste para posicionar');
    }

    function placeDevice(kind, worldPoint) {
        var x = clamp(worldPoint.x, 0, GRID_COLS);
        var y = clamp(worldPoint.y, 0, GRID_ROWS);
        var device = { id: newId(), kind: kind, x: x, y: y };
        state.devices.push(device);
        state.selection = { type: 'device', id: device.id };

        var def = kind === 'router' || kind === 'ap' ? NETWORK_TYPES[kind] : DEVICE_TYPES[kind];
        showToast(def.icon + ' ' + def.label + ' posicionado');
    }

    function placeOpening(type, worldPoint) {
        var nearest = findNearestEdge(worldPoint);
        if (!nearest || nearest.dist > PLACEMENT_TOLERANCE) {
            showToast('Toque mais perto de uma parede para adicionar ' + (type === 'door' ? 'a porta' : 'a janela'));
            return;
        }
        state.openings.push({ id: newId(), roomId: nearest.roomId, edge: nearest.edge, t: nearest.t, type: type });
        showToast((type === 'door' ? '🚪 Porta' : '🪟 Janela') + ' adicionada');
    }

    /* =====================================================================
       10. AÇÕES SOBRE O ITEM SELECIONADO
       ===================================================================== */
    function rotateSelection() {
        if (!state.selection || state.selection.type !== 'room') return;
        var room = findRoomById(state.selection.id);
        if (!room) return;
        var w = room.w;
        room.w = room.h;
        room.h = w;
        room.x = clamp(room.x, 0, GRID_COLS - room.w);
        room.y = clamp(room.y, 0, GRID_ROWS - room.h);
        save();
        render();
    }

    function duplicateSelection() {
        if (!state.selection) return;

        if (state.selection.type === 'room') {
            var room = findRoomById(state.selection.id);
            if (!room) return;
            var copy = {
                id: newId(), type: room.type,
                x: clamp(room.x + 1, 0, GRID_COLS - room.w),
                y: clamp(room.y + 1, 0, GRID_ROWS - room.h),
                w: room.w, h: room.h
            };
            state.rooms.push(copy);
            state.selection = { type: 'room', id: copy.id };
        } else {
            var device = findDeviceById(state.selection.id);
            if (!device) return;
            var deviceCopy = { id: newId(), kind: device.kind, x: clamp(device.x + 1, 0, GRID_COLS), y: clamp(device.y + 1, 0, GRID_ROWS) };
            state.devices.push(deviceCopy);
            state.selection = { type: 'device', id: deviceCopy.id };
        }
        save();
        render();
        updateContextBar();
    }

    function deleteSelection() {
        if (!state.selection) return;

        if (state.selection.type === 'room') {
            state.rooms = state.rooms.filter(function (r) { return r.id !== state.selection.id; });
            state.openings = state.openings.filter(function (o) { return o.roomId !== state.selection.id; });
        } else {
            state.devices = state.devices.filter(function (d) { return d.id !== state.selection.id; });
        }
        state.selection = null;
        save();
        render();
        updateContextBar();
    }

    /* =====================================================================
       11. INTERAÇÃO POR TOQUE (Pointer Events — funciona com dedo e mouse,
       sem depender de nenhuma biblioteca de arrastar/redimensionar)
       ===================================================================== */
    var drag = null; // { mode: 'move-room'|'resize-room'|'move-device', id, startWorld, startRoom }

    canvas.addEventListener('pointerdown', function (evt) {
        var worldPoint = getPointerWorld(evt);
        var rect = canvas.getBoundingClientRect();
        var pixelPoint = { x: evt.clientX - rect.left, y: evt.clientY - rect.top };

        // Ferramenta ativa: o próximo toque na planta posiciona o item
        if (state.activeTool) {
            var tool = state.activeTool;
            if (tool.tool === 'room') placeRoom(tool.roomType, worldPoint);
            else if (tool.tool === 'device') placeDevice(tool.deviceType, worldPoint);
            else if (tool.tool === 'network') placeDevice(tool.networkType, worldPoint);
            else if (tool.tool === 'door') placeOpening('door', worldPoint);
            else if (tool.tool === 'window') placeOpening('window', worldPoint);

            clearActiveTool();
            save();
            render();
            updateContextBar();
            return;
        }

        // Alça de redimensionar do item selecionado
        if (hitTestResizeHandle(pixelPoint)) {
            var roomToResize = findRoomById(state.selection.id);
            drag = { mode: 'resize-room', id: roomToResize.id, startRoom: { x: roomToResize.x, y: roomToResize.y, w: roomToResize.w, h: roomToResize.h }, startWorld: worldPoint };
            canvas.setPointerCapture(evt.pointerId);
            return;
        }

        // Seleção / início de arraste
        var hitRoom = hitTestRoom(worldPoint);
        var hitDevice = hitTestDevice(worldPoint);

        if (hitDevice) {
            state.selection = { type: 'device', id: hitDevice.id };
            drag = { mode: 'move-device', id: hitDevice.id, startWorld: worldPoint, startPos: { x: hitDevice.x, y: hitDevice.y } };
            canvas.setPointerCapture(evt.pointerId);
        } else if (hitRoom) {
            state.selection = { type: 'room', id: hitRoom.id };
            drag = { mode: 'move-room', id: hitRoom.id, startWorld: worldPoint, startPos: { x: hitRoom.x, y: hitRoom.y } };
            canvas.setPointerCapture(evt.pointerId);
        } else {
            state.selection = null;
        }

        render();
        updateContextBar();
    });

    canvas.addEventListener('pointermove', function (evt) {
        if (!drag) return;
        var worldPoint = getPointerWorld(evt);
        var dx = worldPoint.x - drag.startWorld.x;
        var dy = worldPoint.y - drag.startWorld.y;

        if (drag.mode === 'move-room') {
            var room = findRoomById(drag.id);
            if (!room) return;
            room.x = clamp(drag.startPos.x + dx, 0, GRID_COLS - room.w);
            room.y = clamp(drag.startPos.y + dy, 0, GRID_ROWS - room.h);
        } else if (drag.mode === 'resize-room') {
            var target = findRoomById(drag.id);
            if (!target) return;
            target.w = clamp(drag.startRoom.w + dx, 1, GRID_COLS - target.x);
            target.h = clamp(drag.startRoom.h + dy, 1, GRID_ROWS - target.y);
        } else if (drag.mode === 'move-device') {
            var device = findDeviceById(drag.id);
            if (!device) return;
            device.x = clamp(drag.startPos.x + dx, 0, GRID_COLS);
            device.y = clamp(drag.startPos.y + dy, 0, GRID_ROWS);
        }

        render();
    });

    function endDrag() {
        if (!drag) return;

        // Encaixa (snap) no grid ao soltar, conforme pedido — nenhum
        // cômodo fica desalinhado da grade de 1x1m.
        if (drag.mode === 'move-room' || drag.mode === 'resize-room') {
            var room = findRoomById(drag.id);
            if (room) {
                room.x = clamp(snap(room.x), 0, GRID_COLS - room.w);
                room.y = clamp(snap(room.y), 0, GRID_ROWS - room.h);
                room.w = clamp(snap(room.w), 1, GRID_COLS - room.x);
                room.h = clamp(snap(room.h), 1, GRID_ROWS - room.y);
            }
        } else if (drag.mode === 'move-device') {
            var device = findDeviceById(drag.id);
            if (device) {
                device.x = clamp(snap(device.x), 0, GRID_COLS);
                device.y = clamp(snap(device.y), 0, GRID_ROWS);
            }
        }

        drag = null;
        save();
        render();
    }

    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    /* =====================================================================
       12. BARRA DE FERRAMENTAS E BARRA CONTEXTUAL
       ===================================================================== */
    function clearActiveTool() {
        state.activeTool = null;
        toolbar.querySelectorAll('.tool.is-active').forEach(function (el) {
            el.classList.remove('is-active');
        });
        editorHint.textContent = 'Toque em um ambiente na barra abaixo para começar a montar sua planta.';
    }

    toolbar.addEventListener('click', function (evt) {
        var button = evt.target.closest('.tool');
        if (!button) return;

        var tool = button.dataset.tool;
        var wasActive = button.classList.contains('is-active');

        toolbar.querySelectorAll('.tool.is-active').forEach(function (el) { el.classList.remove('is-active'); });

        if (wasActive) {
            clearActiveTool();
            return;
        }

        button.classList.add('is-active');

        if (tool === 'room') {
            state.activeTool = { tool: 'room', roomType: button.dataset.roomType };
            editorHint.textContent = 'Toque na planta para posicionar o cômodo.';
        } else if (tool === 'device') {
            state.activeTool = { tool: 'device', deviceType: button.dataset.deviceType };
            editorHint.textContent = 'Toque na planta para posicionar o dispositivo.';
        } else if (tool === 'network') {
            state.activeTool = { tool: 'network', networkType: button.dataset.networkType };
            editorHint.textContent = 'Toque na planta para posicionar o equipamento de rede.';
        } else if (tool === 'door') {
            state.activeTool = { tool: 'door' };
            editorHint.textContent = 'Toque perto de uma parede para adicionar a porta.';
        } else if (tool === 'window') {
            state.activeTool = { tool: 'window' };
            editorHint.textContent = 'Toque perto de uma parede para adicionar a janela.';
        }

        state.selection = null;
        updateContextBar();
        render();
    });

    function updateContextBar() {
        if (!state.selection) {
            contextBar.hidden = true;
            return;
        }
        contextBar.hidden = false;

        if (state.selection.type === 'room') {
            var room = findRoomById(state.selection.id);
            contextBarLabel.textContent = room ? ROOM_TYPES[room.type].icon + ' ' + ROOM_TYPES[room.type].label : '';
        } else {
            var device = findDeviceById(state.selection.id);
            if (device) {
                var isNetwork = device.kind === 'router' || device.kind === 'ap';
                var def = isNetwork ? NETWORK_TYPES[device.kind] : DEVICE_TYPES[device.kind];
                contextBarLabel.textContent = def.icon + ' ' + def.label;
            }
        }
    }

    contextBar.addEventListener('click', function (evt) {
        var button = evt.target.closest('button[data-action]');
        if (!button) return;
        var action = button.dataset.action;

        if (action === 'rotate') rotateSelection();
        else if (action === 'duplicate') duplicateSelection();
        else if (action === 'delete') deleteSelection();
        else if (action === 'deselect') { state.selection = null; render(); updateContextBar(); }
    });

    /* =====================================================================
       13. TOAST (feedback rápido, sem travar a interação)
       ===================================================================== */
    var toastTimer = null;
    function showToast(message) {
        toast.textContent = message;
        toast.hidden = false;
        requestAnimationFrame(function () { toast.classList.add('is-visible'); });
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () {
            toast.classList.remove('is-visible');
            setTimeout(function () { toast.hidden = true; }, 250);
        }, 1800);
    }

    /* =====================================================================
       14. RELATÓRIO E SUGESTÕES (regras simples, sem IA)
       ===================================================================== */
    function buildReport() {
        var totalArea = state.rooms.reduce(function (sum, r) { return sum + r.w * r.h; }, 0);
        var wallCount = state.rooms.reduce(function (sum, r) { return sum + 4; }, 0);
        var devicesOnly = state.devices.filter(function (d) { return d.kind !== 'router' && d.kind !== 'ap'; });
        var routers = state.devices.filter(function (d) { return d.kind === 'router'; });
        var aps = state.devices.filter(function (d) { return d.kind === 'ap'; });
        var networkDevices = getNetworkDevices();

        var coveredArea = 0;
        var sampledArea = 0;
        var criticalRooms = [];

        state.rooms.forEach(function (room) {
            var samples = 0;
            var weakSamples = 0;
            var step = 0.5;
            for (var wy = room.y; wy < room.y + room.h; wy += step) {
                for (var wx = room.x; wx < room.x + room.w; wx += step) {
                    var point = { x: wx + step / 2, y: wy + step / 2 };
                    var strength = networkDevices.length ? signalAtPoint(point, networkDevices) : 0;
                    samples++;
                    sampledArea += step * step;
                    if (strength >= 50) coveredArea += step * step;
                    if (strength < 25) weakSamples++;
                }
            }
            if (samples > 0 && weakSamples / samples > 0.5) {
                criticalRooms.push(ROOM_TYPES[room.type].label);
            }
        });

        var coveragePercent = sampledArea > 0 ? Math.round((coveredArea / sampledArea) * 100) : 0;

        var suggestions = [];
        if (networkDevices.length === 0) {
            suggestions.push('Posicione ao menos um Roteador para calcular a cobertura.');
        } else {
            if (criticalRooms.length > 0) {
                suggestions.push('Considere adicionar um Access Point próximo de: ' + criticalRooms.join(', ') + '.');
            }
            if (routers.length > 0 && state.rooms.length > 0) {
                var router = routers[0];
                var centerX = state.rooms.reduce(function (s, r) { return s + (r.x + r.w / 2); }, 0) / state.rooms.length;
                var centerY = state.rooms.reduce(function (s, r) { return s + (r.y + r.h / 2); }, 0) / state.rooms.length;
                var distFromCenter = Math.sqrt(Math.pow(router.x - centerX, 2) + Math.pow(router.y - centerY, 2));
                if (distFromCenter > 4) {
                    suggestions.push('O Roteador está bem distante do centro da casa — mover para uma posição mais central tende a melhorar a cobertura geral.');
                }
            }
            if (coveragePercent >= 85) {
                suggestions.push('Cobertura já está muito boa — nenhuma mudança necessária.');
            }
        }
        if (suggestions.length === 0) {
            suggestions.push('Adicione cômodos e ao menos um Roteador para receber recomendações.');
        }

        return {
            totalArea: totalArea,
            roomCount: state.rooms.length,
            wallCount: wallCount,
            deviceCount: devicesOnly.length,
            apCount: aps.length,
            routerCount: routers.length,
            coveragePercent: coveragePercent,
            criticalRooms: criticalRooms,
            suggestions: suggestions
        };
    }

    function renderReport() {
        var data = buildReport();

        reportGrid.innerHTML =
            statCard(data.totalArea.toFixed(0) + 'm²', 'Área total') +
            statCard(data.roomCount, 'Cômodos') +
            statCard(data.wallCount, 'Paredes') +
            statCard(data.deviceCount, 'Dispositivos') +
            statCard(data.routerCount + data.apCount, 'Roteador/APs') +
            statCard(data.coveragePercent + '%', 'Cobertura estimada');

        if (data.criticalRooms.length > 0) {
            reportCritical.innerHTML = '<h3>⚠️ Pontos críticos</h3><ul><li>' + data.criticalRooms.join('</li><li>') + '</li></ul>';
        } else {
            reportCritical.innerHTML = '';
        }

        reportSuggestions.innerHTML = '<h3>💡 Sugestões</h3><ul><li>' + data.suggestions.join('</li><li>') + '</li></ul>';
    }

    function statCard(value, label) {
        return '<div class="report-stat"><div class="report-stat__value">' + value + '</div><div class="report-stat__label">' + label + '</div></div>';
    }

    /* =====================================================================
       15. LOCALSTORAGE — salvar e restaurar automaticamente
       ===================================================================== */
    var saveTimer = null;
    function save() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(function () {
            var payload = { rooms: state.rooms, openings: state.openings, devices: state.devices, nextId: state.nextId };
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
            } catch (e) {
                // localStorage indisponível (modo privado, por exemplo) — segue sem salvar
            }
        }, 400);
    }

    function load() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            var data = JSON.parse(raw);
            state.rooms = data.rooms || [];
            state.openings = data.openings || [];
            state.devices = data.devices || [];
            state.nextId = data.nextId || 1;
        } catch (e) {
            // dado corrompido — começa do zero
        }
    }

    /* =====================================================================
       16. EXPORTAÇÃO (JSON e PNG) E WHATSAPP
       ===================================================================== */
    function downloadFile(filename, blob) {
        var url = URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }

    function exportJson() {
        var payload = { rooms: state.rooms, openings: state.openings, devices: state.devices };
        var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        downloadFile('minha-planta.json', blob);
        showToast('JSON exportado');
    }

    function exportPng(callback) {
        var wasShowingCoverage = state.showCoverage;
        state.showCoverage = true;
        render();
        canvas.toBlob(function (blob) {
            if (callback) {
                callback(blob);
            } else {
                downloadFile('minha-planta.png', blob);
                showToast('Imagem exportada');
            }
            state.showCoverage = wasShowingCoverage;
            render();
        }, 'image/png');
    }

    function sendToWhatsapp() {
        var data = buildReport();
        var lines = [
            'Olá! Fiz a planta da minha casa no simulador da Point WiFi e gostaria de um orçamento.',
            '',
            'Área total: ' + data.totalArea.toFixed(0) + 'm²',
            'Cômodos: ' + data.roomCount,
            'Dispositivos: ' + data.deviceCount,
            'Cobertura estimada: ' + data.coveragePercent + '%'
        ];
        if (data.criticalRooms.length > 0) {
            lines.push('Pontos com sinal fraco: ' + data.criticalRooms.join(', '));
        }
        lines.push('', 'Vou anexar a imagem da planta em seguida.');

        var message = encodeURIComponent(lines.join('\n'));

        // Como o link do WhatsApp não permite anexar imagem automaticamente,
        // baixamos o PNG primeiro para o cliente anexar manualmente na conversa.
        exportPng(function (blob) {
            downloadFile('minha-planta.png', blob);
            showToast('Imagem baixada — anexe no WhatsApp que vai abrir');
            setTimeout(function () {
                window.open('https://wa.me/5591986456795?text=' + message, '_blank', 'noopener');
            }, 600);
        });
    }

    /* =====================================================================
       17. MODAL DE RELATÓRIO
       ===================================================================== */
    function openReportModal() {
        renderReport();
        reportModal.hidden = false;
    }

    function closeReportModal() {
        reportModal.hidden = true;
    }

    btnReport.addEventListener('click', openReportModal);
    reportClose.addEventListener('click', closeReportModal);
    reportOverlay.addEventListener('click', closeReportModal);
    document.addEventListener('keydown', function (evt) {
        if (evt.key === 'Escape' && !reportModal.hidden) closeReportModal();
    });

    btnExportJson.addEventListener('click', exportJson);
    btnExportPng.addEventListener('click', function () { exportPng(); });

    /* =====================================================================
       18. AÇÕES PRINCIPAIS
       ===================================================================== */
    btnCoverage.addEventListener('click', function () {
        if (getNetworkDevices().length === 0) {
            showToast('Posicione um Roteador ou Access Point primeiro');
            return;
        }
        state.showCoverage = !state.showCoverage;
        btnCoverage.textContent = state.showCoverage ? '🙈 Ocultar cobertura' : '📡 Ver cobertura';
        render();
    });

    btnWhatsapp.addEventListener('click', sendToWhatsapp);

    btnClear.addEventListener('click', function () {
        if (state.rooms.length === 0 && state.devices.length === 0) return;
        var confirmClear = window.confirm('Isso vai apagar toda a sua planta. Deseja continuar?');
        if (!confirmClear) return;
        state.rooms = [];
        state.openings = [];
        state.devices = [];
        state.selection = null;
        state.showCoverage = false;
        btnCoverage.textContent = '📡 Ver cobertura';
        save();
        render();
        updateContextBar();
        showToast('Planta limpa');
    });

    /* =====================================================================
       19. INICIALIZAÇÃO
       ===================================================================== */
    function init() {
        load();
        resizeCanvas();
        updateContextBar();

        if (state.rooms.length > 0) {
            editorHint.textContent = 'Sua planta salva foi restaurada automaticamente.';
        }
    }

    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('orientationchange', resizeCanvas);

    init();

})();
