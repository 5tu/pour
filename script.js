window.onload = function () {
    const timerElement = document.getElementById('timer');
    const countdownElement = document.getElementById('countdown');
    const instructionElement = document.getElementById('instruction');
    const instruction2Element = document.getElementById('instruction2');
    const infoElement = document.getElementById('info');
    const startResetButton = document.getElementById('startResetButton');

    const presetTimes = [
        { time: 0, scale: "000g", add: "100g", duration: 10, instruction: "Pour 100g of water", finished: "no" },
        { time: 45, scale: "100g", add: "140g", duration: 10, instruction: "Pour 140g of water", finished: "no" },
        { time: 90, scale: "240g", add: "120g", duration: 10, instruction: "Pour 120g of water", finished: "no" },
        { time: 135, scale: "360g", add: "120g", duration: 10, instruction: "Pour 120g of water", finished: "no" },
        { time: 180, scale: "480g", add: "120g", duration: 10, instruction: "Pour 120g of water", finished: "no" },
        { time: 210, scale: "600g", add: "000g", duration: 0, instruction: "", finished: "yes" }
    ];

    let intervalId;
    let startTime;
    let isRunning = false;
    let isCountingDown = false;
    let currentInstructionTimeout;
    let countdownTimeouts = [];
    let resetButtonEnabled = false;

    function formatTime(seconds) {
        const h = String(Math.floor(seconds / 3600)).padStart(2, '0');
        const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
        const s = String(seconds % 60).padStart(2, '0');
        return `${h}:${m}:${s}`;
    }

    function updateCountdown(elapsedSeconds) {
        let nextStepIndex = -1;

        for (let i = 0; i < presetTimes.length; i++) {
            if (elapsedSeconds < presetTimes[i].time) {
                nextStepIndex = i;
                break;
            }
        }

        if (nextStepIndex !== -1) {
            let timeRemaining = presetTimes[nextStepIndex].time - elapsedSeconds;
            countdownElement.textContent = "Next step: " + formatTime(timeRemaining);
        }
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
            if (index === currentHighlightIndex && index !== presetTimes.length - 1) {
                div.classList.add('highlight');
            } else {
                div.classList.remove('highlight');
            }
        });

        if (currentHighlightIndex === presetTimes.length - 1) {
            timerElement.textContent = "Finished";
            countdownElement.textContent = "Enjoy your coffee!";
            clearInterval(intervalId);
            isRunning = false;
            startResetButton.textContent = 'Start';
        }
    }

    function updateInstruction(elapsedSeconds) {
        if (currentInstructionTimeout) {
            clearTimeout(currentInstructionTimeout);
        }
    
        const currentStepIndex = presetTimes.findIndex(step => elapsedSeconds >= step.time && elapsedSeconds < step.time + step.duration);
        const nextStepIndex = presetTimes.findIndex(step => elapsedSeconds < step.time);
    
        if (currentStepIndex !== -1) {
            const currentStep = presetTimes[currentStepIndex];
            instructionElement.textContent = currentStep.instruction;
    
            currentInstructionTimeout = setTimeout(() => {
                instructionElement.textContent = "Wait";
            }, currentStep.duration * 1000);
        } else if (nextStepIndex !== -1 && (presetTimes[nextStepIndex].time - elapsedSeconds) <= 5) {
            instructionElement.textContent = "Get ready";
        } else {
            instructionElement.textContent = "Wait";
        }
    
        let runningTotal = 0;
        presetTimes.forEach((step, index) => {
            if (elapsedSeconds >= step.time) {
                runningTotal += parseInt(step.add);
            }
        });
        instruction2Element.textContent = `Scale: ${runningTotal}g`;
    }

    function updateTimers() {
        const elapsedTime = Math.floor((Date.now() - startTime) / 1000);
        timerElement.textContent = formatTime(elapsedTime);
        updateHighlight(elapsedTime);
        updateCountdown(elapsedTime);
        updateInstruction(elapsedTime);

        if (!resetButtonEnabled && Date.now() - startTime >= 250) {
            resetButtonEnabled = true;
            startResetButton.textContent = 'Reset';
        }
    }

    function startMainTimer() {
        startTime = Date.now();
        intervalId = setInterval(updateTimers, 1000);
        isRunning = true;
    }

    function startCountdown() {
        let countdown = 5;
        instructionElement.textContent = countdown;
        isCountingDown = true;
        startResetButton.textContent = 'Stop';

        for (let i = 0; i <= 5; i++) {
            countdownTimeouts.push(setTimeout(() => {
                if (countdown > 0) {
                    instructionElement.textContent = countdown;
                    countdown--;
                } else {
                    startMainTimer();
                    isCountingDown = false;
                }
            }, i * 1000));
        }
    }

    function startTimer() {
        startCountdown();
    }

    function resetTimer() {
        clearInterval(intervalId);
        clearTimeout(currentInstructionTimeout);
        countdownTimeouts.forEach(timeout => clearTimeout(timeout));
        countdownTimeouts = [];
        timerElement.textContent = "[Elapsed]";
        countdownElement.textContent = "[Next step]";
        instructionElement.textContent = "Press 'Start' to begin";
        instruction2Element.textContent = "[Scale]";
        presetTimes.forEach((item, index) => {
            const div = document.getElementById(`preset-${index}`);
            div.classList.remove('highlight');
            div.textContent = `${formatTime(item.time)} → Scale ${item.scale} → Pour ${item.add}`;
        });
        startResetButton.textContent = 'Start';
        resetButtonEnabled = false;
        isRunning = false;
        isCountingDown = false;
    }

    startResetButton.addEventListener('click', () => {
        if (isRunning || isCountingDown) {
            resetTimer();
        } else {
            startTimer();
        }
    });

    renderInfo();
};
