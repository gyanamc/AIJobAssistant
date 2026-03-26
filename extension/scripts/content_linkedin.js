// scripts/content_linkedin.js
if (typeof window.aiJobAssistantInjected === 'undefined') {
    window.aiJobAssistantInjected = true;
    
    function extLog(msg) {
        console.log(msg);
        chrome.runtime.sendMessage({ type: 'FORWARD_LOG', message: msg }).catch(() => {});
    }

    extLog("LinkedIn Scraper Injected & Ready.");

    let isScraping = false;
    let processedJobs = new Set();
    let scrapeInterval = null;

    // Listen for messages from popup/background to start/stop
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.type === 'START_SCRAPING') {
            if (!isScraping) {
                extLog("Starting LinkedIn Scraper Loop...");
                isScraping = true;
                startScrapingLoop();
            }
        } else if (request.type === 'STOP_SCRAPING') {
            extLog("Stopping LinkedIn Scraper...");
            isScraping = false;
            clearInterval(scrapeInterval);
        }
    });

    // Also check initial state
    chrome.storage.local.get(['botRunning'], (data) => {
        if (data.botRunning) {
            isScraping = true;
            startScrapingLoop();
        }
    });

    async function startScrapingLoop() {
        extLog("Scraping loop initiated... scanning for jobs...");
        
        // We run a loop every 5 seconds to find the next unprocessed job
        scrapeInterval = setInterval(async () => {
            if (!isScraping) {
                clearInterval(scrapeInterval);
                return;
            }

            // 1. Find all job cards in the list (using multiple fallbacks as LinkedIn changes classes often)
            const jobCards = document.querySelectorAll('.job-card-container, [data-job-id], .job-card-list, .base-card, .jobs-search-results__list-item');
            
            // Filter out things that aren't actually cards but might have data-job-id (like the main panel)
            const validCards = Array.from(jobCards).filter(card => card.tagName === 'LI' || card.tagName === 'DIV' && card.className.includes('card'));

            if (validCards.length === 0) {
                extLog("No initial job cards found. Scrolling down to load...");
                // Scroll down the main list or window to force load more
                const listContainer = document.querySelector('.jobs-search-results-list, .scaffold-layout__list, main');
                if (listContainer) listContainer.scrollTop += 1000;
                window.scrollBy(0, 1000);
                return;
            }

            // 2. Find the first unprocessed card
            let nextCard = null;
            for (const card of validCards) {
                const jobId = card.getAttribute('data-job-id') || card.id;
                // If it has a valid ID and we haven't processed it yet
                if (jobId && jobId.length > 5 && !processedJobs.has(jobId)) {
                    nextCard = card;
                    processedJobs.add(jobId);
                    break;
                }
            }

            if (!nextCard) {
                extLog("All visible jobs on screen processed. Scrolling for more...");
                const listContainer = document.querySelector('.jobs-search-results-list, .scaffold-layout__list, main');
                if (listContainer) listContainer.scrollTop += 1000;
                window.scrollBy(0, 1000);
                return;
            }

            // 3. Click the card to load details
            
            // Highlight it so the user knows what the bot is doing
            nextCard.style.border = '2px solid blue';
            nextCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
            nextCard.click();
            
            const jobTitleFound = nextCard.innerText.split('\n')[0] || "Unknown";
            extLog(`Clicking & extracting card: ${jobTitleFound.substring(0,30)}...`);

            // 4. Wait for the description to load in the right panel
            await new Promise(resolve => setTimeout(resolve, 2500)); // Wait 2.5s for DOM render

            // 5. Extract Details (with broad fallbacks)
            const titleElement = document.querySelector('.jobs-details__main-content h1, .job-details-jobs-unified-top-card__job-title, .jobs-unified-top-card__job-title, h1.t-24');
            const companyElement = document.querySelector('.jobs-details__main-content .job-details-jobs-unified-top-card__company-name, .jobs-unified-top-card__company-name, .job-details-jobs-unified-top-card__primary-description a');
            const descriptionElement = document.querySelector('#job-details, .jobs-description__content, article');

            if (!titleElement || !descriptionElement) {
                extLog(`Failed to extract details from right panel. Skipping.`);
                nextCard.style.border = '2px solid gray'; // mark skipped
                return;
            }

            const jobData = {
                id: nextCard.getAttribute('data-job-id') || nextCard.id,
                title: titleElement.innerText.trim(),
                company: companyElement ? companyElement.innerText.trim() : 'Unknown',
                description: descriptionElement.innerText.trim(),
                url: window.location.href
            };

            nextCard.style.border = '2px solid orange'; // marking as analyzing...
            
            // 6. Send to background for OpenAI evaluation
            extLog("Extracted OK. Sending to OpenAI...");
            chrome.runtime.sendMessage({ type: 'EVALUATE_JOB', data: jobData }, (response) => {
                if (response && response.success) {
                    if (response.evaluation.is_match) {
                        nextCard.style.border = '3px solid green';
                        nextCard.style.backgroundColor = '#e8f5e9';
                        extLog(`✅ Visual Match Approved!`);
                    } else {
                        nextCard.style.border = '1px solid #ffcdd2';
                        nextCard.style.opacity = '0.5'; // Dim non-matches
                        extLog(`❌ Visual Match Rejected.`);
                    }
                } else {
                    nextCard.style.border = '2px solid red'; // Error
                    extLog(`⚠️ Evaluation failed: ${response?.error || 'Unknown'}`);
                }
            });

        }, 8000); // Process one job every 8 seconds to avoid rate-limiting / ban
    }
}
