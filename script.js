window.onload = function () {
    const timerElement = document.getElementById('timer');
    const countdownElement = document.getElementById('countdown');
    const instructionElement = document.getElementById('instruction');
    const instruction2Element = document.getElementById('instruction2');
    const infoElement = document.getElementById('info');
    const startResetButton = document.getElementById('startResetButton');
    const dropdownContainer = document.getElementById('dropdown-container');

    let recipes;
    let currentRecipe;
    let presetTimes;
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
            const isLastTwoSteps = index >= presetTimes.length - 1;
            const displayText = isLastTwoSteps ? step.instruction : `pour ${step.add}`;

            return `
                <div class="preset-item" id="preset-${index}">
                    ${formatTime(step.time)} - Scale reads ${step.scale} so ${displayText}
                </div>
            `;
        }).join('');
    }

    function updateHighlight(elapsedSeconds) {
        presetTimes.forEach((step, index) => {
            const div = document.getElementById(`preset-${index}`);
            div.classList.remove('highlight', 'completed');
            if (elapsedSeconds >= step.time && elapsedSeconds < (step.time + step.duration)) {
                div.classList.add('highlight');
            } else if (elapsedSeconds >= (step.time + step.duration)) {
                div.classList.add('completed');
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

        const lastStep = presetTimes[presetTimes.length - 1];
        if (elapsedTime >= lastStep.time) {
            clearInterval(intervalId);
            isRunning = false;
            timerElement.textContent = formatTime(lastStep.time);
            countdownElement.textContent = "Completed, enjoy your coffee!";
            instructionElement.textContent = lastStep.instruction;
            instruction2Element.textContent = `Scale: ${lastStep.scale}`;
            startResetButton.textContent = 'Again';
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

        startResetButton.disabled = true;
        startResetButton.textContent = '...';

        const countdownInterval = setInterval(() => {
            if (countdown > 0) {
                instructionElement.textContent = --countdown;
            } else {
                clearInterval(countdownInterval);
                isCountingDown = false;

                startResetButton.disabled = false;
                startResetButton.textContent = 'Reset';

                setTimeout(startMainTimer, 100);
            }
        }, 1000);
    }

    function resetTimer() {
        clearInterval(intervalId);
        timerElement.textContent = "[Elapsed time]";
        countdownElement.textContent = "[Next step]";
        instructionElement.textContent = "Select recipe and tap start";
        instruction2Element.textContent = "[Scale reading]";

        presetTimes.forEach((step, index) => {
            const div = document.getElementById(`preset-${index}`);
            div.classList.remove('highlight', 'completed');
        });

        startResetButton.disabled = false;
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


    fetch('recipes.json')
        .then(response => response.json())
        .then(data => {
            recipes = data;
            currentRecipe = Object.keys(recipes)[0];
            presetTimes = recipes[currentRecipe];
            renderInfo();

            const recipeSelect = document.createElement('select');
            for (const recipeName in recipes) {
                const option = document.createElement('option');
                option.value = recipeName;
                option.text = recipeName;
                recipeSelect.appendChild(option);
            }
            dropdownContainer.appendChild(recipeSelect);

            recipeSelect.addEventListener('change', () => {
                currentRecipe = recipeSelect.value;
                presetTimes = recipes[currentRecipe];
                renderInfo();
                resetTimer();
            });

        })
        .catch(error => {
            console.error('Error loading recipes:', error);
            instructionElement.textContent = "Error loading recipes.";
        });

};