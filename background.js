// background.js

let isAutomationRunning = false;
let currentSearchTabId = null;
let jobQueue = [];
let counters = {
    sent: 0,
    skipped: 0, 
    errors: 0   
};
let userApiKey = '';
let userProfile = '';
let currentJobTabId = null;
let activeJobProcessingTimeout = null;

const JOB_STEP_TIMEOUT_MS = 30000; // Reverted to 30 seconds

function clearJobStepTimeout() {
    if (activeJobProcessingTimeout) {
        clearTimeout(activeJobProcessingTimeout);
        activeJobProcessingTimeout = null;
    }
}

function setJobStepTimeout(itemIdentifier, stepName) {
    clearJobStepTimeout();
    activeJobProcessingTimeout = setTimeout(() => {
        if (!isAutomationRunning) return;
        const identifier = typeof itemIdentifier === 'number' ? `tab ${itemIdentifier}` : itemIdentifier;
        console.error(`Background: Timeout occurred for ${identifier} at step: ${stepName}`);
        updatePopupStatus(`Timeout processing ${identifier} (step: ${stepName}). Skipping/Stopping.`, "Job Step Timeout");
        counters.errors++;
        updatePopupStatus(null);

        if (currentJobTabId && (itemIdentifier === (jobQueue[0]?.url || currentJobTabId) || itemIdentifier === currentJobTabId)) {
            console.log(`Background: Leaving tab ${currentJobTabId} open for inspection due to timeout on job.`);
            currentJobTabId = null;
            processNextJob();
        } else if (itemIdentifier === currentSearchTabId && stepName.includes("SearchPage")) {
            stopAutomation("timeout_search_page_operations");
        } else {
            if (isAutomationRunning) processNextJob();
        }
    }, JOB_STEP_TIMEOUT_MS);
}

async function loadUserSettings() {
    try {
        const settings = await chrome.storage.local.get(['openaiApiKey', 'userProfile', 'sentCount', 'skippedCount']);
        userApiKey = settings.openaiApiKey;
        userProfile = settings.userProfile;
        counters.sent = settings.sentCount || 0;
        counters.skipped = settings.skippedCount || 0; 
        counters.errors = 0; 
        console.log("Background: User settings loaded.", userApiKey ? "API Key Present" : "API Key MISSING", userProfile ? "Profile Present" : "Profile MISSING");
    } catch (e) {
        console.error("Background: Error loading user settings:", e);
        updatePopupStatus("Error loading settings. Check console.", "Settings Load Error");
    }
}

function updatePopupStatus(message, error = null) {
    const statusUpdate = {
        type: "UPDATE_STATUS",
        message: message,
        sent: counters.sent,
        skipped: (counters.skipped || 0) + counters.errors
    };
    if (error) {
        statusUpdate.error = error;
        console.error(`Background Status Update (Error): ${error} - ${message || ''}`);
    } else if (message) {
        console.log(`Background Status Update: ${message}`);
    }
    chrome.runtime.sendMessage(statusUpdate).catch(e => {
        if (e.message !== "Could not establish connection. Receiving end does not exist." &&
            !e.message.includes("The message port closed before a response was received.")) {
            // console.warn("Background: Popup not open or error sending message:", e.message);
        }
    });
}

async function startAutomation(tabId) {
    console.log("Background: START_AUTOMATION received for tabId:", tabId);
    if (isAutomationRunning) {
        updatePopupStatus("Automation is already running.");
        return { status: "already_running" };
    }

    await loadUserSettings(); 
    if (!userApiKey || !userProfile) {
        updatePopupStatus("OpenAI API Key or User Profile not set in options. Please configure them.", "Configuration Missing");
        chrome.runtime.openOptionsPage();
        return { status: "config_missing" };
    }

    isAutomationRunning = true;
    currentSearchTabId = tabId;
    jobQueue = [];
    chrome.storage.local.set({
        automationRunning: true,
    });

    updatePopupStatus(`Automation started. Initializing scan on current page...`);
    processSearchPage();
    return { status: "started" };
}

function stopAutomation(reason = "user_request") {
    console.log(`Background: STOP_AUTOMATION called. Reason: ${reason}`);
    isAutomationRunning = false;
    clearJobStepTimeout();

    if (reason !== "job_error_tab_left_open") { 
        currentJobTabId = null;
    }
    jobQueue = [];
    const finalMessage = reason === "user_request" ? "Automation stopped by user." : `Automation stopped: ${reason}`;
    updatePopupStatus(finalMessage);
    chrome.storage.local.set({ automationRunning: false });
    chrome.runtime.sendMessage({
        type: "UPDATE_STATUS",
        done: true,
        sent: counters.sent,
        skipped: (counters.skipped || 0) + counters.errors
    }).catch(e => console.warn("Background: Error sending 'done' message to popup:", e.message));
    return { status: "stopped" };
}

async function processSearchPage() {
    console.log("Background: processSearchPage called for tabId:", currentSearchTabId);
    if (!isAutomationRunning || !currentSearchTabId) {
        if (isAutomationRunning) {
            updatePopupStatus("Search tab ID lost or invalid. Stopping.", "Tab Error");
        }
        stopAutomation("search_tab_issue");
        return;
    }

    setJobStepTimeout(currentSearchTabId, "processSearchPage_inject");
    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId: currentSearchTabId },
            files: ['content_script.js']
        });
        clearJobStepTimeout();

        if (results && results[0] && results[0].result && results[0].result.includes("_injected")) {
            console.log(`Background: Content script injected successfully into search tab ${currentSearchTabId}. Result: ${results[0].result}. Sending EXTRACT_JOB_LISTINGS.`);
            updatePopupStatus("Content script active on search page. Scanning for jobs...");
            setJobStepTimeout(currentSearchTabId, "processSearchPage_extractListings");
            chrome.tabs.sendMessage(currentSearchTabId, { type: "EXTRACT_JOB_LISTINGS" })
                .catch(e => {
                    clearJobStepTimeout();
                    console.error("Background: Error sending EXTRACT_JOB_LISTINGS to search page:", e);
                    updatePopupStatus("Error communicating with search page script. Stopping.", "Script Communication Error");
                    stopAutomation("script_comm_error_search_extract");
                });
        } else {
            console.error("Background: Failed to inject script or get expected result from search page. Result:", results);
            updatePopupStatus("Failed to activate script on Hello Work search page. Ensure it's a valid job search page and check console logs in the tab.", "Injection Failed");
            stopAutomation("injection_failure_search");
        }
    } catch (e) {
        clearJobStepTimeout();
        updatePopupStatus(`Error injecting script to search page: ${e.message}. Stopping.`, "Injection Error");
        console.error("Background: Script injection error on search page:", e);
        stopAutomation("injection_exception_search");
    }
}

async function openAndProcessJobTab(job) {
    console.log(`Background: Opening job tab for: ${job.title} - ${job.url}`);
    setJobStepTimeout(job.url, "openAndProcessJobTab_create");
    try {
        const tab = await chrome.tabs.create({ url: job.url, active: true });
        currentJobTabId = tab.id;
        clearJobStepTimeout();
        console.log(`Background: Job tab created with ID: ${currentJobTabId} for URL: ${job.url}`);

        const tabUpdateListener = async (tabId, changeInfo, updatedTab) => {
            if (tabId === currentJobTabId && changeInfo.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(tabUpdateListener);
                console.log(`Background: Job tab ${currentJobTabId} loaded completely. Injecting script.`);
                setJobStepTimeout(job.url, "openAndProcessJobTab_injectJobPage");

                try {
                    const injectionResults = await chrome.scripting.executeScript({
                        target: { tabId: currentJobTabId },
                        files: ['content_script.js']
                    });
                    clearJobStepTimeout();

                    if (injectionResults && injectionResults[0] && injectionResults[0].result && injectionResults[0].result.includes("_injected")) {
                        console.log(`Background: Content script injected into job tab ${currentJobTabId}. Result: ${injectionResults[0].result}. Sending PROCESS_JOB_PAGE_DETAILS.`);
                        updatePopupStatus(`Analyzing job page: ${job.title}`);
                        setJobStepTimeout(job.url, "openAndProcessJobTab_processDetails"); 
                        chrome.tabs.sendMessage(currentJobTabId, { type: "PROCESS_JOB_PAGE_DETAILS", jobUrl: job.url })
                            .catch(e => {
                                clearJobStepTimeout();
                                console.error(`Background: Error sending PROCESS_JOB_PAGE_DETAILS to job tab ${currentJobTabId}:`, e);
                                updatePopupStatus(`Error communicating with job page script for ${job.url}. Skipping.`, "Script Communication Error");
                                counters.errors++;
                                currentJobTabId = null;
                                processNextJob();
                            });
                    } else {
                        console.error(`Background: Failed to inject script into job page ${job.url}. Result:`, injectionResults);
                        updatePopupStatus(`Failed to activate script on job page: ${job.url}. Skipping.`, `Injection Error`);
                        counters.errors++;
                        currentJobTabId = null;
                        processNextJob();
                    }
                } catch (e) {
                    clearJobStepTimeout();
                    console.error(`Background: Error injecting script into job page ${job.url} (executeScript stage):`, e);
                    updatePopupStatus(`Error injecting script into job page ${job.url}: ${e.message}. Skipping.`, "Injection Exception");
                    counters.errors++;
                    currentJobTabId = null;
                    processNextJob();
                }
            }
        };
        chrome.tabs.onUpdated.addListener(tabUpdateListener);

    } catch (e) {
        clearJobStepTimeout();
        updatePopupStatus(`Error opening job tab for ${job.url}: ${e.message}. Skipping.`, `Tab Creation Error`);
        console.error(`Background: Error creating tab for ${job.url}:`, e);
        counters.errors++;
        currentJobTabId = null;
        processNextJob();
    }
}

async function processNextJob() {
    clearJobStepTimeout();
    if (!isAutomationRunning) {
        console.log("Background: processNextJob called, but automation is not running.");
        if (jobQueue.length > 0) updatePopupStatus("Automation stopped, jobs remaining in queue.");
        return;
    }

    if (jobQueue.length === 0) {
        updatePopupStatus("Job queue is empty. Waiting for search page to report pagination or completion.");
        console.log("Background: Job queue empty. Awaiting signal from search page CS.");
        setJobStepTimeout(currentSearchTabId, "processNextJob_waitForPaginationSignal");
        return;
    }

    const job = jobQueue.shift();
    console.log(`Background: Processing next job from queue: ${job.title} - ${job.url}. Queue size: ${jobQueue.length}`);
    updatePopupStatus(`Opening job: ${job.title || job.url}`);
    await openAndProcessJobTab(job);
}

async function generateCoverLetter(jobDescriptionText, jobUrl) {
    console.log(`Background: Generating cover letter for ${jobUrl}. Description length: ${jobDescriptionText.length}`);
    if (!userApiKey) {
        updatePopupStatus("OpenAI API Key not found. Cannot generate cover letter.", "API Key Missing");
        return null;
    }
    updatePopupStatus(`Generating cover letter for ${jobUrl}...`);
    setJobStepTimeout(jobUrl, "generateCoverLetter_apiCall");

    try {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${userApiKey}`
            },
            body: JSON.stringify({
                model: "gpt-4-turbo",
                messages: [
                    {
                        role: "system",
                        content: "You are an expert career assistant. Your task is to write a professional, specific, and concise cover letter in French. The cover letter must not exceed 2000 characters. It should be written as a complete text, without any placeholders for the user to fill in. It must sound natural and human-written."
                    },
                    {
                        role: "user",
                        content: `Based on my professional profile below, write a tailored cover letter for the job description that follows.\n\n### My Profile:\n${userProfile}\n\n### Job Description:\n${jobDescriptionText}`
                    }
                ],
                max_tokens: 700,
                temperature: 0.7
            })
        });
        clearJobStepTimeout();

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: { message: "Unknown error structure from OpenAI" } }));
            console.error("Background: OpenAI API Error:", response.status, response.statusText, errorData);
            throw new Error(`OpenAI API Error: ${response.status} ${response.statusText} - ${errorData.error?.message || 'Failed to parse error response'}`);
        }

        const data = await response.json();
        if (data.choices && data.choices.length > 0 && data.choices[0].message && data.choices[0].message.content) {
            updatePopupStatus(`Cover letter generated for ${jobUrl}.`);
            return data.choices[0].message.content;
        } else {
            console.error("Background: No valid response choices from OpenAI:", data);
            throw new Error("No response choices or content from OpenAI.");
        }
    } catch (error) {
        clearJobStepTimeout();
        updatePopupStatus(`Failed to generate cover letter for ${jobUrl}: ${error.message}. Skipping application.`, "OpenAI API Error");
        console.error(`Background: OpenAI API call failed for ${jobUrl}:`, error);
        return null;
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
        if (!isAutomationRunning && !["START_AUTOMATION", "STOP_AUTOMATION"].includes(message.type) && sender.tab) {
            if (typeof sendResponse === 'function') sendResponse({ status: "ignored_automation_off" });
            return; 
        }

        switch (message.type) {
            case "START_AUTOMATION":
                const startResponse = await startAutomation(message.tabId);
                if (typeof sendResponse === 'function') sendResponse(startResponse);
                break;

            case "STOP_AUTOMATION":
                const stopResponse = stopAutomation("user_request_popup");
                if (typeof sendResponse === 'function') sendResponse(stopResponse);
                break;

            case "JOB_LISTINGS_DATA":
                clearJobStepTimeout();
                if (!isAutomationRunning) break;
                console.log(`Background: Received JOB_LISTINGS_DATA. Found ${message.jobs.length} jobs. HasNextPage: ${message.hasNextPage}`);
                jobQueue = jobQueue.concat(message.jobs);
                updatePopupStatus(`Found ${message.jobs.length} jobs on page. Total in queue: ${jobQueue.length}`);

                if (jobQueue.length > 0) {
                    processNextJob();
                } else if (message.hasNextPage) {
                    updatePopupStatus("No new jobs found on this page, but a next page exists. Clicking next...");
                    setJobStepTimeout(currentSearchTabId, "job_listings_data_click_next");
                    chrome.tabs.sendMessage(currentSearchTabId, { type: "CLICK_NEXT_PAGE" })
                        .catch(e => {
                            clearJobStepTimeout();
                            console.error("Background: Error sending CLICK_NEXT_PAGE from JOB_LISTINGS_DATA:", e);
                            stopAutomation("script_comm_error_nextpage");
                        });
                } else {
                    updatePopupStatus("No new jobs found and no more pages. Automation complete.");
                    stopAutomation("all_jobs_processed_no_next_page");
                }
                break;

            case "JOB_PAGE_INFO": 
                clearJobStepTimeout(); 
                if (!isAutomationRunning || !currentJobTabId || (sender.tab && sender.tab.id !== currentJobTabId)) {
                    console.warn("Background: JOB_PAGE_INFO received for inactive/mismatched tab or automation stopped. Ignoring.");
                    break;
                }

                if (message.isExternal || message.isEffectivelyExternal || message.error) {
                    let reason = message.error || (message.isExternal ? "Explicit external link." : "Treated as unfillable/external.");
                    updatePopupStatus(`Skipping job: ${message.jobUrl}. Reason: ${reason}`);
                    console.log(`Background: Skipping job ${message.jobUrl}. Reason: ${reason}`);
                    if (message.isExternal) counters.skipped++; else counters.errors++; 
                    chrome.storage.local.set({ skippedCount: counters.skipped }); 
                    currentJobTabId = null; 
                    processNextJob();
                } else { 
                    updatePopupStatus(`Extracted job description for: ${message.jobUrl}.`);
                    const coverLetter = await generateCoverLetter(message.jobDescription, message.jobUrl);

                    if (!isAutomationRunning || !currentJobTabId) {
                        console.log("Background: Automation stopped or job tab changed during/after cover letter. Not submitting.");
                        if (currentJobTabId) { /* Tab left open */ }
                        currentJobTabId = null;
                        if (isAutomationRunning && jobQueue.length > 0) processNextJob();
                        else if (isAutomationRunning) stopAutomation("state_change_during_ai");
                        break;
                    }

                    if (coverLetter) {
                        updatePopupStatus(`Cover letter generated. Filling application for ${message.jobUrl}...`);
                        setJobStepTimeout(message.jobUrl, "job_page_info_fill_submit");
                        chrome.tabs.sendMessage(currentJobTabId, { type: "FILL_AND_SUBMIT_APPLICATION", coverLetter: coverLetter, jobUrl: message.jobUrl })
                            .catch(e => {
                                clearJobStepTimeout();
                                console.error(`Background: Error sending FILL_AND_SUBMIT to job tab ${currentJobTabId}:`, e);
                                updatePopupStatus(`Error communicating to fill form for ${message.jobUrl}. Skipping.`, "Script Comm Error");
                                counters.errors++;
                                currentJobTabId = null; 
                                processNextJob();
                            });
                    } else { 
                        updatePopupStatus(`Skipping application for ${message.jobUrl} due to cover letter failure.`);
                        counters.errors++;
                        currentJobTabId = null; 
                        processNextJob();
                    }
                }
                break;

            case "APPLICATION_RESULT":
                clearJobStepTimeout();
                 if (!isAutomationRunning || !currentJobTabId || (sender.tab && sender.tab.id !== currentJobTabId)) {
                    console.warn("Background: APPLICATION_RESULT received for inactive/mismatched tab or automation stopped. Ignoring.");
                    break;
                }

                if (message.status === "success") {
                    updatePopupStatus(`Successfully applied to: ${message.jobUrl}`);
                    counters.sent++;
                    chrome.storage.local.set({ sentCount: counters.sent });
                    chrome.tabs.remove(currentJobTabId).catch(e => console.warn("Background: Error closing successful job tab:", e));
                } else {
                    updatePopupStatus(`Error applying to ${message.jobUrl}: ${message.errorMessage || 'Unknown app error'}. Tab left open.`, "Application Error");
                    counters.errors++;
                }
                currentJobTabId = null;
                processNextJob();
                break;

            case "ALL_JOBS_PROCESSED_ON_PAGE":
                clearJobStepTimeout();
                if (!isAutomationRunning) break;
                console.log(`Background: Received ALL_JOBS_PROCESSED_ON_PAGE. HasNextPage: ${message.hasNextPage}`);
                if (jobQueue.length > 0) {
                    console.warn("Background: ALL_JOBS_PROCESSED_ON_PAGE received, but jobQueue not empty. Processing queue first.");
                    updatePopupStatus("Page scan done, but prior jobs still in queue. Processing them...");
                    processNextJob();
                } else if (message.hasNextPage) {
                    updatePopupStatus("All jobs on current page processed. Moving to next page...");
                    setJobStepTimeout(currentSearchTabId, "all_jobs_processed_click_next");
                    chrome.tabs.sendMessage(currentSearchTabId, { type: "CLICK_NEXT_PAGE" })
                        .catch(e => {
                            clearJobStepTimeout();
                            console.error("Background: Error sending CLICK_NEXT_PAGE from ALL_JOBS_PROCESSED_ON_PAGE:", e);
                            stopAutomation("script_comm_error_nextpage_allprocessed");
                        });
                } else {
                    updatePopupStatus("All jobs processed on this page. No more pages indicated. Automation complete.");
                    stopAutomation("all_jobs_processed_no_more_pages_explicit");
                }
                break;

            case "NO_MORE_PAGES":
                clearJobStepTimeout();
                if (!isAutomationRunning) break;
                updatePopupStatus("Reached the last page or no next page button found. Automation complete.");
                stopAutomation("no_more_pages_signal");
                break;

            case "CONTENT_SCRIPT_ERROR":
                clearJobStepTimeout(); 
                if (!isAutomationRunning) break;
                const errorMsg = `CS Error on ${message.location} (URL: ${message.jobUrl || (sender.tab ? sender.tab.url : 'N/A')}): ${message.error}`;
                updatePopupStatus(errorMsg, "Content Script Error");
                console.error("Background: Received CONTENT_SCRIPT_ERROR:", message);

                let errorOnCurrentJobTab = false;
                if(currentJobTabId && sender.tab && sender.tab.id === currentJobTabId) {
                    errorOnCurrentJobTab = true;
                }

                if (errorOnCurrentJobTab) {
                    counters.errors++;
                    console.log(`Background: Error on active job page ${message.jobUrl || 'unknown'}. Tab ${currentJobTabId} left open. Moving to next job.`);
                    currentJobTabId = null;
                    processNextJob();
                } else if (message.location === "search_page" && sender.tab && sender.tab.id === currentSearchTabId) {
                    stopAutomation("critical_search_page_error");
                }
                break;

            default:
                break;
        }
        chrome.storage.local.set({ skippedCount: counters.skipped });

    })();
    return true;
});

chrome.runtime.onInstalled.addListener(async (details) => {
    console.log("Background: Extension installed or updated. Reason:", details.reason);
    if (details.reason === "install") {
        await chrome.storage.local.set({
            sentCount: 0,
            skippedCount: 0,
            automationRunning: false
        });
        chrome.runtime.openOptionsPage();
    } else if (details.reason === "update") {
        await chrome.storage.local.set({ automationRunning: false });
    }
    await loadUserSettings();
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    if (!isAutomationRunning) return;

    if (tabId === currentSearchTabId) {
        console.log(`Background: Main search tab ${tabId} was closed. Stopping automation.`);
        updatePopupStatus("Main search tab closed. Stopping automation.", "Search Tab Closed");
        stopAutomation("search_tab_closed_externally");
        currentSearchTabId = null;
    } else if (tabId === currentJobTabId) {
        console.log(`Background: Active job tab ${tabId} was closed externally.`);
        updatePopupStatus(`Job tab for current job closed externally. Skipping.`, "Job Tab Closed");
        clearJobStepTimeout();
        counters.errors++; 
        chrome.storage.local.set({ skippedCount: counters.skipped });
        updatePopupStatus(null);
        currentJobTabId = null;
        processNextJob();
    }
});

console.log("Background script loaded. Timeout for job details: 30s.");
(async () => {
    await loadUserSettings();
    const result = await chrome.storage.local.get(['automationRunning']);
    if (result.automationRunning) {
        console.warn("Background: Script reloaded, 'automationRunning' was true. Setting to false. Please restart from popup.");
        await chrome.storage.local.set({ automationRunning: false });
        isAutomationRunning = false;
        updatePopupStatus("Extension reloaded. Automation was active; it has been stopped. Please restart.");
    }
})();