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

// Pre-start seconds to show visually before the first step
const PRE_START = 5;
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
    timelineLastTime = rawLast;
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
        tick.appendChild(fill);

        timelineContent.appendChild(tick);
    });

    // initial fill states
    updatePourTickStates();
}

// Update tick fill widths based on elapsed time
function updatePourTickStates(renderTime = elapsedTime) {
    const ticks = timelineContent.querySelectorAll('.pour-tick');
    if (!ticks) return;

    // Compute main line elapsed fill in pixels (same math used for the main fill)
    const elapsedFillPx = timelineLine && typeof lineTop === 'number'
        ? Math.round(clamp(timeToY(renderTime) - lineTop, 0, lineHeight))
        : 0;

    ticks.forEach(tick => {
        const start = Number(tick.dataset.start || 0);
        const end = Number(tick.dataset.end || start);

        const tickTop = tick.offsetTop || parseInt(tick.style.top, 10) || 0;
        const tickH = tick.clientHeight || parseFloat(tick.style.height) || 0;

        // Amount of the tick that should be filled equals how much of the main line
        // has been filled within the tick's vertical range.
        const localFill = clamp(elapsedFillPx - (tickTop - lineTop), 0, tickH);

        const fillEl = tick.querySelector('.pour-tick-fill');
        if (fillEl) fillEl.style.height = `${Math.max(0, Math.round(localFill))}px`;
    });
}

// Update which timeline item is active and scroll smoothly
function updateTimelinePosition() {
    const items = document.querySelectorAll('.timeline-item');

    // Calculate desired scroll position (content-space) for the true elapsed time
    const scrollPos = calculateScrollPosition(elapsedTime);

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

    // Derive a single render-time from what is actually centered on screen.
    // This keeps main fill, tick fills, and labels perfectly level while easing.
    const centeredContentY = visualScroll + containerCenter;
    const renderTime = clamp(yToTime(centeredContentY), timelineFirstTime, timelineLastTime);

    // Update timer using renderTime so it matches centered visuals.
    updateTimer(renderTime);

    if (topMessage) topMessage.classList.toggle('visible', isRunning && renderTime < 0);
    if (bottomMessage) bottomMessage.classList.toggle('visible', !isRunning && isCompleted);

    // Highlight only items whose [start,end] contains renderTime
    items.forEach((item) => {
        const start = Number(item.dataset.start || 0);
        const end = Number(item.dataset.end || start);
        const isActive = (renderTime >= start && renderTime <= end);
        item.classList.toggle('active', isActive);
    });

    // Update continuous line fill to show renderTime portion
    if (timelineLine && typeof lineTop === 'number') {
        let elapsedFill = timeToY(renderTime) - lineTop;
        elapsedFill = clamp(elapsedFill, 0, lineHeight);
        timelineLineFill.style.height = `${Math.round(elapsedFill)}px`;
        // overlay stripes should be visible only within the pre-start region (clamp to prePx)
        if (timelineLine && timelineLine._overlay) {
            const maxPre = timelineLine._prePx || 0;
            const overlayH = Math.max(0, Math.min(elapsedFill, maxPre));
            timelineLine._overlay.style.height = `${overlayH}px`;
            timelineLine._overlay.style.opacity = overlayH > 0 ? '1' : '0';
        }

        // Align the TOP of the timer text with the current timeline position (container center)
        if (indicatorContainer) {
            // Center the *container* (with padding + blur) on the centerline.
            const h = indicatorContainer.offsetHeight || 0;
            const scrollOffsetTop = timelineScroll.offsetTop || 0;
            const topPx = Math.round(scrollOffsetTop + containerCenter - h / 2);
            indicatorContainer.style.top = `${topPx}px`;
        }
    }

    // Update pour tick fills
    updatePourTickStates(renderTime);

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
    
    let lastTime = performance.now();
    
    const animationLoop = () => {
        if (!isRunning) return;
        
        const now = performance.now();
        const deltaTime = (now - lastTime) / 1000;
        lastTime = now;
        
        elapsedTime += deltaTime;
        updateTimelinePosition();
        
        // Stop when recipe is complete
        const maxTime = Number.isFinite(recipeEndTime) && recipeEndTime > 0
            ? recipeEndTime
            : (Math.max(...timeline.map(s => s.time)) + 10);
        if (elapsedTime >= maxTime) {
            elapsedTime = maxTime;
            isCompleted = true;
            stopTimer();
            updateTimelinePosition();
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
