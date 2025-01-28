window.onload = function () {
    const timerElement = document.getElementById('timer');
    const countdownElement = document.getElementById('countdown');
    const instructionElement = document.getElementById('instruction');
    const instruction2Element = document.getElementById('instruction2');
    const infoElement = document.getElementById('info');
    const startResetButton = document.getElementById('startResetButton');
    const dropdownContainer = document.getElementById('dropdown-container'); // New container for the dropdown

    const recipes = {
        "40g for 600g": [
            { time: 0, scale: "000g", add: "100g", duration: 10, instruction: "Pour 100g of water" },
            { time: 45, scale: "100g", add: "140g", duration: 10, instruction: "Pour 140g of water" },
            { time: 90, scale: "240g", add: "120g", duration: 10, instruction: "Pour 120g of water" },
            { time: 135, scale: "360g", add: "120g", duration: 10, instruction: "Pour 120g of water" },
            { time: 180, scale: "480g", add: "120g", duration: 10, instruction: "Pour 120g of water" },
            { time: 210, scale: "600g", add: "000g", duration: 30, instruction: "Drawing through" },
            { time: 240, scale: "600g", add: "000g", duration: 30, instruction: "Remove V60" }
        ],
        "20g for 300g": [
            { time: 0, scale: "000g", add: "050g", duration: 10, instruction: "Pour 050g of water" },
            { time: 45, scale: "050g", add: "070g", duration: 10, instruction: "Pour 070g of water" },
            { time: 90, scale: "126g", add: "060g", duration: 10, instruction: "Pour 060g of water" },
            { time: 135, scale: "180g", add: "060g", duration: 10, instruction: "Pour 060g of water" },
            { time: 180, scale: "240g", add: "060g", duration: 10, instruction: "Pour 060g of water" },
            { time: 210, scale: "300g", add: "000g", duration: 30, instruction: "Drawing through" },
            { time: 240, scale: "300g", add: "000g", duration: 30, instruction: "Remove V60" }
        ],
    };

    let currentRecipe = "40g for 600g";
    let presetTimes = recipes[currentRecipe];

    let intervalId;
    let startTime;
    let isRunning = false;
    let isCountingDown = false;
    let resetButtonEnabled = false;

    function formatTime(seconds) {
        const h = String(Math.floor(seconds / 3600)).padStart(2, '0');
        const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
        const s = String(seconds % 60).padStart(2, '0');
        return `${h}:${m}:${s}`;
    }

    function updateCountdown(elapsedSeconds) {
        const nextStep = presetTimes.find(step => elapsedSeconds < step.time);
        if (nextStep) {
            const timeRemaining = nextStep.time - elapsedSeconds;
            countdownElement.textContent = `Next step: ${formatTime(timeRemaining)}`;
        } else {
            countdownElement.textContent = "No more steps";
        }
    }

    function renderInfo() {
        infoElement.innerHTML = presetTimes.map((step, index) => {
            // Check if the step is one of the last two steps
            const isLastTwoSteps = index >= presetTimes.length - 2;
            // Display the instruction instead of the 'add' value for the last two steps
            const displayText = isLastTwoSteps ? step.instruction : `Pour ${step.add}`;

            return `
                <div class="preset-item" id="preset-${index}">
                    ${formatTime(step.time)} → Scale ${step.scale} → ${displayText}
                </div>
            `;
        }).join('');
    }

    function updateHighlight(elapsedSeconds) {
        presetTimes.forEach((step, index) => {
            const div = document.getElementById(`preset-${index}`);
            if (elapsedSeconds >= step.time && elapsedSeconds < (step.time + step.duration)) {
                div.classList.add('highlight');
            } else {
                div.classList.remove('highlight');
            }
        });
    }

    function updateInstruction(elapsedSeconds) {
        const currentStep = presetTimes.find(step => elapsedSeconds >= step.time && elapsedSeconds < (step.time + step.duration));
        const nextStep = presetTimes.find(step => elapsedSeconds < step.time);

        if (currentStep) {
            instructionElement.textContent = currentStep.instruction;
        } else if (nextStep && (nextStep.time - elapsedSeconds) <= 5) {
            instructionElement.textContent = "Get ready";
        } else {
            instructionElement.textContent = "Wait";
        }

        const runningTotal = presetTimes.reduce((total, step) => elapsedSeconds >= step.time ? total + parseInt(step.add) : total, 0);
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

        if (elapsedTime >= presetTimes[presetTimes.length - 1].time) {
            clearInterval(intervalId);
            isRunning = false;
            timerElement.textContent = "Finished";
            countdownElement.textContent = "All steps completed!";
            startResetButton.textContent = 'Start';
        }
    }

    function startMainTimer() {
        startTime = Date.now();
        updateTimers();
        intervalId = setInterval(updateTimers, 1000);
        isRunning = true;
    }

    function startCountdown() {
        let countdown = 5;
        instructionElement.textContent = countdown;
        isCountingDown = true;
        startResetButton.textContent = 'Stop';

        const countdownInterval = setInterval(() => {
            instructionElement.textContent = --countdown || "Go!";
            if (countdown < 0) {
                clearInterval(countdownInterval);
                isCountingDown = false;
                setTimeout(startMainTimer, 100);
            }
        }, 1000);
    }

    function resetTimer() {
        clearInterval(intervalId);
        timerElement.textContent = "[Elapsed]";
        countdownElement.textContent = "[Next step]";
        instructionElement.textContent = "Select recipe and tap start";
        instruction2Element.textContent = "[Scale]";
        presetTimes.forEach((step, index) => {
            const div = document.getElementById(`preset-${index}`);
            div.classList.remove('highlight');
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
            startCountdown();
        }
    });

    // Recipe selection dropdown
    const recipeSelect = document.createElement('select');
    for (const recipeName in recipes) {
        const option = document.createElement('option');
        option.value = recipeName;
        option.text = recipeName;
        recipeSelect.appendChild(option);
    }
    dropdownContainer.appendChild(recipeSelect); // Insert dropdown into the dropdown container

    recipeSelect.addEventListener('change', () => {
        currentRecipe = recipeSelect.value;
        presetTimes = recipes[currentRecipe];
        renderInfo();
        resetTimer();
    });

    renderInfo();
};