# Hello Work Application Automator

A Chrome extension designed to automate the job application process on the "Hello Work" website. This extension identifies suitable jobs, filters out external applications, uses AI to generate personalized cover letters in French, and automatically fills and attempts to submit the application forms.

**Disclaimer:** This tool interacts with the Hello Work website. Website structures can change, which may break the extension's functionality, particularly its ability to find and interact with page elements. Use this tool responsibly and ethically. The developers are not responsible for any issues arising from its use, including incomplete applications or account problems. Always double-check important applications.

## Core Features

* **Automated Job Scanning:** Scans Hello Work search result pages for job listings.
* **External Application Filtering:** Identifies and skips jobs that redirect to external sites for application.
* **AI-Powered Cover Letters:** Integrates with OpenAI (GPT models) to generate personalized cover letters in **French** based on the user's profile and the job description.
* **Automatic Form Filling:** Fills the cover letter into the application form.
* **Automated Submission Attempt:** Attempts to submit the application.
* **Pagination:** Automatically navigates to the next page of search results.
* **User Interface:**
    * **Popup (`popup.html`):**
        * Start/Stop automation.
        * Real-time status display.
        * Counters for applications sent, skipped, or errors.
        * Link to settings.
    * **Options Page (`options.html`):**
        * Securely store your OpenAI API Key (stored locally on your machine).
        * Input and store your professional profile/CV details.

## How It Works (Technical Workflow Overview)

1.  **Initiation:** The user navigates to a Hello Work job search results page and starts the automation via the extension popup.
2.  **Page Scanning (`content_script.js`):** The content script identifies job listings on the current search page.
3.  **Job Processing Loop (`background.js`):**
    * Each job is opened in a new tab.
    * **Verification (`content_script.js` in job tab):** The script checks if the application is internal (looks for a specific internal form structure/button to reveal the form) or external. External/unfillable jobs are skipped.
    * **Job Description Extraction:** For internal jobs, the script extracts the page text (currently `document.body.innerText`) to be used for cover letter generation.
    * **AI Cover Letter Generation (`background.js`):** An API call is made to OpenAI (e.g., GPT-4 Turbo) with the user's profile and the extracted job description to generate a tailored cover letter in French (max ~2000 characters).
    * **Form Filling & Submission (`content_script.js` in job tab):**
        * The generated cover letter is sent to the content script.
        * The script attempts to click necessary buttons to reveal the cover letter input area.
        * The cover letter is pasted.
        * The script attempts to click the final submit button.
    * **Cleanup & Iteration:** Successful applications are logged, the counter is updated, and the job tab is closed. Erroneous applications leave the tab open for inspection.
4.  **Pagination:** Once all jobs on a page are processed, the script attempts to click the "next page" button and repeats the process.
5.  **Error Handling:** The extension includes timeouts for element interactions and attempts to log errors, skipping problematic jobs and leaving their tabs open.

## Setup and Installation

1.  **Download/Clone:** Obtain the extension files and place them in a local directory on your computer.
2.  **Open Chrome Extensions:**
    * Open Google Chrome.
    * Navigate to `chrome://extensions`.
3.  **Enable Developer Mode:**
    * In the top right corner of the Extensions page, toggle "Developer mode" to ON.
4.  **Load Unpacked:**
    * Click the "Load unpacked" button that appears.
    * Select the directory where you saved the extension files.
5.  The extension icon should now appear in your Chrome toolbar.

## Configuration (Important!)

Before using the extension, you **MUST** configure it:

1.  **Open Options Page:**
    * Click the extension icon in your Chrome toolbar.
    * In the popup, click the "Settings" link. This will open the `options.html` page.
2.  **Enter OpenAI API Key:**
    * Securely paste your own OpenAI API key into the designated field. This key is stored **only on your local computer** using `chrome.storage.local` and is necessary for generating cover letters. *API usage may incur costs from OpenAI.*
3.  **Enter Your Professional Profile:**
    * In the large text area, paste your resume/CV details in plain text format.
    * Include your full name, contact information (email, phone - optional but good for the AI to see), a professional summary, work experience, education, and key skills. This information is used by the AI to tailor the cover letters.
4.  **Save Settings:** Click the "Save Settings" button.

## Usage

1.  Navigate to a job search results page on the Hello Work website (e.g., after searching for a job title and location).
2.  Click the extension icon in the Chrome toolbar to open the popup.
3.  Click the "Start Automation" button.
4.  Monitor the "Status Display" for real-time progress and any error messages.
5.  Use the "Stop Automation" button to halt the process at any time.

## Key Technologies

* Chrome Extension APIs (Manifest V3)
* JavaScript
* HTML & CSS
* OpenAI API (for cover letter generation)

## Important Considerations & Disclaimers

* **Website Structure Dependent:** This extension relies heavily on the specific HTML structure (CSS selectors) of the Hello Work website. If Hello Work updates its website design, the selectors used in `content_script.js` may become outdated, and the extension may stop working correctly or entirely. **Regular maintenance of selectors will be required.**
* **CSS Selectors:** The accuracy of CSS selectors is critical. Current key selectors include:
    * Search Page Job Listing: `li[data-id-storage-target="item"]`
    * Search Page Offer Link: `a[data-cy="offerTitle"]`
    * Search Page Next Button: `button:has(svg[data-cross-origin-svg-url-value*="arrow-right.svg"])` (with `button[name="p"][type="submit"]` as a fallback)
    * Job Detail - Motivation Button (to reveal form): `label[data-cy="motivationFieldButton"]`
    * Job Detail - Cover Letter Textarea: `textarea#Answer_Description`
    * Job Detail - Final Submit Button: `button[data-cy="submitButton"]` and `button[data-cy="saContinueButton"]` (checks both)
* **OpenAI API Costs:** Using the OpenAI API for cover letter generation will incur costs based on your usage. Ensure you monitor your OpenAI account.
* **Ethical Use:** This tool is intended to assist with the job application process, not to spam or overwhelm recruiters. Always ensure the AI-generated cover letters are reviewed and accurately represent your profile.
* **Error Handling:** While the extension attempts to handle errors gracefully (e.g., by skipping a problematic job and leaving the tab open), it may not catch all edge cases. Always supervise the process for important applications.
* **Rate Limiting:** Be mindful of potential rate limits on both the Hello Work website and the OpenAI API if applying to a large number of jobs in a short period.
* **"As-Is":** This software is provided "as-is", without warranty of any kind.

## Troubleshooting

* **Extension Not Working:**
    1.  Ensure you have correctly entered your OpenAI API Key and Profile in the Options page.
    2.  Check the Hello Work website for any recent design changes. Selectors in `content_script.js` might need updating.
    3.  Open the **Chrome Developer Console** on the Hello Work tab where the extension is active (Right-click on the page -> Inspect -> Console tab) to look for errors logged by the content script (prefixed with "HelloWork Automator:").
    4.  Open the extension's service worker console: Go to `chrome://extensions`, find the "Hello Work Application Automator", and click the "Service worker" link to check for errors logged by `background.js`.
* **Cover Letter Issues:** If cover letters are poor quality or truncated, ensure your profile details are comprehensive. The `max_tokens` for the AI is currently set to 700 in `background.js`.

