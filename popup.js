const startStopButton = document.getElementById('startStopButton');
const statusDisplay = document.getElementById('statusDisplay');
const sentCounter = document.getElementById('sentCounter');
const skippedCounter = document.getElementById('skippedCounter');
const optionsLink = document.getElementById('optionsLink');

let isRunning = false;

// Initial button state based on stored state (if any)
chrome.storage.local.get(['automationRunning'], (result) => {
    if (result.automationRunning) {
        isRunning = true;
        startStopButton.textContent = 'Stop Automation';
        startStopButton.classList.add('stop');
        statusDisplay.value = "Automation is active. Restore state if needed.";
    } else {
        isRunning = false;
        startStopButton.textContent = 'Start Automation';
        startStopButton.classList.remove('stop');
    }
});
// Update counters on popup open
chrome.storage.local.get(['sentCount', 'skippedCount'], (result) => {
    sentCounter.textContent = result.sentCount || 0;
    skippedCounter.textContent = result.skippedCount || 0;
});


startStopButton.addEventListener('click', async () => {
    if (isRunning) {
        chrome.runtime.sendMessage({ type: "STOP_AUTOMATION" }, (response) => {
            if (chrome.runtime.lastError) {
                statusDisplay.value = `Error stopping: ${chrome.runtime.lastError.message}`;
                return;
            }
            if (response && response.status === "stopped") {
                statusDisplay.value = "Automation stopping...";
                startStopButton.textContent = 'Start Automation';
                startStopButton.classList.remove('stop');
                isRunning = false;
                chrome.storage.local.set({ automationRunning: false });
            }
        });
    } else {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.url && tab.url.includes("hellowork.com")) {
            chrome.runtime.sendMessage({ type: "START_AUTOMATION", tabId: tab.id }, (response) => {
                if (chrome.runtime.lastError) {
                    statusDisplay.value = `Error starting: ${chrome.runtime.lastError.message}`;
                    return;
                }
                if (response && response.status === "started") {
                    statusDisplay.value = "Automation started on Hello Work page.";
                    startStopButton.textContent = 'Stop Automation';
                    startStopButton.classList.add('stop');
                    isRunning = true;
                    chrome.storage.local.set({ automationRunning: true });
                } else if (response && response.status === "already_running") {
                    statusDisplay.value = "Automation is already running.";
                    startStopButton.textContent = 'Stop Automation';
                    startStopButton.classList.add('stop');
                    isRunning = true;
                } else {
                    statusDisplay.value = "Could not start. Ensure you are on a Hello Work search results page.";
                }
            });
        } else {
            statusDisplay.value = "Please navigate to a Hello Work job search results page first.";
        }
    }
});

optionsLink.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "UPDATE_STATUS") {
        if (message.message) {
            statusDisplay.value = `${new Date().toLocaleTimeString()}: ${message.message}\n` + statusDisplay.value;
        }
        if (message.sent !== undefined) {
            sentCounter.textContent = message.sent;
        }
        if (message.skipped !== undefined) {
            skippedCounter.textContent = message.skipped;
        }
        if(message.error) {
             statusDisplay.value = `${new Date().toLocaleTimeString()}: ERROR: ${message.error}\n` + statusDisplay.value;
        }
        if (message.done) {
            startStopButton.textContent = 'Start Automation';
            startStopButton.classList.remove('stop');
            isRunning = false;
            chrome.storage.local.set({ automationRunning: false });
        }
    }
});