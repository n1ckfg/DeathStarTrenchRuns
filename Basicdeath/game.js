// Death Star Trench Run - WebGL Port of TI-83+ BASIC Game
const canvas = document.getElementById('glcanvas');
const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
const ui = document.getElementById('ui');
const messageEl = document.getElementById('message');

let width = 0, height = 0;
function resize() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
    gl.viewport(0, 0, width, height);
}
window.addEventListener('resize', resize);
resize();

// Shaders
const vsSource = `#version 300 es
precision highp float;
in vec2 a_pos;
in vec4 a_color;
out vec4 v_color;
uniform mat3 u_transform;
void main() {
    vec3 pos = u_transform * vec3(a_pos, 1.0);
    gl_Position = vec4(pos.xy, 0.0, 1.0);
    v_color = a_color;
    gl_PointSize = pos.z * 2.0 + 1.0;
}
`;

const fsSource = `#version 300 es
precision highp float;
in vec4 v_color;
out vec4 outColor;
void main() {
    outColor = v_color;
}
`;

function compileShader(src, type) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader));
    }
    return shader;
}

function createProgram(vs, fs) {
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program));
    }
    return program;
}

const vs = compileShader(vsSource, gl.VERTEX_SHADER);
const fs = compileShader(fsSource, gl.FRAGMENT_SHADER);
const program = createProgram(vs, fs);

const a_pos = gl.getAttribLocation(program, 'a_pos');
const a_color = gl.getAttribLocation(program, 'a_color');
const u_transform = gl.getUniformLocation(program, 'u_transform');

const vao = gl.createVertexArray();
gl.bindVertexArray(vao);

const vbo = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
gl.enableVertexAttribArray(a_pos);
gl.vertexAttribPointer(a_pos, 2, gl.FLOAT, false, 24, 0);
gl.enableVertexAttribArray(a_color);
gl.vertexAttribPointer(a_color, 4, gl.FLOAT, false, 24, 8);

gl.bindVertexArray(null);

// Game state
const GAME = {
    PLAYING: 0,
    HAN_SOLO: 1,
    VICTORY: 2,
    DEFEAT: 3
};

let state = GAME.PLAYING;
let frame = 0;

// World coordinates: -1 to 1 in both axes
// Player (X-wing)
const player = {
    x: 0, y: -0.7,
    vx: 0, vy: 0,
    speed: 0.012,
    shield: 100,
    maxShield: 100,
    torpedoes: 6,
    fireCooldown: 0,
    torpedoCooldown: 0,
    invuln: 0
};

// Lasers (player shots)
const lasers = [];
const MAX_LASERS = 10;

// Enemy lasers
const enemyLasers = [];
const MAX_ENEMY_LASERS = 20;

// Enemies: TIE fighters and Turrets
const enemies = [];

// Particles
const particles = [];

// Stars background
const stars = [];
for (let i = 0; i < 200; i++) {
    stars.push({
        x: Math.random() * 2 - 1,
        y: Math.random() * 2 - 1,
        speed: 0.0005 + Math.random() * 0.002,
        size: Math.random() * 1.5 + 0.5,
        brightness: 0.5 + Math.random() * 0.5
    });
}

// Trench walls
const trench = {
    left: -0.5,
    right: 0.5,
    segments: []
};
for (let i = 0; i < 50; i++) {
    trench.segments.push({
        y: -1 + i * 0.04,
        leftX: -0.5 + Math.sin(i * 0.3) * 0.05,
        rightX: 0.5 + Math.cos(i * 0.3) * 0.05
    });
}

// Exhaust port
const exhaustPort = {
    x: 0,
    y: 0.9,
    radius: 0.03,
    active: false,
    hit: false
};

// Han Solo message
let hanSoloTimer = 0;
let hanSoloShown = false;

// Input
const keys = { left: false, right: false, up: false, down: false, fire: false, torpedo: false };
window.addEventListener('keydown', e => {
    if (e.code === 'ArrowLeft') keys.left = true;
    if (e.code === 'ArrowRight') keys.right = true;
    if (e.code === 'ArrowUp') keys.up = true;
    if (e.code === 'ArrowDown') keys.down = true;
    if (e.code === 'Space') { keys.fire = true; e.preventDefault(); }
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys.torpedo = true;
});
window.addEventListener('keyup', e => {
    if (e.code === 'ArrowLeft') keys.left = false;
    if (e.code === 'ArrowRight') keys.right = false;
    if (e.code === 'ArrowUp') keys.up = false;
    if (e.code === 'ArrowDown') keys.down = false;
    if (e.code === 'Space') keys.fire = false;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys.torpedo = false;
});

// Utility
function rand(min, max) { return Math.random() * (max - min) + min; }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }

// Transform matrix for world to clip space
function getTransform() {
    // World is -1 to 1, same as clip space
    return new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
}

// Drawing primitives
function drawRect(x, y, w, h, color) {
    const hw = w * 0.5, hh = h * 0.5;
    const verts = new Float32Array([
        x - hw, y - hh, color[0], color[1], color[2], color[3],
        x + hw, y - hh, color[0], color[1], color[2], color[3],
        x + hw, y + hh, color[0], color[1], color[2], color[3],
        x - hw, y - hh, color[0], color[1], color[2], color[3],
        x + hw, y + hh, color[0], color[1], color[2], color[3],
        x - hw, y + hh, color[0], color[1], color[2], color[3]
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STREAM_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
}

function drawTri(x1, y1, x2, y2, x3, y3, color) {
    const verts = new Float32Array([
        x1, y1, color[0], color[1], color[2], color[3],
        x2, y2, color[0], color[1], color[2], color[3],
        x3, y3, color[0], color[1], color[2], color[3]
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STREAM_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function drawLine(x1, y1, x2, y2, color, width = 1) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len === 0) return;
    const nx = -dy / len * width * 0.5;
    const ny = dx / len * width * 0.5;
    const verts = new Float32Array([
        x1 + nx, y1 + ny, color[0], color[1], color[2], color[3],
        x2 + nx, y2 + ny, color[0], color[1], color[2], color[3],
        x2 - nx, y2 - ny, color[0], color[1], color[2], color[3],
        x1 + nx, y1 + ny, color[0], color[1], color[2], color[3],
        x2 - nx, y2 - ny, color[0], color[1], color[2], color[3],
        x1 - nx, y1 - ny, color[0], color[1], color[2], color[3]
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STREAM_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
}

function drawCircle(x, y, r, color, segments = 12) {
    const verts = [];
    for (let i = 0; i < segments; i++) {
        const a1 = (i / segments) * Math.PI * 2;
        const a2 = ((i + 1) / segments) * Math.PI * 2;
        verts.push(x, y, color[0], color[1], color[2], color[3]);
        verts.push(x + Math.cos(a1) * r, y + Math.sin(a1) * r, color[0], color[1], color[2], color[3]);
        verts.push(x + Math.cos(a2) * r, y + Math.sin(a2) * r, color[0], color[1], color[2], color[3]);
    }
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STREAM_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, verts.length / 6);
}

function drawPoint(x, y, color, size = 2) {
    const verts = new Float32Array([
        x, y, color[0], color[1], color[2], color[3]
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STREAM_DRAW);
    gl.drawArrays(gl.POINTS, 0, 1);
}

// Game logic
function spawnEnemy() {
    if (Math.random() < 0.02) {
        // TIE Fighter
        enemies.push({
            type: 'tie',
            x: rand(-0.4, 0.4),
            y: 1.1,
            vx: rand(-0.002, 0.002),
            vy: -rand(0.003, 0.006),
            hp: 1,
            fireTimer: rand(60, 180),
            wobble: rand(0, Math.PI * 2)
        });
    }
    if (Math.random() < 0.008) {
        // Turret
        const side = Math.random() < 0.5 ? -1 : 1;
        enemies.push({
            type: 'turret',
            x: side * (0.5 + rand(0.05, 0.15)),
            y: rand(-0.5, 0.8),
            vx: 0,
            vy: 0,
            hp: 3,
            fireTimer: rand(90, 200),
            lockedOn: false,
            lockTimer: 0
        });
    }
}

function updatePlayer(dt) {
    // Movement
    if (keys.left) player.vx -= player.speed * dt;
    if (keys.right) player.vx += player.speed * dt;
    if (keys.up) player.vy += player.speed * dt;
    if (keys.down) player.vy -= player.speed * dt;

    // Dampening
    player.vx *= 0.92;
    player.vy *= 0.92;

    // Apply velocity
    player.x += player.vx * dt;
    player.y += player.vy * dt;

    // Clamp to trench
    const margin = 0.05;
    player.x = clamp(player.x, trench.left + margin, trench.right - margin);
    player.y = clamp(player.y, -0.9, 0.9);

    // Fire lasers
    if (player.fireCooldown > 0) player.fireCooldown--;
    if (keys.fire && player.fireCooldown <= 0) {
        lasers.push({ x: player.x - 0.04, y: player.y + 0.05, vy: 0.03, life: 60 });
        lasers.push({ x: player.x + 0.04, y: player.y + 0.05, vy: 0.03, life: 60 });
        player.fireCooldown = 8;
        // Sound effect would go here
    }

    // Fire torpedo
    if (player.torpedoCooldown > 0) player.torpedoCooldown--;
    if (keys.torpedo && player.torpedoCooldown <= 0 && player.torpedoes > 0) {
        // Find nearest enemy
        let target = null, bestDist = 999;
        for (const e of enemies) {
            const d = dist(player.x, player.y, e.x, e.y);
            if (d < bestDist) { bestDist = d; target = e; }
        }
        lasers.push({
            x: player.x, y: player.y + 0.05,
            vx: 0, vy: 0,
            life: 120,
            torpedo: true,
            target: target,
            turnRate: 0.05
        });
        player.torpedoes--;
        player.torpedoCooldown = 30;
    }

    if (player.invuln > 0) player.invuln--;
}

function updateLasers(dt) {
    // Player lasers
    for (let i = lasers.length - 1; i >= 0; i--) {
        const l = lasers[i];
        if (l.torpedo && l.target && enemies.includes(l.target)) {
            // Homing
            const dx = l.target.x - l.x;
            const dy = l.target.y - l.y;
            const angle = Math.atan2(dy, dx);
            l.vx += Math.cos(angle) * l.turnRate * dt;
            l.vy += Math.sin(angle) * l.turnRate * dt;
            const speed = Math.hypot(l.vx, l.vy);
            if (speed > 0.02) {
                l.vx = l.vx / speed * 0.02;
                l.vy = l.vy / speed * 0.02;
            }
        }
        l.x += l.vx * dt;
        l.y += l.vy * dt;
        l.life--;
        if (l.life <= 0 || l.y > 1.1 || l.y < -1.1 || l.x < -1.1 || l.x > 1.1) {
            lasers.splice(i, 1);
        }
    }

    // Enemy lasers
    for (let i = enemyLasers.length - 1; i >= 0; i--) {
        const l = enemyLasers[i];
        l.x += l.vx * dt;
        l.y += l.vy * dt;
        l.life--;
        if (l.life <= 0 || l.y > 1.1 || l.y < -1.1) {
            enemyLasers.splice(i, 1);
        }
    }
}

function updateEnemies(dt) {
    for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        if (e.type === 'tie') {
            e.x += e.vx * dt;
            e.y += e.vy * dt;
            e.wobble += 0.05 * dt;
            e.x += Math.sin(e.wobble) * 0.001 * dt;

            // Fire at player
            e.fireTimer--;
            if (e.fireTimer <= 0) {
                const dx = player.x - e.x;
                const dy = player.y - e.y;
                const d = Math.hypot(dx, dy);
                if (d < 1.5) {
                    enemyLasers.push({
                        x: e.x, y: e.y - 0.03,
                        vx: dx / d * 0.015,
                        vy: dy / d * 0.015,
                        life: 120
                    });
                }
                e.fireTimer = rand(120, 240);
            }

            // Remove if off screen
            if (e.y < -1.2) enemies.splice(i, 1);
        } else if (e.type === 'turret') {
            // Turret aims at player
            const dx = player.x - e.x;
            const dy = player.y - e.y;
            const d = Math.hypot(dx, dy);

            e.fireTimer--;
            if (e.fireTimer <= 0 && d < 1.2) {
                // Lock on
                enemyLasers.push({
                    x: e.x, y: e.y,
                    vx: dx / d * 0.018,
                    vy: dy / d * 0.018,
                    life: 100,
                    color: [1, 0.3, 0, 1]
                });
                e.fireTimer = rand(150, 300);
            }

            // Remove if off screen
            if (e.y < -1.2) enemies.splice(i, 1);
        }
    }
}

function checkCollisions() {
    // Player lasers vs enemies
    for (let li = lasers.length - 1; li >= 0; li--) {
        const l = lasers[li];
        for (let ei = enemies.length - 1; ei >= 0; ei--) {
            const e = enemies[ei];
            const d = dist(l.x, l.y, e.x, e.y);
            const hitRadius = e.type === 'tie' ? 0.04 : 0.035;
            if (d < hitRadius) {
                e.hp--;
                if (!l.torpedo) lasers.splice(li, 1);
                // Hit particles
                for (let p = 0; p < 8; p++) {
                    particles.push({
                        x: e.x, y: e.y,
                        vx: rand(-0.01, 0.01), vy: rand(-0.01, 0.01),
                        life: 20, color: [1, 0.5, 0, 1]
                    });
                }
                if (e.hp <= 0) {
                    // Explosion
                    for (let p = 0; p < 20; p++) {
                        particles.push({
                            x: e.x, y: e.y,
                            vx: rand(-0.02, 0.02), vy: rand(-0.02, 0.02),
                            life: 40, color: [1, rand(0.3, 0.8), 0, 1]
                        });
                    }
                    enemies.splice(ei, 1);
                }
                break;
            }
        }
        // Torpedo vs exhaust port
        if (l.torpedo && exhaustPort.active && !exhaustPort.hit) {
            const d = dist(l.x, l.y, exhaustPort.x, exhaustPort.y);
            if (d < exhaustPort.radius + 0.02) {
                exhaustPort.hit = true;
                state = GAME.VICTORY;
            }
        }
    }

    // Enemy lasers vs player
    if (player.invuln <= 0) {
        for (let i = enemyLasers.length - 1; i >= 0; i--) {
            const l = enemyLasers[i];
            const d = dist(l.x, l.y, player.x, player.y);
            if (d < 0.04) {
                player.shield -= 10;
                player.invuln = 30;
                enemyLasers.splice(i, 1);
                // Hit particles
                for (let p = 0; p < 10; p++) {
                    particles.push({
                        x: player.x, y: player.y,
                        vx: rand(-0.01, 0.01), vy: rand(-0.01, 0.01),
                        life: 20, color: [0, 1, 1, 1]
                    });
                }
                if (player.shield <= 0) {
                    state = GAME.DEFEAT;
                }
            }
        }
    }

    // Player vs enemies (collision damage)
    if (player.invuln <= 0) {
        for (const e of enemies) {
            const d = dist(player.x, player.y, e.x, e.y);
            if (d < 0.06) {
                player.shield -= 5;
                player.invuln = 40;
                if (player.shield <= 0) state = GAME.DEFEAT;
            }
        }
    }
}

function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life--;
        if (p.life <= 0) particles.splice(i, 1);
    }
}

function updateStars(dt) {
    for (const s of stars) {
        s.y -= s.speed * dt;
        if (s.y < -1.1) {
            s.y = 1.1;
            s.x = rand(-1, 1);
        }
    }
}

function checkHanSolo() {
    const enemyCount = enemies.filter(e => e.type === 'turret').length;
    if (!hanSoloShown && enemyCount <= 2 && frame > 1800) {
        hanSoloShown = true;
        hanSoloTimer = 300;
        exhaustPort.active = true;
        showMessage("YOU'RE ALL CLEAR, KID!\nNOW LET'S BLOW THIS THING\nAND GO HOME!");
    }
    if (hanSoloTimer > 0) hanSoloTimer--;
}

function showMessage(text) {
    messageEl.textContent = text;
    messageEl.classList.add('show');
    setTimeout(() => messageEl.classList.remove('show'), 4000);
}

function update(dt) {
    frame++;
    if (state === GAME.PLAYING) {
        spawnEnemy();
        updatePlayer(dt);
        updateLasers(dt);
        updateEnemies(dt);
        checkCollisions();
        checkHanSolo();
    } else if (state === GAME.VICTORY) {
        // Victory explosion
        if (frame % 3 === 0) {
            for (let i = 0; i < 30; i++) {
                particles.push({
                    x: rand(-0.5, 0.5), y: rand(-0.5, 1),
                    vx: rand(-0.03, 0.03), vy: rand(-0.03, 0.03),
                    life: 60, color: [1, rand(0.2, 0.8), 0, 1]
                });
            }
        }
    } else if (state === GAME.DEFEAT) {
        // Death Star fires on Yavin
        if (frame % 10 === 0) {
            particles.push({
                x: 0, y: 0.9,
                vx: rand(-0.01, 0.01), vy: -0.02,
                life: 100, color: [1, 0, 0, 1]
            });
        }
    }
    updateParticles(dt);
    updateStars(dt);
}

function render() {
    gl.clearColor(0.01, 0.01, 0.02, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.uniformMatrix3fv(u_transform, false, getTransform());
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Stars
    for (const s of stars) {
        drawPoint(s.x, s.y, [s.brightness, s.brightness, s.brightness, 1], s.size);
    }

    // Trench walls
    for (const seg of trench.segments) {
        drawRect(seg.leftX, seg.y, 0.02, 0.04, [0.3, 0.25, 0.2, 1]);
        drawRect(seg.rightX, seg.y, 0.02, 0.04, [0.3, 0.25, 0.2, 1]);
    }

    // Exhaust port
    if (exhaustPort.active) {
        const pulse = Math.sin(frame * 0.1) * 0.3 + 0.7;
        drawCircle(exhaustPort.x, exhaustPort.y, exhaustPort.radius, [1, 0.5, 0, pulse], 16);
        drawCircle(exhaustPort.x, exhaustPort.y, exhaustPort.radius * 0.6, [1, 1, 0, pulse], 12);
    }

    // Enemies
    for (const e of enemies) {
        if (e.type === 'tie') {
            // TIE Fighter: two wings + center
            drawRect(e.x - 0.06, e.y, 0.03, 0.1, [0.4, 0.4, 0.4, 1]);
            drawRect(e.x + 0.06, e.y, 0.03, 0.1, [0.4, 0.4, 0.4, 1]);
            drawCircle(e.x, e.y, 0.025, [0.2, 0.2, 0.2, 1], 8);
            // Cockpit glow
            drawCircle(e.x, e.y, 0.015, [0, 0.5, 1, 0.8], 6);
        } else if (e.type === 'turret') {
            // Turret: base + gun
            drawRect(e.x, e.y, 0.05, 0.04, [0.3, 0.3, 0.35, 1]);
            drawRect(e.x, e.y + 0.03, 0.02, 0.06, [0.4, 0.4, 0.45, 1]);
            // Targeting indicator when locked
            if (e.fireTimer < 30) {
                drawCircle(e.x, e.y + 0.05, 0.03 + Math.sin(frame * 0.3) * 0.01, [1, 0, 0, 0.5], 8);
            }
        }
    }

    // Player (X-wing)
    if (player.invuln === 0 || player.invuln % 6 < 3) {
        // S-foils (wings)
        const foilAngle = Math.sin(frame * 0.15) * 0.3 + 0.7; // S-foils open/close
        drawRect(player.x - 0.06 * foilAngle, player.y - 0.01, 0.03, 0.08, [0.7, 0.7, 0.8, 1]);
        drawRect(player.x + 0.06 * foilAngle, player.y - 0.01, 0.03, 0.08, [0.7, 0.7, 0.8, 1]);
        // Fuselage
        drawRect(player.x, player.y, 0.025, 0.1, [0.8, 0.8, 0.9, 1]);
        // Cockpit
        drawCircle(player.x, player.y + 0.03, 0.018, [0, 0.7, 1, 1], 8);
        // Engines
        drawCircle(player.x - 0.015, player.y - 0.05, 0.01, [1, 0.5, 0, 1], 6);
        drawCircle(player.x + 0.015, player.y - 0.05, 0.01, [1, 0.5, 0, 1], 6);
    }

    // Player lasers
    for (const l of lasers) {
        if (l.torpedo) {
            drawCircle(l.x, l.y, 0.015, [1, 0, 1, 1], 6);
            // Trail
            drawCircle(l.x - l.vx * 5, l.y - l.vy * 5, 0.01, [1, 0, 1, 0.5], 4);
        } else {
            drawRect(l.x, l.y, 0.01, 0.04, [0, 1, 0.5, 1]);
        }
    }

    // Enemy lasers
    for (const l of enemyLasers) {
        const c = l.color || [1, 0.3, 0, 1];
        drawRect(l.x, l.y, 0.012, 0.035, c);
    }

    // Particles
    for (const p of particles) {
        const alpha = p.life / 40;
        drawPoint(p.x, p.y, [p.color[0], p.color[1], p.color[2], p.color[3] * alpha], 2 + alpha * 3);
    }

    // UI
    ui.innerHTML = `
        SHIELD: ${Math.max(0, player.shield)}%<br>
        TORPEDOES: ${player.torpedoes}/6<br>
        ENEMIES: ${enemies.length}<br>
        ${exhaustPort.active ? 'EXHAUST PORT: TARGET LOCKED' : ''}
    `;

    gl.bindVertexArray(null);
}

let lastTime = 0;
function loop(time) {
    const dt = Math.min((time - lastTime) / 16.67, 3); // Cap at 3x speed
    lastTime = time;
    update(dt);
    render();
    requestAnimationFrame(loop);
}
requestAnimationFrame(loop);