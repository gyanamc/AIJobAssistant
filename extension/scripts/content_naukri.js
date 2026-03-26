// scripts/content_naukri.js
if (typeof window.aiJobAssistantInjected === 'undefined') {
    window.aiJobAssistantInjected = true;
    
    function extLog(msg) {
        console.log(msg);
        chrome.runtime.sendMessage({ type: 'FORWARD_LOG', message: msg }).catch(() => {});
    }

    extLog("Naukri Scraper Injected & Ready.");

    let isScraping = false;
    let processedJobs = new Set();
    let scrapeInterval = null;

    // Listen for messages
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.type === 'START_SCRAPING') {
            if (!isScraping) {
                extLog("Starting Naukri Scraper Loop...");
                isScraping = true;
                startScrapingLoop();
            }
        } else if (request.type === 'STOP_SCRAPING') {
            extLog("Stopping Naukri Scraper...");
            isScraping = false;
            clearInterval(scrapeInterval);
        }
    });

    chrome.storage.local.get(['botRunning'], (data) => {
        if (data.botRunning) {
            isScraping = true;
            startScrapingLoop();
        }
    });

    async function startScrapingLoop() {
        extLog("Scraping loop initiated... scanning for jobs...");
        
        scrapeInterval = setInterval(async () => {
            if (!isScraping) {
                clearInterval(scrapeInterval);
                return;
            }

            const jobCards = document.querySelectorAll('.srp-jobtuple-wrapper');
            if (jobCards.length === 0) {
                extLog("No job cards found. Waiting for page load...");
                return;
            }

            let nextCard = null;
            for (const card of jobCards) {
                const jobId = card.getAttribute('data-job-id') || card.querySelector('.title')?.href;
                if (jobId && !processedJobs.has(jobId)) {
                    nextCard = card;
                    processedJobs.add(jobId);
                    break;
                }
            }

            if (!nextCard) {
                extLog("All jobs on this page processed. Please click 'Next Page' manually for now.");
                return;
            }

            const jobTitleFound = nextCard.innerText.split('\n')[0] || "Unknown";
            extLog(`Extracting card: ${jobTitleFound.substring(0,30)}...`);
            nextCard.style.border = '2px solid blue';
            nextCard.scrollIntoView({ behavior: 'smooth', block: 'center' });

            const titleElement = nextCard.querySelector('.title');
            const companyElement = nextCard.querySelector('.comp-name');
            
            // Naukri lists often don't show full JD. We either evaluate the short description, 
            // or we need to open the tab. For the extension MVP, we grab the short description 
            // OR click the card and scrape the new popup tab (which is complex for MVP).
            // Here we'll grab the short snippet and key skills.
            const snippetElement = nextCard.querySelector('.job-desc');
            const skillsElements = nextCard.querySelectorAll('.dot-wrapper li');
            let skills = [];
            skillsElements.forEach(s => skills.push(s.innerText.trim()));

            if (!titleElement) {
                extLog("Failed to extract details, moving on.");
                nextCard.style.border = '2px solid gray';
                return;
            }

            const jobData = {
                id: nextCard.getAttribute('data-job-id') || titleElement.href,
                title: titleElement.innerText.trim(),
                company: companyElement ? companyElement.innerText.trim() : 'Unknown',
                description: (snippetElement ? snippetElement.innerText.trim() : '') + "\nSkills: " + skills.join(", "),
                url: titleElement.href
            };

            nextCard.style.border = '2px solid orange';
            extLog("Extracted OK. Sending to OpenAI...");
            
            chrome.runtime.sendMessage({ type: 'EVALUATE_JOB', data: jobData }, (response) => {
                if (response && response.success) {
                    if (response.evaluation.is_match) {
                        nextCard.style.border = '3px solid green';
                        nextCard.style.backgroundColor = '#e8f5e9';
                        extLog(`✅ Visual Match Approved!`);
                    } else {
                        nextCard.style.border = '1px solid #ffcdd2';
                        nextCard.style.opacity = '0.5';
                        extLog(`❌ Visual Match Rejected.`);
                    }
                } else {
                    nextCard.style.border = '2px solid red';
                    extLog(`⚠️ Evaluation failed: ${response?.error || 'Unknown'}`);
                }
            });

        }, 8000);
    }
}
