/**
 * Refresh button motion tests. Run with: node test-refresh-spinner.js
 * Loads the real createRefreshSpinner from popup.js against a deterministic fake Web Animations API.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const popupJs = fs.readFileSync(path.join(__dirname, 'popup.js'), 'utf8');
const popupHtml = fs.readFileSync(path.join(__dirname, 'popup.html'), 'utf8');

const TURN_MS = Number(popupHtml.match(/--motion-loading:\s*([\d.]+)s/)[1]) * 1000;
const SPIN_SPEED = 360 / TURN_MS * 1000;

function pick(re) {
  const match = popupJs.match(re);
  assert.ok(match, `popup.js contains ${re}`);
  return match[0];
}

const spinnerSource = [
  ...popupJs.match(/^const REFRESH_(?:BRAKE_EASING|SYMMETRY_DEG|MIN_BRAKE_DEG|TURN_FALLBACK_MS) = [^\r\n]+/gm),
  pick(/function createRefreshSpinner\(\{ icon \}, turnMs\) {[\s\S]*?\r?\n}\r?\n/)
].join('\n');
const constants = vm.runInNewContext(`${spinnerSource}\n({ REFRESH_BRAKE_EASING, REFRESH_SYMMETRY_DEG, REFRESH_MIN_BRAKE_DEG, REFRESH_TURN_FALLBACK_MS })`);

const flush = () => new Promise(resolve => setImmediate(resolve));
// Objects built inside the vm have another realm's prototypes; compare their JSON shape instead.
const same = (actual, expected, message) => assert.equal(JSON.stringify(actual), JSON.stringify(expected), message);

function createHarness() {
  const timeline = { currentTime: 1000 };
  const events = [];
  const made = [];
  const icon = {
    animate(keyframes, timing) {
      let resolveFinished;
      const anim = {
        keyframes,
        timing,
        startTime: null,
        cancelled: false,
        finished: new Promise(resolve => { resolveFinished = resolve; }),
        finish() { resolveFinished(anim); },
        cancel() {
          anim.cancelled = true;
          events.push(`cancel:${made.indexOf(anim)}`);
        },
        effect: {
          getComputedTiming: () => {
            const start = anim.startTime ?? timeline.currentTime;
            const raw = Math.max(0, timeline.currentTime - start) / timing.duration;
            if (timing.iterations === Infinity) return { progress: raw % 1 };
            const x = Math.min(raw, 1);
            // Quadratic ease-out, which REFRESH_BRAKE_EASING encodes.
            return { progress: 1 - (1 - x) * (1 - x) };
          }
        }
      };
      made.push(anim);
      events.push(`animate:${made.length - 1}`);
      return anim;
    }
  };
  const context = { document: { timeline }, parts: { icon }, out: null };
  vm.runInNewContext(`${spinnerSource}\nout = createRefreshSpinner(parts, ${TURN_MS});`, context);
  const degrees = anim => anim.keyframes.map(frame => parseFloat(frame.transform.match(/-?[\d.]+/)[0]));
  const angleOf = anim => {
    const [from, to] = degrees(anim);
    return (from + anim.effect.getComputedTiming().progress * (to - from)) % 360;
  };
  const live = () => made.filter(anim => !anim.cancelled);
  return { spinner: context.out, timeline, made, events, degrees, angleOf, live };
}

// Two arcs with arrowheads: every vertex rotated by 180deg about (12,12) lands on another vertex.
function refreshGlyph() {
  const svg = popupHtml.match(/<svg\s+class="refresh-icon"[^>]*>([\s\S]*?)<\/svg>/)?.[1] || '';
  return [...svg.matchAll(/<path\s+class="(refresh-arc|refresh-arrow)"\s+d="([^"]+)"/g)]
    .map(([, kind, d]) => ({ kind, d, nums: d.match(/-?[\d.]+/g).map(Number) }));
}

function arcEndpoints(d) {
  const n = d.match(/-?[\d.]+/g).map(Number);
  return [[n[0], n[1]], [n[7], n[8]]];
}

function arrowPoints(d) {
  // "M x y v dy h dx": first wing, tip at the corner, second wing.
  const NUM = '(-?\\d+(?:\\.\\d+)?)';
  const match = d.match(new RegExp(`^M${NUM} ${NUM}v${NUM}h${NUM}$`));
  assert.ok(match, `arrowhead path "${d}" uses the M x y v dy h dx form this test parses`);
  const [x, y, dy, dx] = match.slice(1).map(Number);
  return [[x, y], [x, y + dy], [x + dx, y + dy]];
}

test('the glyph is symmetric under a half-turn and fits inside the viewBox while turning', () => {
  const parts = refreshGlyph();
  assert.equal(parts.filter(p => p.kind === 'refresh-arc').length, 2);
  assert.equal(parts.filter(p => p.kind === 'refresh-arrow').length, 2);
  const points = parts.flatMap(p => p.kind === 'refresh-arc' ? arcEndpoints(p.d) : arrowPoints(p.d));
  for (const [x, y] of points) {
    const mirrored = [24 - x, 24 - y];
    assert.ok(points.some(([px, py]) => Math.hypot(px - mirrored[0], py - mirrored[1]) < 0.02),
      `(${x}, ${y}) has a 180deg partner`);
    assert.ok(Math.hypot(x - 12, y - 12) + 0.8 <= 12, `(${x}, ${y}) plus stroke stays inside radius 12`);
  }
  for (const arc of parts.filter(p => p.kind === 'refresh-arc')) {
    for (const [x, y] of arcEndpoints(arc.d)) {
      assert.ok(Math.abs(Math.hypot(x - 12, y - 12) - 7.5) < 0.02, 'arc endpoints lie on the r=7.5 circle');
    }
  }
  assert.equal(constants.REFRESH_SYMMETRY_DEG, 180);
});

test('each arrowhead tip sits on the clockwise end of an arc', () => {
  const parts = refreshGlyph();
  const arcEnds = parts.filter(p => p.kind === 'refresh-arc').map(p => arcEndpoints(p.d)[1]);
  for (const arrow of parts.filter(p => p.kind === 'refresh-arrow')) {
    const tip = arrowPoints(arrow.d)[1];
    assert.ok(arcEnds.some(end => Math.hypot(end[0] - tip[0], end[1] - tip[1]) < 0.02), `arrow tip ${tip} meets an arc end`);
  }
  // sweep-flag 1 draws clockwise on screen, so the arc end is its leading end.
  for (const arc of parts.filter(p => p.kind === 'refresh-arc')) {
    assert.ok(/A7\.5 7\.5 0 0 1 /.test(arc.d), 'arcs are short clockwise arcs');
  }
});

test('the spin is linear and starts at the spin speed from rest', () => {
  const h = createHarness();
  h.spinner.spin();
  const spin = h.made[0];
  assert.equal(spin.timing.iterations, Infinity);
  assert.equal(spin.timing.easing, 'linear');
  assert.equal(spin.timing.duration, TURN_MS);
  assert.equal(spin.startTime, 1000);
  same(h.degrees(spin), [0, 360]);
  h.spinner.spin();
  assert.equal(h.made.length, 1, 'a second owner does not restart the spin');
});

for (const elapsed of [0.05, 0.3, 0.49, 0.5, 0.74, 0.97]) {
  test(`stopping at ${Math.round(elapsed * 360)}deg brakes from the spin speed onto a half-turn`, () => {
    const h = createHarness();
    h.spinner.spin();
    const spin = h.made[0];
    h.timeline.currentTime = 1000 + elapsed * TURN_MS;
    const before = h.angleOf(spin);
    h.spinner.settle();
    const brake = h.made[1];
    const [from, to] = h.degrees(brake);
    assert.ok(Math.abs(from - before) < 1e-9, 'brake starts at the spin angle');
    assert.ok(spin.cancelled, 'the spin is replaced');
    assert.ok(h.events.indexOf('animate:1') < h.events.indexOf('cancel:0'), 'the brake starts before the spin is cancelled');
    assert.equal(brake.startTime, h.timeline.currentTime, 'brake starts at the hand-off time');
    assert.equal(brake.timing.easing, constants.REFRESH_BRAKE_EASING);
    assert.equal(brake.timing.fill, 'forwards');
    assert.ok(Math.abs(to % 180) < 1e-9, `lands on a half-turn (${to}deg)`);
    const span = to - from;
    assert.ok(span >= constants.REFRESH_MIN_BRAKE_DEG - 1e-9, `brakes over at least ${constants.REFRESH_MIN_BRAKE_DEG}deg (${span.toFixed(1)})`);
    assert.ok(span < 180 + constants.REFRESH_MIN_BRAKE_DEG, 'never coasts past the next possible pose');
    const brakeStartSpeed = 2 * span / brake.timing.duration * 1000;
    assert.ok(Math.abs(brakeStartSpeed - SPIN_SPEED) < 1, `brake starts at spin speed (${brakeStartSpeed.toFixed(1)}deg/s)`);
  });
}

test('the brake easing is quadratic ease-out: twice the average speed at start, zero at the end', () => {
  const [x1, y1, x2, y2] = constants.REFRESH_BRAKE_EASING.match(/-?[\d.]+/g).map(Number);
  assert.ok(Math.abs(y1 / x1 - 2) < 0.01, 'initial slope is 2');
  assert.ok(Math.abs(1 - y2) < 1e-9, 'final slope is 0');
  assert.ok(x2 < 1);
});

test('after the brake lands the transform is dropped, which renders the same half-turn pose', async () => {
  const h = createHarness();
  h.spinner.spin();
  h.timeline.currentTime += 0.4 * TURN_MS;
  h.spinner.settle();
  const brake = h.made[1];
  brake.finish();
  await flush();
  assert.ok(brake.cancelled, 'the finished brake is removed');
  assert.equal(h.live().length, 0);
  h.spinner.spin();
  same(h.degrees(h.made[2]), [0, 360], 'the next spin starts from rest');
});

test('a request during the landing resumes spinning from the current angle at once', async () => {
  const h = createHarness();
  h.spinner.spin();
  h.timeline.currentTime += 0.8 * TURN_MS;
  h.spinner.settle();
  const brake = h.made[1];
  h.timeline.currentTime += brake.timing.duration / 3;
  const during = h.angleOf(brake);
  h.spinner.spin();
  const resumed = h.made[2];
  assert.ok(resumed, 'spin resumes without waiting for the landing');
  assert.equal(resumed.timing.iterations, Infinity);
  assert.equal(resumed.startTime, h.timeline.currentTime);
  const [from] = h.degrees(resumed);
  assert.ok(Math.abs(from - during % 180) < 1e-9, 'resumes from the same pose (mod a half-turn)');
  assert.ok(brake.cancelled);
  // The stale brake resolving later must not clear the new spin.
  brake.finish();
  await flush();
  assert.ok(!resumed.cancelled, 'the old landing does not stop the resumed spin');
  h.spinner.settle();
  assert.equal(h.made.length, 4, 'the resumed spin can land again');
});

test('settling twice or while at rest does nothing', () => {
  const h = createHarness();
  h.spinner.settle();
  assert.equal(h.made.length, 0);
  h.spinner.spin();
  h.spinner.settle();
  h.spinner.settle();
  assert.equal(h.made.length, 2, 'only one brake per landing');
});

test('stop cancels the running animation and returns to rest', () => {
  const h = createHarness();
  h.spinner.spin();
  h.spinner.settle();
  h.spinner.stop();
  assert.ok(h.made.every(anim => anim.cancelled));
  h.spinner.spin();
  same(h.degrees(h.made[2]), [0, 360], 'spins again from rest immediately after stop');
});

test('the refresh result color lasts at least as long as the longest landing; other buttons keep 600ms', () => {
  const minResultMs = Number(popupJs.match(/const REFRESH_RESULT_MIN_MS = (\d+);/)[1]);
  assert.equal(Number(popupJs.match(/const BUTTON_RESULT_MIN_MS = (\d+);/)[1]), 600);
  assert.ok(/const minMs = refreshSpinners\.get\(button\) \? REFRESH_RESULT_MIN_MS : BUTTON_RESULT_MIN_MS;/.test(popupJs),
    'only buttons with a refresh spinner use the longer minimum');
  const longestSpan = constants.REFRESH_SYMMETRY_DEG + constants.REFRESH_MIN_BRAKE_DEG;
  const landingMs = 2 * longestSpan * TURN_MS / 360;
  assert.ok(minResultMs >= landingMs, `result color (${minResultMs}ms) does not clear before the glyph lands (${landingMs}ms)`);
  assert.equal(constants.REFRESH_TURN_FALLBACK_MS, TURN_MS, 'fallback turn matches --motion-loading');
});
