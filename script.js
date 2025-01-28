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
            { time: 0, scale: "0g", add: "100g", duration: 10, instruction: "Pour 100g water" },
            { time: 45, scale: "100g", add: "140g", duration: 10, instruction: "Pour 140g water" },
            { time: 90, scale: "240g", add: "120g", duration: 10, instruction: "Pour 120g water" },
            { time: 135, scale: "360g", add: "120g", duration: 10, instruction: "Pour 120g water" },
            { time: 180, scale: "480g", add: "120g", duration: 10, instruction: "Pour 120g water" },
            { time: 210, scale: "600g", add: "0g", duration: 0, instruction: "Remove V60" }
        ],
        "20g for 300g": [
            { time: 0, scale: "0g", add: "50g", duration: 10, instruction: "Pour 50g water" },
            { time: 45, scale: "50g", add: "70g", duration: 10, instruction: "Pour 70g water" },
            { time: 90, scale: "126g", add: "60g", duration: 10, instruction: "Pour 60g water" },
            { time: 135, scale: "180g", add: "60g", duration: 10, instruction: "Pour 60g water" },
            { time: 180, scale: "240g", add: "60g", duration: 10, instruction: "Pour 60g water" },
            { time: 210, scale: "300g", add: "0g", duration: 0, instruction: "Remove V60" }
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
            const isLastTwoSteps = index >= presetTimes.length - 1;
            // Display the instruction instead of the 'add' value for the last two steps
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
    
            // Remove both classes initially
            div.classList.remove('highlight', 'completed');
    
            // Check if the step is currently active
            if (elapsedSeconds >= step.time && elapsedSeconds < (step.time + step.duration)) {
                div.classList.add('highlight'); // Add highlight for the active step
            }
            // Check if the step has been completed
            else if (elapsedSeconds >= (step.time + step.duration)) {
                div.classList.add('completed'); // Add completed for finished steps
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
    
        // Check if the elapsed time has reached the last step
        const lastStep = presetTimes[presetTimes.length - 1];
        if (elapsedTime >= lastStep.time) {
            clearInterval(intervalId); // Stop the timer
            isRunning = false;
    
            // Update the UI to show the final state
            timerElement.textContent = formatTime(lastStep.time); // Show the final time
            countdownElement.textContent = "All steps completed!";
            instructionElement.textContent = lastStep.instruction; // Keep the last instruction on screen
            instruction2Element.textContent = `Scale: ${lastStep.scale}`; // Show the final scale value
    
            // Optionally, disable the reset button or change its text
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
    
        // Remove the highlight class from all steps
        presetTimes.forEach((step, index) => {
            const div = document.getElementById(`preset-${index}`);
            div.classList.remove('highlight'); // Only remove the highlight class
        });
    
        // Reset button state
        startResetButton.disabled = false; // Re-enable the button
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