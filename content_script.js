// content_script.js

// Utility function to wait for an element with timeout
async function waitForElement(selector, timeout = 10000, parent = document) {
    return new Promise((resolve, reject) => {
        const intervalTime = 100;
        let elapsedTime = 0;
        console.log(`HelloWork Automator (waitForElement): Starting to wait for "${selector}" with ${timeout/1000}s timeout.`);
        const interval = setInterval(() => {
            const element = parent.querySelector(selector);
            if (element) {
                const styles = window.getComputedStyle(element);
                // Check if element exists and is considered visible
                if (styles.display !== 'none' && styles.visibility !== 'hidden' && parseFloat(styles.opacity) > 0 && (element.offsetWidth > 0 || element.offsetHeight > 0 || element.getClientRects().length > 0)) {
                    console.log(`HelloWork Automator (waitForElement): Found visible element for "${selector}".`);
                    clearInterval(interval);
                    resolve(element);
                    return;
                }
            }
            elapsedTime += intervalTime;
            if (elapsedTime >= timeout) {
                console.error(`HelloWork Automator (waitForElement): Timeout! Element "${selector}" not found or not visible after ${timeout/1000}s.`);
                clearInterval(interval);
                reject(new Error(`Timeout or element not visible for: ${selector} after ${timeout/1000}s`));
            }
        }, intervalTime);
    });
}

// Function to send errors back to background script
function reportError(location, error, jobUrl = null) {
    console.error(`HelloWork Automator: Error on ${location} (${jobUrl || 'N/A'}):`, error.message || String(error), error.stack ? `\nStack: ${error.stack}` : '');
    if (chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({
            type: "CONTENT_SCRIPT_ERROR",
            location: location,
            error: error.message || String(error),
            jobUrl: jobUrl
        }).catch(e => console.warn("HelloWork Automator: Error sending error message to background:", e.message));
    }
}

// --- Main logic ---
(async () => {
    if (window.helloWorkAutomatorContentLoaded) {
        return "already_injected_and_processed";
    }
    window.helloWorkAutomatorContentLoaded = true;

    console.log("HelloWork Automator: Content script running on URL:", window.location.href);

    // Page Detection Logic
    let isJobDetailPage = false;
    let isSearchPage = false;
    const currentPath = window.location.pathname.toLowerCase();
    const jobDetailPattern = /^\/fr-fr\/emplois\/\d+\.html$/i; 

    if (jobDetailPattern.test(currentPath)) {
        isJobDetailPage = true;
    } else {
        const searchPageKeywords = ["/emploi/recherche", "/candidate/jobs", "/jobs/search", "/offre/liste"];
        if (searchPageKeywords.some(keyword => currentPath.includes(keyword.toLowerCase()))) {
            isSearchPage = true;
        }
    }

    if (isSearchPage) {
        console.log("HelloWork Automator: Search results page detected.");
        //region SEARCH PAGE LOGIC 
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (message.type === "EXTRACT_JOB_LISTINGS") {
                (async () => {
                    console.log("HelloWork Automator: Received EXTRACT_JOB_LISTINGS message.");
                    try {
                        const jobListingSelector = 'li[data-id-storage-target="item"]';
                        const offerLinkSelector = 'a[data-cy="offerTitle"]';

                        console.log(`HelloWork Automator: Attempting to find job listings with selector: "${jobListingSelector}"`);
                        const jobListings = document.querySelectorAll(jobListingSelector);
                        console.log(`HelloWork Automator: Found ${jobListings.length} raw elements matching "${jobListingSelector}".`);

                        if (jobListings.length === 0) {
                            console.warn(`HelloWork Automator: CRITICAL - No job listings found using selector "${jobListingSelector}".`);
                        }

                        const jobs = [];
                        jobListings.forEach((listing, index) => {
                            const linkElement = listing.querySelector(offerLinkSelector);
                            let title = 'N/A';

                            if (linkElement) {
                                title = linkElement.innerText.trim();
                                if (linkElement.href) {
                                    jobs.push({
                                        url: linkElement.href,
                                        title: title
                                    });
                                } else {
                                    console.warn(`HelloWork Automator: Job listing ${index + 1}, link element found with "${offerLinkSelector}", but it has no href. Title: "${title}".`);
                                }
                            } else {
                                console.warn(`HelloWork Automator: Job listing ${index + 1} (matched by "${jobListingSelector}") found, but could NOT find offer link/title element using "${offerLinkSelector}".`);
                            }
                        });

                        console.log(`HelloWork Automator: Successfully extracted ${jobs.length} jobs with valid links.`);

                        const primaryNextPageSelector = 'button:has(svg[data-cross-origin-svg-url-value*="arrow-right.svg"])';
                        const alternativeNextPageSelector = 'button[name="p"][type="submit"]';
                        let nextPageButton = document.querySelector(primaryNextPageSelector);
                        let usedSelector = primaryNextPageSelector;
                        if (!nextPageButton) {
                            nextPageButton = document.querySelector(alternativeNextPageSelector);
                            usedSelector = alternativeNextPageSelector;
                        }
                        if (nextPageButton) console.log(`HelloWork Automator: Next page button found using selector "${usedSelector}".`);
                        else console.log(`HelloWork Automator: Next page button was NOT found using primary or alternative selectors.`);

                        chrome.runtime.sendMessage({
                            type: "JOB_LISTINGS_DATA",
                            jobs: jobs,
                            hasNextPage: !!nextPageButton,
                            currentPageUrl: window.location.href
                        }).catch(e => console.warn("HelloWork Automator: Error sending job listings data to background:", e.message));
                        sendResponse({status: "job_listings_sent", count: jobs.length});

                    } catch (e) {
                        reportError("search_page_extract_listings", e, null); 
                        sendResponse({status: "error", error: e.message});
                    }
                })();
                return true;

            } else if (message.type === "CLICK_NEXT_PAGE") {
                (async () => {
                    const primaryNextPageSelector = 'button:has(svg[data-cross-origin-svg-url-value*="arrow-right.svg"])';
                    const alternativeNextPageSelector = 'button[name="p"][type="submit"]';
                    console.log(`HelloWork Automator: Received CLICK_NEXT_PAGE.`);
                    try {
                        let nextPageButtonToClick = await waitForElement(primaryNextPageSelector, 5000).catch(() => null);
                        let usedSelectorForClick = primaryNextPageSelector;

                        if (!nextPageButtonToClick) {
                            console.log(`HelloWork Automator: Primary next page selector ("${primaryNextPageSelector}") not immediately found or timed out for click. Trying alternative...`);
                            nextPageButtonToClick = await waitForElement(alternativeNextPageSelector, 10000).catch(() => null);
                            usedSelectorForClick = alternativeNextPageSelector;
                        }
                        if (nextPageButtonToClick) {
                             console.log(`HelloWork Automator: Clickable next page button found using selector ("${usedSelectorForClick}"). Clicking.`);
                            nextPageButtonToClick.click();
                            sendResponse({status: "next_page_clicked"});
                        } else {
                            console.log(`HelloWork Automator: Next page button not found after waiting (tried "${primaryNextPageSelector}" then "${alternativeNextPageSelector}") for CLICK_NEXT_PAGE. Reporting no more pages.`);
                            chrome.runtime.sendMessage({ type: "NO_MORE_PAGES" }).catch(e => console.warn("Error sending no_more_pages:", e.message));
                            sendResponse({status: "no_next_page_button"});
                        }
                    } catch (e) {
                        reportError("search_page_click_next", e, null); 
                        chrome.runtime.sendMessage({ type: "NO_MORE_PAGES" }).catch(err => console.warn("Error sending no_more_pages on failure:", err.message));
                        sendResponse({status: "error", error: e.message});
                    }
                })();
                return true;
            }
        });
        //endregion
        return "search_script_injected";

    } else if (isJobDetailPage) {
        console.log("HelloWork Automator: Job details page detected.");
        //region JOB DETAIL PAGE LOGIC
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (message.type === "PROCESS_JOB_PAGE_DETAILS") {
                (async () => {
                    console.log("HelloWork Automator (Job Detail): Received PROCESS_JOB_PAGE_DETAILS for URL:", message.jobUrl);
                    const jobUrl = message.jobUrl;
                    const motivationButtonSelector = 'label[data-cy="motivationFieldButton"]';
                    const MOTIVATION_BUTTON_WAIT_TIMEOUT = 15000; 

                    try {
                        // ***** ADDED 8-SECOND DELAY *****
                        console.log(`HelloWork Automator (Job Detail): Starting 8-second delay for page to fully load...`);
                        await new Promise(resolve => setTimeout(resolve, 8000));
                        console.log(`HelloWork Automator (Job Detail): 8-second delay complete. Now looking for elements.`);
                        // ***** END OF ADDED DELAY *****

                        console.log(`HelloWork Automator (Job Detail): Attempting to find and click 'motivation field button' ("${motivationButtonSelector}") with ${MOTIVATION_BUTTON_WAIT_TIMEOUT/1000}s timeout.`);
                        const motivationButton = await waitForElement(motivationButtonSelector, MOTIVATION_BUTTON_WAIT_TIMEOUT);
                        console.log(`HelloWork Automator (Job Detail): Found 'motivation field button'. Element:`, motivationButton);
                        
                        console.log(`HelloWork Automator (Job Detail): Clicking 'motivation field button'.`);
                        motivationButton.click();
                        console.log(`HelloWork Automator (Job Detail): Clicked 'motivation field button'. Waiting 1.5s for section to expand/load...`);
                        await new Promise(resolve => setTimeout(resolve, 1500)); 

                        const jobDescriptionText = document.body.innerText || "";
                        if (!jobDescriptionText.trim()) {
                             console.warn("HelloWork Automator (Job Detail): document.body.innerText is empty after clicking motivation button.");
                             throw new Error("Failed to extract page text for job description after clicking motivation button.");
                        }
                        console.log(`HelloWork Automator (Job Detail): Extracted full page text for job description. Length: ${jobDescriptionText.length}`);

                        console.log("HelloWork Automator (Job Detail): Attempting to send JOB_PAGE_INFO (success) to background.");
                        chrome.runtime.sendMessage({
                            type: "JOB_PAGE_INFO",
                            isExternal: false, 
                            isEffectivelyExternal: false,
                            jobDescription: jobDescriptionText, 
                            jobUrl: jobUrl
                        }).then(() => {
                            console.log("HelloWork Automator (Job Detail): Successfully sent JOB_PAGE_INFO (motivation button clicked, desc extracted) to background.");
                        }).catch(e => console.error("HelloWork Automator (Job Detail): Error sending JOB_PAGE_INFO (success) to background:", e.message));
                        sendResponse({status: "job_details_sent_after_motivation_click"});

                    } catch (e) { 
                        const errorMessage = `'Motivation field button' ("${motivationButtonSelector}") not found, not visible, or error clicking: ${e.message}. Assuming not an internal fillable form.`;
                        reportError("job_detail_page_motivation_button", e, jobUrl); 
                        
                        console.log("HelloWork Automator (Job Detail): Attempting to send JOB_PAGE_INFO (error) to background due to motivation button failure.");
                        chrome.runtime.sendMessage({
                            type: "JOB_PAGE_INFO", 
                            isExternal: true, 
                            isEffectivelyExternal: true,
                            error: errorMessage,
                            jobUrl: jobUrl
                        }).then(() => {
                             console.log("HelloWork Automator (Job Detail): Successfully sent JOB_PAGE_INFO (motivation button error) to background.");
                        }).catch(err => console.error("HelloWork Automator (Job Detail): Error sending JOB_PAGE_INFO (motivation button error) to background:", err.message));
                        sendResponse({status: "error_motivation_button", error: e.message});
                    }
                })();
                return true;

            } else if (message.type === "FILL_AND_SUBMIT_APPLICATION") {
                 console.log("HelloWork Automator (Job Detail): Received FILL_AND_SUBMIT_APPLICATION for URL:", message.jobUrl);
                (async () => {
                    const jobUrl = message.jobUrl;
                    try {
                        const coverLetterTextareaSelector = 'textarea#Answer_Description'; 
                        // ***** SELECTORS FOR FINAL SUBMIT BUTTON (TRYING BOTH) *****
                        const finalSubmitButtonSelector1 = 'button[data-cy="submitButton"]'; 
                        const finalSubmitButtonSelector2 = 'button[data-cy="saContinueButton"]'; // New one from your HTML
                        // ***** END OF SELECTORS FOR FINAL SUBMIT BUTTON *****
                        const TEXTAREA_WAIT_TIMEOUT = 15000; 
                        const SUBMIT_BUTTON_WAIT_TIMEOUT = 20000; 

                        console.log(`HelloWork Automator (Job Detail): Attempting to fill cover letter textarea ("${coverLetterTextareaSelector}") with ${TEXTAREA_WAIT_TIMEOUT/1000}s timeout.`);
                        const coverLetterTextarea = await waitForElement(coverLetterTextareaSelector, TEXTAREA_WAIT_TIMEOUT);
                        console.log(`HelloWork Automator (Job Detail): Found cover letter textarea. Value before: "${coverLetterTextarea.value}"`);
                        coverLetterTextarea.value = message.coverLetter;
                        coverLetterTextarea.dispatchEvent(new Event('focus', { bubbles: true }));
                        coverLetterTextarea.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                        coverLetterTextarea.dispatchEvent(new Event('change', { bubbles: true }));
                        coverLetterTextarea.dispatchEvent(new Event('blur', { bubbles: true }));
                        console.log(`HelloWork Automator (Job Detail): Filled cover letter textarea. Value after: "${coverLetterTextarea.value}"`);
                        await new Promise(resolve => setTimeout(resolve, 500));

                        let submitButton = null;
                        let usedSubmitSelector = "";

                        console.log(`HelloWork Automator (Job Detail): Attempting to find final submit button with selector 1 ("${finalSubmitButtonSelector1}") with ${SUBMIT_BUTTON_WAIT_TIMEOUT/1000}s timeout.`);
                        try {
                            submitButton = await waitForElement(finalSubmitButtonSelector1, SUBMIT_BUTTON_WAIT_TIMEOUT);
                            usedSubmitSelector = finalSubmitButtonSelector1;
                            console.log(`HelloWork Automator (Job Detail): Found final submit button using selector 1.`);
                        } catch (e1) {
                            console.warn(`HelloWork Automator (Job Detail): Submit button not found with selector 1 ("${finalSubmitButtonSelector1}"). Error: ${e1.message}. Trying selector 2...`);
                            try {
                                console.log(`HelloWork Automator (Job Detail): Attempting to find final submit button with selector 2 ("${finalSubmitButtonSelector2}") with ${SUBMIT_BUTTON_WAIT_TIMEOUT/1000}s timeout.`);
                                submitButton = await waitForElement(finalSubmitButtonSelector2, SUBMIT_BUTTON_WAIT_TIMEOUT);
                                usedSubmitSelector = finalSubmitButtonSelector2;
                                console.log(`HelloWork Automator (Job Detail): Found final submit button using selector 2.`);
                            } catch (e2) {
                                console.error(`HelloWork Automator (Job Detail): Submit button not found with selector 2 ("${finalSubmitButtonSelector2}") either. Error: ${e2.message}`);
                                throw new Error(`Final submit button not found with either selector: ("${finalSubmitButtonSelector1}") or ("${finalSubmitButtonSelector2}")`);
                            }
                        }
                        
                        if (submitButton.disabled) {
                            console.warn(`HelloWork Automator (Job Detail): Final submit button ("${usedSubmitSelector}") is disabled. Waiting 2s...`);
                            await new Promise(resolve => setTimeout(resolve, 2000));
                            if (submitButton.disabled) {
                                throw new Error(`Final submit button ('${usedSubmitSelector}') remained disabled.`);
                            }
                             console.log(`HelloWork Automator (Job Detail): Final submit button ("${usedSubmitSelector}") is now enabled.`);
                        }
                        
                        console.log(`HelloWork Automator (Job Detail): Clicking final submit button ("${usedSubmitSelector}").`);
                        submitButton.click(); 
                        console.log(`HelloWork Automator (Job Detail): Clicked final submit button.`);

                        await new Promise(resolve => setTimeout(resolve, 4000)); 
                        console.log("HelloWork Automator (Job Detail): Application submitted (assumed success after delay). Current URL:", window.location.href);

                        chrome.runtime.sendMessage({
                            type: "APPLICATION_RESULT",
                            status: "success", 
                            jobUrl: jobUrl
                        }).catch(e => console.warn("Error sending success result to background:", e.message));
                        sendResponse({status: "submitted"});

                    } catch (e) {
                        reportError("job_application_form_filling", e, jobUrl);
                        chrome.runtime.sendMessage({
                            type: "APPLICATION_RESULT",
                            status: "error",
                            errorMessage: e.message,
                            jobUrl: jobUrl
                        }).catch(err => console.warn("CS (Job Detail): Error sending application error result:", err.message));
                        sendResponse({status: "error_form_fill", error: e.message});
                    }
                })();
                return true;
            }
        });
        //endregion
        return "job_detail_script_injected";
    } else {
        console.log("HelloWork Automator: Page not recognized as search or job detail page by current heuristics.");
        return "unknown_page_type_injected";
    }
})();