let recipes = {};
let currentRecipe = null;
let timeline = [];
let isRunning = false;
let elapsedTime = 0;
let timerInterval = null;
let scrollTimeout = null;
let stepPositions = []; // stores per-step center scroll positions for interpolation
let timelineLine = null;
let timelineLineFill = null;
let lineTop = 0;
let lineHeight = 0;
let timelineTotalSpan = 1;

let resizeRaf = 0;
let resizeTimeout = 0;

let recipeEndTime = 0;
let isCompleted = false;

// visual-only final animation state (drives the extra bar/tick animation after logical end)
let finalVisualAnimating = false;
let visualFillTime = 0;
let finalVisualCompleted = false;
// Wake Lock state for keeping screen awake on supported devices (Android)
let wakeLock = null;

async function requestWakeLock() {
    if (!('wakeLock' in navigator)) {
        console.warn('Wake Lock API not supported in this browser');
        return;
    }
    try {
        wakeLock = await navigator.wakeLock.request('screen');
        // Re-request on release if appropriate
        wakeLock.addEventListener('release', () => {
            console.log('Wake lock released');
            wakeLock = null;
        });
        console.log('Wake lock active');
    } catch (err) {
        console.error('Wake Lock request failed:', err && err.name, err && err.message);
    }
}

async function releaseWakeLock() {
    try {
        if (wakeLock) {
            await wakeLock.release();
            wakeLock = null;
        }
    } catch (err) {
        console.error('Error releasing wake lock:', err && err.name, err && err.message);
    }
}

// Re-acquire wake lock when returning to the page (some browsers require re-request)
document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && isRunning && !wakeLock) {
        await requestWakeLock();
    }
});
// Pre-start seconds to show visually before the first step
const PRE_START = 5;
// Visual duration for the final post-recipe tick (visual only)
const FINAL_TICK_DURATION = 5;
// Rapid final fill duration (ms) when the final tick begins
const FINAL_QUICK_FILL_MS = 300;
// Visual scale: increase spacing by this factor (2 = twice as much vertical spacing -> timeline moves visually twice as fast)
const VISUAL_SCALE = 8;
let timelineFirstTime = 0;
let timelineLastTime = 0;

// Indicator constants removed (now using centered timer instead)

const recipeSelect = document.getElementById('recipeSelect');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const resetBtn = document.getElementById('resetBtn');
const indicatorContainer = document.querySelector('.timeline-indicator-container');
const centerIndicator = document.querySelector('.timeline-indicator');
const timelineScroll = document.getElementById('timelineScroll');
const timelineContent = document.getElementById('timelineContent');
const topMessage = document.getElementById('topMessage');
const bottomMessage = document.getElementById('bottomMessage');

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function timeToY(t) {
    if (!Number.isFinite(lineHeight) || lineHeight <= 0) return lineTop;
    const rel = (t - timelineFirstTime) / Math.max(1e-6, timelineTotalSpan);
    return lineTop + rel * lineHeight;
}

function yToTime(y) {
    if (!Number.isFinite(lineHeight) || lineHeight <= 0) return timelineFirstTime;
    const rel = (y - lineTop) / lineHeight;
    return timelineFirstTime + rel * timelineTotalSpan;
}

// Load recipes
async function loadRecipes() {
    try {
        const response = await fetch('recipes.json');
        recipes = await response.json();
        populateRecipeSelect();
        // Auto-select the 720g recipe when available (fallback to first)
        const keys = Object.keys(recipes || {});
        if (keys.length) {
            const preferred = keys.find(k => k.includes('720')) || keys[0];
            recipeSelect.value = preferred;
            // generate the timeline for the default selection
            generateTimeline(preferred);
        }
    } catch (error) {
        console.error('Error loading recipes:', error);
    }
}

// Populate recipe dropdown
function populateRecipeSelect() {
    const names = Object.keys(recipes);
    names.forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        recipeSelect.appendChild(option);
    });
}

// Generate timeline from recipe
function generateTimeline(recipeName) {
    // Switching recipes while running should hard reset state
    if (isRunning) stopTimer();

    currentRecipe = recipes[recipeName];
    timeline = [...currentRecipe];

    // compute true end time (max of start+duration)
    recipeEndTime = timeline.reduce((maxT, step) => {
        const start = Number(step.time || 0);
        const dur = Number(('duration' in step) ? step.duration : 10);
        return Math.max(maxT, start + Math.max(0, dur));
    }, 0);
    isCompleted = false;
    // stop any running final-visual animation when regenerating
    finalVisualAnimating = false;
    visualFillTime = 0;
    finalVisualCompleted = false;
    if (bottomMessage) bottomMessage.classList.remove('visible');
    if (topMessage) topMessage.classList.remove('visible');
    
    // Find max time for padding
    const maxTime = Math.max(...timeline.map(s => s.time)) + 30;
    
    // clear content and reset geometry state
    timelineContent.innerHTML = '';
    stepPositions = [];
    lineTop = 0;
    lineHeight = 0;

    // reattach existing line element if it was previously created
    if (timelineLine && !timelineContent.contains(timelineLine)) {
        timelineContent.appendChild(timelineLine);
    }

    timeline.forEach((step, index) => {
        const item = document.createElement('div');
        item.className = 'timeline-item';
        item.dataset.index = index;
        
        item.innerHTML = `
            <div class="timeline-instruction">${step.instruction}</div>
        `;
        
        // expose start/end on the item for highlighting (duration default 10s)
        const start = Number(step.time || 0);
        const dur = Number(('duration' in step) ? step.duration : 10);
        item.dataset.start = start;
        item.dataset.end = start + Math.max(0, dur);
        
        // allow natural height; items will be positioned absolutely later based on timestamps
        
        timelineContent.appendChild(item);
    });
    
    // Ensure the continuous line elements exist inside content
    if (!timelineLine) {
        timelineLine = document.createElement('div');
        timelineLine.className = 'timeline-line';
        timelineLineFill = document.createElement('div');
        timelineLineFill.className = 'timeline-line-fill';
        timelineLine.appendChild(timelineLineFill);
        // place behind items
        timelineContent.appendChild(timelineLine);
    }

    // Compute per-step scroll positions after layout so we can interpolate smoothly
    requestAnimationFrame(() => {
        computeStepScrollPositions();
        elapsedTime = -PRE_START;
        // snap to initial position to avoid transform-influenced measurement issues
        const initialPos = calculateScrollPosition(elapsedTime);
        timelineContent.style.transform = `translateY(${-initialPos}px)`;
        timelineContent._lastTransformY = initialPos;

        updateTimelinePosition();
    });

    startBtn.disabled = false;
    resetBtn.disabled = false;
    stopBtn.disabled = true;
}

// Update timer display
function updateTimer(displayTime = elapsedTime) {
    // Show negative sign during countdown, format mm:ss
    const sign = displayTime < 0 ? '-' : '';
    const absSeconds = displayTime < 0
        ? Math.ceil(Math.abs(displayTime))
        : Math.floor(Math.abs(displayTime));
    const mins = Math.floor(absSeconds / 60);
    const secs = absSeconds % 60;
    const txt = `${sign}${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    if (centerIndicator) centerIndicator.textContent = txt;

    // Countdown display: show remaining seconds while elapsedTime < 0
    // no numeric countdown UI — pre-start region remains visual only
}

// Compute per-step center positions (scroll offset to center each step on indicator)
function computeStepScrollPositions() {
    const items = document.querySelectorAll('.timeline-item');
    stepPositions = [];

    // compute content geometry
    const wrapperRect = timelineScroll.getBoundingClientRect();
    const contentRect = timelineContent.getBoundingClientRect();
    const cs = getComputedStyle(timelineContent);
    const paddingTop = parseFloat(cs.paddingTop) || 0;
    const paddingBottom = parseFloat(cs.paddingBottom) || 0;
    const containerHeight = timelineScroll.clientHeight || wrapperRect.height || 1;
    const containerCenter = containerHeight / 2;

    // define mapping range for the timeline (top inside content and height), include pre-start
    const rawFirst = timeline[0] ? timeline[0].time : 0;
    const rawLast = timeline[timeline.length - 1] ? timeline[timeline.length - 1].time : rawFirst + 1;
    timelineFirstTime = rawFirst - PRE_START;
    // Ensure timelineLastTime includes a final visual tick (if any)
    const finalVisualEnd = (Number.isFinite(recipeEndTime) && recipeEndTime > 0)
        ? (recipeEndTime + FINAL_TICK_DURATION)
        : rawLast;
    timelineLastTime = Math.max(rawLast, finalVisualEnd);
    timelineTotalSpan = Math.max((timelineLastTime - timelineFirstTime), 1);

    lineTop = Math.round(paddingTop);
    // Use viewport-stable height for layout (contentRect height can be misleading with absolute children).
    const baseLineHeight = Math.max(40, Math.round(containerHeight));
    lineHeight = Math.round(baseLineHeight * VISUAL_SCALE); // apply visual spacing scale

    // compute exact horizontal center inside content so the visual line is exactly the viewport center
    const viewportCenterX = wrapperRect.left + wrapperRect.width / 2;
    const leftInContent = viewportCenterX - contentRect.left;

    // set line geometry
    if (timelineLine) {
        const halfLine = timelineLine.offsetWidth / 2;
        timelineLine.style.left = `${Math.round(leftInContent - halfLine)}px`;
        timelineLine.style.top = `${lineTop}px`;
        timelineLine.style.height = `${lineHeight}px`;
        timelineLineFill.style.height = `0px`;
        // ensure prestart element exists as first child
        if (!timelineLine._prestart) {
            const pre = document.createElement('div');
            pre.className = 'timeline-prestart';
            timelineLine.insertBefore(pre, timelineLine.firstChild);
            timelineLine._prestart = pre;
        }
        // create overlay stripes element (on top of the fill)
        if (!timelineLine._overlay) {
            const overlay = document.createElement('div');
            overlay.className = 'timeline-line-overlay';
            timelineLine.appendChild(overlay);
            timelineLine._overlay = overlay;
        }
        if (!timelineContent.contains(timelineLine)) timelineContent.appendChild(timelineLine);

        // compute pre-start region height (rawFirst - timelineFirstTime)
        const rawFirst = timeline[0] ? timeline[0].time : 0;
        const prePx = Math.max(0, Math.round(((rawFirst - timelineFirstTime) / Math.max(1, (timelineLastTime - timelineFirstTime))) * lineHeight));
        timelineLine._prestart.style.height = `${prePx}px`;
        // store prestart px so overlay can be clamped to it
        timelineLine._prePx = prePx;
        // ensure overlay starts at zero height
        timelineLine._overlay.style.height = `0px`;
    }

    // ensure content is tall enough to contain absolute items (absolute children don't increase scrollHeight)
    const desiredMinHeight = Math.round(lineTop + lineHeight + paddingBottom + 40);
    timelineContent.style.minHeight = `${Math.max(timelineContent.offsetHeight || 0, desiredMinHeight)}px`;

    // position items absolutely:
    // - instruction card centered on the middle of the pour tick (start + duration/2)
    items.forEach((item, i) => {
        const step = timeline[i];
        const start = Number(step.time || 0);
        const duration = Number(('duration' in step) ? step.duration : 10);
        const mid = start + Math.max(0, duration) / 2;

        const yStart = timeToY(start);
        const yMid = timeToY(mid);

        // Set width constraints first so text wraps consistently before measuring.
        const pad = Math.round(leftInContent + (timelineLine ? timelineLine.offsetWidth : 10) + 24);
        item.style.position = 'absolute';
        item.style.left = `0px`;
        item.style.right = `0px`;
        item.style.paddingLeft = `${pad}px`;

        const instructionEl = item.querySelector('.timeline-instruction');
        if (instructionEl) instructionEl.style.marginTop = `0px`;

        // Center the whole card on the tick midpoint for consistent alignment.
        const itemH = item.offsetHeight || 0;
        item.style.top = `${Math.round(yMid - itemH / 2)}px`;

        // compute scroll offset that centers the start timestamp at viewport center
        const centerOffset = yStart - containerCenter;
        const maxScroll = Math.max(timelineContent.scrollHeight - containerHeight, 0);
        const clamped = Math.max(0, Math.min(centerOffset, maxScroll));
        stepPositions.push(clamped);
    });

    // recreate pour ticks based on computed geometry
    createPourTicks();

    // render scale labels on the left of the timeline
    createScaleLabels();

    // render time labels on the right of the timeline
    createTimeLabels();
}

function relayoutAndSnap() {
    if (!timeline || timeline.length === 0) return;
    computeStepScrollPositions();
    const pos = calculateScrollPosition(elapsedTime);
    timelineContent.style.transform = `translateY(${-pos}px)`;
    timelineContent._lastTransformY = pos;
    updateTimelinePosition();
}

function parseGrams(value) {
    if (value == null) return 0;
    const n = Number(String(value).replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(n) ? n : 0;
}

// Create scale weight labels to the left of the main timeline.
// For each step:
// - show the current scale weight aligned with pour start
// - show (scale + add) aligned with pour end
function createScaleLabels() {
    // remove old labels
    timelineContent.querySelectorAll('.scale-label').forEach(n => n.remove());
    if (!timelineLine || !timeline || timeline.length === 0) return;

    // weights are shown on the right, past the pour ticks
    const rightX = Math.round(timelineLine.offsetLeft + timelineLine.offsetWidth + 8 + 10 + 14);

    timeline.forEach((step, i) => {
        const start = Number(step.time || 0);
        const duration = Number(('duration' in step) ? step.duration : 10);
        const end = start + Math.max(0, duration);

        const startG = parseGrams(step.scale);
        const addG = parseGrams(step.add);
        const endG = startG + addG;

        const y0 = timeToY(start);
        const y1 = timeToY(end);

        const startLabel = document.createElement('div');
        startLabel.className = 'scale-label scale-label-start label-right';
        startLabel.style.left = `${rightX}px`;
        startLabel.style.top = `${Math.round(y0)}px`;
        startLabel.textContent = `${startG} g`;
        timelineContent.appendChild(startLabel);

        // only render an end label when the pour actually changes the scale over time
        if (end !== start && addG !== 0) {
            const endLabel = document.createElement('div');
            endLabel.className = 'scale-label scale-label-end label-right';
            endLabel.style.left = `${rightX}px`;
            endLabel.style.top = `${Math.round(y1)}px`;
            endLabel.textContent = `${endG} g`;
            timelineContent.appendChild(endLabel);
        }
    });
}

function createTimeLabels() {
    timelineContent.querySelectorAll('.time-label').forEach(n => n.remove());
    if (!timelineLine || !timeline || timeline.length === 0) return;

    // times are shown to the left of the center line
    const leftX = Math.round(timelineLine.offsetLeft - 12);

    const fmt = (t) => {
        const mins = Math.floor(t / 60);
        const secs = Math.floor(t % 60);
        return `${mins}:${String(secs).padStart(2, '0')}`;
    };

    timeline.forEach((step) => {
        const start = Number(step.time || 0);
        const duration = Number(('duration' in step) ? step.duration : 10);
        const end = start + Math.max(0, duration);

        const y0 = timeToY(start);
        const startLabel = document.createElement('div');
        startLabel.className = 'time-label time-label-start label-left';
        startLabel.style.left = `${leftX}px`;
        startLabel.style.top = `${Math.round(y0)}px`;
        startLabel.textContent = fmt(start);
        timelineContent.appendChild(startLabel);

        // Add a bottom timestamp aligned to the end of the pour tick.
        if (end !== start) {
            const y1 = timeToY(end);
            const endLabel = document.createElement('div');
            endLabel.className = 'time-label time-label-end label-left';
            endLabel.style.left = `${leftX}px`;
            endLabel.style.top = `${Math.round(y1)}px`;
            endLabel.textContent = fmt(end);
            timelineContent.appendChild(endLabel);
        }
    });
}

// Calculate scroll position based on elapsed time, interpolating between step centers
function calculateScrollPosition(time = elapsedTime) {
    if (!timeline || timeline.length === 0) return 0;

    // Map time to a content Y position along the line
    const clampedT = clamp(time, timelineFirstTime, timelineLastTime);
    const contentY = timeToY(clampedT);

    // Convert content Y to scrollTop so that contentY sits at the container's center
    const containerCenter = timelineScroll.clientHeight / 2;
    const scrollTarget = contentY - containerCenter;
    const maxScroll = Math.max(timelineContent.scrollHeight - timelineScroll.clientHeight, 0);
    return Math.max(0, Math.min(scrollTarget, maxScroll));
}

// Create visual pour ticks for each step (duration bars spanning start->end)
function createPourTicks() {
    // remove old ticks
    timelineContent.querySelectorAll('.pour-tick').forEach(n => n.remove());
    // remove any existing final glow element
    const oldGlow = timelineContent.querySelector('.final-tick-glow');
    if (oldGlow) oldGlow.remove();
    const items = document.querySelectorAll('.timeline-item');
    if (!timelineLine || items.length === 0) return;

    const contentRect = timelineContent.getBoundingClientRect();
    const firstTime = timelineFirstTime; // includes PRE_START padding
    const lastTime = timelineLastTime;
    // compute leftX relative to content so ticks align to the right of the centered line
    const leftX = (timelineLine ? (timelineLine.offsetLeft + timelineLine.offsetWidth + 8) : (contentRect.width / 2 + 8)); // 8px gap from line
    const tickWidth = 10; // must match CSS

    timeline.forEach((step, i) => {
        const start = Number(step.time || 0);
        const duration = Number(('duration' in step) ? step.duration : 10);
        const end = start + Math.max(0, duration);

        // map to content-space Y positions relative to lineTop
        const y0 = timeToY(start);
        const y1 = timeToY(end);
        let topPx = Math.round(Math.min(y0, y1));
        let heightPx = Math.max(3, Math.round(Math.abs(y1 - y0)));

        // ensure it stays within the line bounds
        if (topPx < lineTop) {
            heightPx -= (lineTop - topPx);
            topPx = lineTop;
        }
        if (topPx + heightPx > lineTop + lineHeight) {
            heightPx = (lineTop + lineHeight) - topPx;
        }

        const tick = document.createElement('div');
        tick.className = 'pour-tick';
        tick.style.top = `${topPx}px`;
        tick.style.left = `${Math.round(leftX)}px`;
        tick.style.height = `${heightPx}px`;
        tick.style.width = `${tickWidth}px`;
        tick.dataset.index = i;
        tick.dataset.start = start;
        tick.dataset.end = end;

        const fill = document.createElement('div');
        fill.className = 'pour-tick-fill';
        // ensure explicit pixel-based initial height to avoid percent-based
        // hairlines on some browsers/layout states
        fill.style.height = '0px';
        tick.appendChild(fill);

        timelineContent.appendChild(tick);
    });

    // create a final visual tick at the end of the recipe
    if (Number.isFinite(recipeEndTime)) {
        const finalStart = recipeEndTime;
        const finalEnd = recipeEndTime + FINAL_TICK_DURATION;
        const fy0 = timeToY(finalStart);
        const fy1 = timeToY(finalEnd);
        let fTop = Math.round(Math.min(fy0, fy1));
        let fH = Math.max(3, Math.round(Math.abs(fy1 - fy0)));

        if (fTop < lineTop) {
            fH -= (lineTop - fTop);
            fTop = lineTop;
        }
        if (fTop + fH > lineTop + lineHeight) {
            fH = (lineTop + lineHeight) - fTop;
        }

        const finalTick = document.createElement('div');
        finalTick.className = 'pour-tick pour-tick-final';
        finalTick.style.top = `${fTop}px`;
        finalTick.style.left = `${Math.round(leftX)}px`;
        finalTick.style.height = `${fH}px`;
        finalTick.style.width = `${tickWidth}px`;
        finalTick.dataset.start = finalStart;
        finalTick.dataset.end = finalEnd;

        const ffill = document.createElement('div');
        ffill.className = 'pour-tick-fill';
        ffill.style.height = '0px';
        finalTick.appendChild(ffill);
        timelineContent.appendChild(finalTick);

        // create a floating glow element that sits above the timeline so it's
        // not clipped by overflow on the tick element; position it slightly
        // larger than the tick and keep a reference on the content element.
        const glow = document.createElement('div');
        glow.className = 'final-tick-glow';
        const pad = 16;
        glow.style.top = `${Math.max(0, fTop - pad)}px`;
        glow.style.left = `${Math.max(0, Math.round(leftX) - pad)}px`;
        glow.style.width = `${Math.round(tickWidth + pad * 2)}px`;
        glow.style.height = `${Math.max(6, Math.round(fH + pad * 2))}px`;
        timelineContent.appendChild(glow);
        timelineContent._finalGlow = glow;

        // If the last timeline instruction looks like a terminal instruction (no duration or 'remove'), align it to the middle of this final tick
        const items = document.querySelectorAll('.timeline-item');
        const lastIdx = items.length - 1;
        if (lastIdx >= 0) {
            const lastStep = timeline[timeline.length - 1];
            const lastStepDur = Number(('duration' in lastStep) ? lastStep.duration : 0);
            const lastInstr = String(lastStep.instruction || '').toLowerCase();
            if (lastStepDur === 0 || /remove|serve|finish|done/.test(lastInstr)) {
                const lastItem = items[lastIdx];
                const mid = finalStart + FINAL_TICK_DURATION / 2;
                const yMid = timeToY(mid);
                const itemH = lastItem.offsetHeight || 0;
                lastItem.style.top = `${Math.round(yMid - itemH / 2)}px`;
                // Mark its dataset to match final tick so highlighting follows
                lastItem.dataset.start = finalStart;
                lastItem.dataset.end = finalEnd;
            }
        }
    }
    // initial fill states - force zero pixel fill at creation to avoid
    // visual artifacts where the final tick shows a tiny initial fill.
    updatePourTickStates(elapsedTime, 0);
}

// Update tick fill widths based on elapsed time
function updatePourTickStates(renderTime = elapsedTime, elapsedFillPxOverride = null) {
    const ticks = timelineContent.querySelectorAll('.pour-tick');
    if (!ticks) return;

    // Compute main line elapsed fill in pixels (same math used for the main fill)
    const elapsedFillPx = (elapsedFillPxOverride != null)
        ? Math.round(elapsedFillPxOverride)
        : (timelineLine && typeof lineTop === 'number'
            ? Math.round(clamp(timeToY(renderTime) - lineTop, 0, lineHeight))
            : 0);

    ticks.forEach(tick => {
        const start = Number(tick.dataset.start || 0);
        const end = Number(tick.dataset.end || start);

        const tickTop = tick.offsetTop || parseInt(tick.style.top, 10) || 0;
        const tickH = tick.clientHeight || parseFloat(tick.style.height) || 0;

        const fillEl = tick.querySelector('.pour-tick-fill');
        if (!fillEl) return;

        // If this is the final visual tick and we're running the visual-only
        // animation, force it to fill smoothly from the visual fill value so it
        // doesn't appear out-of-sync or empty. Also ensure that once the
        // logical fill reaches the tick end we show it as full.
        const isFinal = tick.classList.contains('pour-tick-final');
        if (isFinal && (finalVisualAnimating || renderTime >= Number(tick.dataset.end || 0))) {
            fillEl.style.height = `${Math.round(tickH)}px`;
            fillEl.classList.add('filled');
            // show floating glow if present
            try {
                const glow = timelineContent && timelineContent._finalGlow;
                if (glow) glow.classList.add('visible');
            } catch (e) {}
            return;
        }
        // For the final tick when not animating and before its end time,
        // ensure no stray fill or glow is shown.
        if (isFinal) {
            fillEl.style.height = `0px`;
            fillEl.classList.remove('filled');
            try {
                const glow = timelineContent && timelineContent._finalGlow;
                if (glow) glow.classList.remove('visible');
            } catch (e) {}
            return;
        }

        // Amount of the tick that should be filled equals how much of the main line
        // has been filled within the tick's vertical range.
        const localFill = clamp(elapsedFillPx - (tickTop - lineTop), 0, tickH);
        const localPx = Math.max(0, Math.round(localFill));
        fillEl.style.height = `${localPx}px`;
        fillEl.classList.toggle('filled', localPx > 0);
    });
}

// Update which timeline item is active and scroll smoothly
function updateTimelinePosition() {
    const items = document.querySelectorAll('.timeline-item');

    // Calculate desired scroll position (content-space). Stop scrolling once
    // the start of the final tick is reached so the view remains anchored there
    // while fills continue to progress through the final visual tick.
    const scrollAnchorTime = (Number.isFinite(recipeEndTime) && recipeEndTime > timelineFirstTime)
        ? Math.min(elapsedTime, recipeEndTime)
        : elapsedTime;
    const scrollPos = calculateScrollPosition(scrollAnchorTime);

    // Apply transform-based scroll (smooth visual motion) when running
    if (isRunning) {
        // small easing to smooth minor differences (keeps motion fluid)
        const currentTransform = timelineContent._lastTransformY || 0;
        const delta = scrollPos - currentTransform;
        const ease = 0.18;
        const next = Math.abs(delta) < 0.5 ? scrollPos : currentTransform + delta * ease;
        timelineContent.style.transform = `translateY(${-next}px)`;
        timelineContent._lastTransformY = next;
    } else {
        // when not running, snap to position
        timelineContent.style.transform = `translateY(${-scrollPos}px)`;
        timelineContent._lastTransformY = scrollPos;
    }

    // Use transform-derived visual scroll position for visuals
    const visualScroll = timelineContent._lastTransformY || 0;
    const containerCenter = timelineScroll.clientHeight / 2;

    // Derive a single render-time from what is actually centered on screen
    // (for positioning) and a separate fill time driven by actual elapsed
    // time so the main line can continue filling through the final tick
    // while the scroll remains anchored.
    const centeredContentY = visualScroll + containerCenter;
    const positionedTime = clamp(yToTime(centeredContentY), timelineFirstTime, timelineLastTime);

    // final visual end (logical recipe end + any extra visual-only duration)
    const finalVisualEnd = Number.isFinite(recipeEndTime) && recipeEndTime > 0
        ? recipeEndTime + FINAL_TICK_DURATION
        : timelineLastTime;

    // Determine logical fill time (used for timer text and active state) and
    // visual fill time (used for the bar/tick rendering). The logical end is
    // the recipe end as defined by the JSON; any extra visual animation should
    // not delay logical completion.
    const fillTimeLogical = clamp(elapsedTime, timelineFirstTime, recipeEndTime);
    const sourceFillTime = finalVisualAnimating
        ? visualFillTime
        : (finalVisualCompleted ? finalVisualEnd : clamp(elapsedTime, timelineFirstTime, finalVisualEnd));

    // Update timer and messages using the logical fill time so countdown/countup
    // and active highlighting reflect the true recipe end.
    updateTimer(fillTimeLogical);
    if (topMessage) topMessage.classList.toggle('visible', isRunning && fillTimeLogical < 0);
    if (bottomMessage) bottomMessage.classList.toggle('visible', !isRunning && isCompleted);

    // Highlight only items whose [start,end] contains the logical fill time
    items.forEach((item) => {
        const start = Number(item.dataset.start || 0);
        const end = Number(item.dataset.end || start);
        const isActive = (fillTimeLogical >= start && fillTimeLogical <= end);
        item.classList.toggle('active', isActive);
    });

    // Update continuous line fill to show the visual fill time (which may be a
    // visual-only animation after logical completion).
    if (timelineLine && typeof lineTop === 'number') {
        let elapsedFill = timeToY(sourceFillTime) - lineTop;
        elapsedFill = clamp(elapsedFill, 0, lineHeight);
        const elapsedFillToUse = Math.round(elapsedFill);

        timelineLineFill.style.height = `${elapsedFillToUse}px`;
        // overlay stripes should be visible only within the pre-start region (clamp to prePx)
        if (timelineLine && timelineLine._overlay) {
            const maxPre = timelineLine._prePx || 0;
            const overlayH = Math.max(0, Math.min(elapsedFillToUse, maxPre));
            timelineLine._overlay.style.height = `${overlayH}px`;
            timelineLine._overlay.style.opacity = overlayH > 0 ? '1' : '0';
        }

        // Align the TOP of the timer text with the current timeline position (container center)
        if (indicatorContainer) {
            const h = indicatorContainer.offsetHeight || 0;
            const scrollOffsetTop = timelineScroll.offsetTop || 0;
            const topPx = Math.round(scrollOffsetTop + containerCenter - h / 2);
            indicatorContainer.style.top = `${topPx}px`;
        }

        // Update pour tick fills driven by the same pixel-based fill so they stay in sync
        updatePourTickStates(sourceFillTime, elapsedFillToUse);
    }

    // Resize the horizontal indicator so it reaches the vertical line (indicator only on left)



}

// Start timer with smooth animation
function startTimer() {
    isRunning = true;
    isCompleted = false;
    if (bottomMessage) bottomMessage.classList.remove('visible');
    startBtn.disabled = true;
    stopBtn.disabled = false;
    resetBtn.disabled = true;
    recipeSelect.disabled = true;

    // If starting fresh, begin at -PRE_START for the countdown
    if (elapsedTime === 0) elapsedTime = -PRE_START;

    // Request wake lock on supported devices so the screen stays awake
    // while a recipe is running (useful for Android).</n+    requestWakeLock();
    
    let lastTime = performance.now();
    
    const animationLoop = () => {
        if (!isRunning) return;
        
        const now = performance.now();
        const deltaTime = (now - lastTime) / 1000;
        lastTime = now;
        
        elapsedTime += deltaTime;
        updateTimelinePosition();
        
        // Stop when logical recipe time is reached (do NOT block on the extra
        // visual final tick duration). Trigger a visual-only animation for the
        // final bar/tick if needed.
        const logicalEnd = Number.isFinite(recipeEndTime) && recipeEndTime > 0
            ? recipeEndTime
            : (Math.max(...timeline.map(s => s.time)) + 10);
        if (elapsedTime >= logicalEnd) {
            elapsedTime = logicalEnd;
            isCompleted = true;
            // stop logical timer and enable controls immediately
            stopTimer();
            updateTimelinePosition();

            // If there's an extra visual duration beyond the logical end, kick
            // off the visual-only final animation so the bar/tick finish nicely.
            const finalVisualEnd = Number.isFinite(recipeEndTime) && recipeEndTime > 0
                ? recipeEndTime + FINAL_TICK_DURATION
                : logicalEnd;
            if (finalVisualEnd > recipeEndTime && FINAL_QUICK_FILL_MS > 0) {
                startFinalVisualAnimation();
            }
            return;
        }
        
        requestAnimationFrame(animationLoop);
    };
    
    requestAnimationFrame(animationLoop);
}

// Stop timer
function stopTimer() {
    isRunning = false;
    clearInterval(timerInterval);
    startBtn.disabled = false;
    stopBtn.disabled = true;
    resetBtn.disabled = false;
    recipeSelect.disabled = false;
    // release wake lock when stopping
    releaseWakeLock();
}

// Start the visual-only final animation that advances the fill from the
// recipe end to the final visual end over a short duration so the extra
// timeline bar and final tick complete without delaying logical completion.
function startFinalVisualAnimation() {
    if (!Number.isFinite(recipeEndTime) || recipeEndTime <= timelineFirstTime) return;
    const finalVisualEnd = recipeEndTime + FINAL_TICK_DURATION;
    if (finalVisualEnd <= recipeEndTime) return;
    finalVisualAnimating = true;
    visualFillTime = recipeEndTime;
    const start = performance.now();
    const dur = Math.max(1, FINAL_QUICK_FILL_MS);

    function frame() {
        const now = performance.now();
        const t = clamp((now - start) / dur, 0, 1);
        const ease = 1 - Math.pow(1 - t, 2);
        visualFillTime = recipeEndTime + (finalVisualEnd - recipeEndTime) * ease;
        updateTimelinePosition();
        if (t < 1) requestAnimationFrame(frame);
        else {
            visualFillTime = finalVisualEnd;
            finalVisualAnimating = false;
            finalVisualCompleted = true;
            updateTimelinePosition();
        }
    }

    requestAnimationFrame(frame);
}

// Reset timeline
function resetTimeline() {
    isRunning = false;
    clearInterval(timerInterval);
    elapsedTime = -PRE_START;
    isCompleted = false;
    if (bottomMessage) bottomMessage.classList.remove('visible');
    // recompute positions in case layout changed and ensure position corresponds to -PRE_START
    requestAnimationFrame(() => {
        computeStepScrollPositions();
        const resetPos = calculateScrollPosition(elapsedTime);
        timelineContent.style.transform = `translateY(${-resetPos}px)`;
        timelineContent._lastTransformY = resetPos;
        updateTimelinePosition();
    });
    startBtn.disabled = false;
    stopBtn.disabled = true;
    resetBtn.disabled = false;
    recipeSelect.disabled = false;
    // release wake lock when resetting
    releaseWakeLock();
}

// Event listeners
recipeSelect.addEventListener('change', (e) => {
    if (e.target.value) {
        generateTimeline(e.target.value);
    }
});

startBtn.addEventListener('click', startTimer);
stopBtn.addEventListener('click', stopTimer);
resetBtn.addEventListener('click', resetTimeline);

// Dev shortcut: Cmd+Shift+P -> jump to 10s before recipe end (convenience during development)
window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key && e.key.toLowerCase() === 'p') {
        if (!Number.isFinite(recipeEndTime) || recipeEndTime <= timelineFirstTime) {
            console.warn('Dev-jump: no recipe end time available');
            return;
        }
        const target = Math.max(timelineFirstTime, recipeEndTime - 10);
        elapsedTime = target;
        // Snap the visual position immediately so dev can observe the end sequence
        updateTimelinePosition();
        console.info(`Dev: jumped to ${target}s (10s before end)`);
        // prevent default so browser shortcuts don't trigger
        e.preventDefault();
    }
});

// Keep position correct on resize
window.addEventListener('resize', () => {
    // Debounce resize: layout can thrash during window drags and break measurement.
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    clearTimeout(resizeTimeout);

    resizeRaf = requestAnimationFrame(() => {
        resizeTimeout = setTimeout(() => {
            relayoutAndSnap();
        }, 60);
    });
});



// Initial load
loadRecipes();
