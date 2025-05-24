const apiKeyInput = document.getElementById('apiKey');
const userProfileTextarea = document.getElementById('userProfile');
const saveButton = document.getElementById('saveButton');
const statusMessage = document.getElementById('statusMessage');

// Load saved settings
document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.local.get(['openaiApiKey', 'userProfile'], (result) => {
        if (result.openaiApiKey) {
            apiKeyInput.value = result.openaiApiKey;
        }
        if (result.userProfile) {
            userProfileTextarea.value = result.userProfile;
        }
    });
});

saveButton.addEventListener('click', () => {
    const apiKey = apiKeyInput.value.trim();
    const userProfile = userProfileTextarea.value.trim();

    if (!apiKey) {
        statusMessage.textContent = 'Error: OpenAI API Key cannot be empty.';
        statusMessage.style.color = 'red';
        return;
    }
    if (!userProfile) {
        statusMessage.textContent = 'Error: User Profile cannot be empty.';
        statusMessage.style.color = 'red';
        return;
    }

    chrome.storage.local.set({
        openaiApiKey: apiKey,
        userProfile: userProfile
    }, () => {
        if (chrome.runtime.lastError) {
            statusMessage.textContent = `Error saving settings: ${chrome.runtime.lastError.message}`;
            statusMessage.style.color = 'red';
        } else {
            statusMessage.textContent = 'Settings saved successfully!';
            statusMessage.style.color = 'green';
            setTimeout(() => { statusMessage.textContent = ''; }, 3000);
        }
    });
});