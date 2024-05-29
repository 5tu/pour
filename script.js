window.onload = function () {
    const timerElement = document.getElementById('timer');
    const infoElement = document.getElementById('info');
    const startResetButton = document.getElementById('startResetButton');

    const presetTimes = [
        { time: 0, scale: "000g", add: "100g", finished: "no" },
        { time: 45, scale: "100g", add: "140g", finished: "no" },
        { time: 90, scale: "240g", add: "120g", finished: "no" },
        { time: 135, scale: "360g", add: "120g", finished: "no" },
        { time: 180, scale: "480g", add: "120g", finished: "no" },
        { time: 210, scale: "600g", add: "000g", finished: "yes" }
    ];

    let intervalId;
    let startTime;
    let isRunning = false;

    function formatTime(seconds) {
        const h = String(Math.floor(seconds / 3600)).padStart(2, '0');
        const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
        const s = String(seconds % 60).padStart(2, '0');
        return `${h}:${m}:${s}`;
    }

    function renderInfo() {
        infoElement.innerHTML = '';
        presetTimes.forEach((item, index) => {
            const div = document.createElement('div');
            div.className = 'preset-item';
            div.id = `preset-${index}`;
            div.textContent = `${formatTime(item.time)} → Scale ${item.scale} → Pour ${item.add}`;
            infoElement.appendChild(div);
        });
    }

    function updateHighlight(elapsedSeconds) {
        let currentHighlightIndex = -1;

        for (let i = 0; i < presetTimes.length; i++) {
            if (elapsedSeconds >= presetTimes[i].time) {
                currentHighlightIndex = i;
            }
        }

        presetTimes.forEach((item, index) => {
            const div = document.getElementById(`preset-${index}`);
            if (index === currentHighlightIndex) {
                div.classList.add('highlight');
                if (item.finished === "yes") {
                    clearInterval(intervalId);
                    div.textContent = "Finished";
                    isRunning = false;
                    startResetButton.textContent = 'Start';
                }
            } else {
                div.classList.remove('highlight');
                div.textContent = `${formatTime(item.time)} → Scale ${item.scale} → Pour ${item.add}`;
            }
        });
    }

    function updateTimer() {
        const elapsedTime = Math.floor((Date.now() - startTime) / 1000);
        timerElement.textContent = formatTime(elapsedTime);
        updateHighlight(elapsedTime);
    }

    function startTimer() {
        startTime = Date.now();
        intervalId = setInterval(updateTimer, 1000);
        startResetButton.textContent = 'Reset';
        isRunning = true;
    }

    function resetTimer() {
        clearInterval(intervalId);
        timerElement.textContent = '00:00:00';
        presetTimes.forEach((item, index) => {
            const div = document.getElementById(`preset-${index}`);
            div.classList.remove('highlight');
            div.textContent = `${formatTime(item.time)} → Scale ${item.scale} → Pour ${item.add}`;
        });
        startResetButton.textContent = 'Start';
        isRunning = false;
    }

    startResetButton.addEventListener('click', () => {
        if (isRunning) {
            resetTimer();
        } else {
            startTimer();
        }
    });

    renderInfo();  // Initial render of the info display
};
