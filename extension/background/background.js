// background/background.js

console.log("AI Job Assistant Background Worker initialized.");

let isRunning = false;

// Load initial state
chrome.storage.local.get(['botRunning'], (data) => {
    isRunning = !!data.botRunning;
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'TOGGLE_BOT') {
        isRunning = request.state;
        console.log(`Bot state changed to: ${isRunning}`);
        sendLogToPopup(`Bot ${isRunning ? 'started' : 'stopped'}.`);
        sendResponse({ success: true });
        return true;
    }
    
    if (request.type === 'FORWARD_LOG') {
        sendLogToPopup(`[Bot] ${request.message}`);
        sendResponse({ success: true });
        return true;
    }

    if (request.type === 'EVALUATE_JOB') {
        if (!isRunning) {
            sendResponse({ success: false, reason: 'Bot is paused' });
            return true;
        }

        const jobData = request.data;
        console.log("Received job for evaluation:", jobData.title);
        
        // Evaluate asynchronously
        evaluateJobWithLLM(jobData).then(result => {
            sendResponse(result);
        }).catch(err => {
            console.error("Evaluation error:", err);
            sendResponse({ success: false, error: err.toString() });
        });
        
        return true; // Keeps the sendResponse channel open for async
    }
});

async function evaluateJobWithLLM(jobData) {
    // Get stored data
    const storage = await chrome.storage.local.get(['aiModel', 'apiKey', 'resumeSummary', 'sheetUrl']);
    const modelPreference = storage.aiModel || 'gemini';

    if (modelPreference === 'gemini') {
        return await evaluateWithGemini(jobData, storage);
    } else if (modelPreference === 'gemini_api') {
        return await evaluateWithGeminiAPI(jobData, storage);
    } else if (modelPreference === 'anthropic') {
        return await evaluateWithAnthropic(jobData, storage);
    } else {
        return await evaluateWithOpenAI(jobData, storage);
    }
}

async function evaluateWithGemini(jobData, storage) {
    sendLogToPopup(`Evaluating with Gemini Nano: ${jobData.title}`);

    // Access built-in AI (usually available on 'self' in Service Workers in Chrome 128+)
    const aiObj = self.ai || (typeof window !== 'undefined' ? window.ai : null);
    
    if (!aiObj || !aiObj.languageModel) {
        sendLogToPopup("ERROR: Chrome Built-in AI (Gemini Nano) not detected.");
        sendLogToPopup("Please enable chrome://flags/#prompt-api-for-gemini-nano or switch to OpenAI in settings.");
        return { success: false, error: "Gemini Nano not supported or enabled" };
    }

    try {
        const { available } = await aiObj.languageModel.capabilities();
        if (available === 'no') {
            sendLogToPopup("ERROR: Gemini Nano is not available on this device.");
            return { success: false, error: "Model not available" };
        } else if (available === 'after-download') {
            sendLogToPopup("WARNING: Gemini Nano model is downloading in the background. Please try again later.");
            return { success: false, error: "Model downloading" };
        }

        const systemPrompt = `You are an expert career assistant evaluating jobs. Analyze the job description against the user's resume.
Respond with EXACTLY valid JSON containing only two keys: "is_match" (boolean) and "reasoning" (string).`;

        const userMessage = `Resume Summary: \n${storage.resumeSummary || 'Not provided'}\n\nJob Title: ${jobData.title}\nJob Company: ${jobData.company}\nJob Description: \n${jobData.description}\n\nEVALUATE AND RETURN ONLY JSON:`;

        const session = await aiObj.languageModel.create({
            systemPrompt: systemPrompt
        });
        
        const responseText = await session.prompt(userMessage);
        session.destroy();
        
        // Clean up response if it has markdown formatting
        let cleanText = responseText.replace(/```json/gi, '').replace(/```/g, '').trim();
        const content = JSON.parse(cleanText);
        
        sendLogToPopup(`Match: ${content.is_match} - ${content.reasoning}`);
        
        if (content.is_match && storage.sheetUrl) {
            sendLogToPopup("Saving to Google Sheets...");
            let sheetId = null;
            if (storage.sheetUrl.includes('/d/')) {
                sheetId = storage.sheetUrl.split('/d/')[1].split('/')[0];
            }
            if (sheetId) {
                await appendToGoogleSheets(jobData, content, sheetId);
            } else {
                sendLogToPopup("ERROR: Invalid Google Sheet URL format.");
            }
        }
        
        return { success: true, evaluation: content };
    } catch (e) {
        sendLogToPopup(`Gemini Eval Failed: ${e.message}`);
        console.error("Gemini Error:", e);
        return { success: false, error: e.message };
    }
}

async function evaluateWithOpenAI(jobData, storage) {
    sendLogToPopup(`Evaluating with OpenAI: ${jobData.title}`);
    
    if (!storage.apiKey) {
        sendLogToPopup("ERROR: No API Key found.");
        return { success: false, error: "Missing API Key" };
    }

    // LLM Prompt configuration
    const systemPrompt = `You are a career assistant. I am applying for jobs. Evaluate this job description based on my resume summary.
Format your response as a JSON object: {"is_match": true|false, "reasoning": "brief explanation"}`;

    const userMessage = `My Resume/Skills: ${storage.resumeSummary || 'Not provided'}
Job Title: ${jobData.title}
Job Company: ${jobData.company}
Job Description:
${jobData.description}`;

    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${storage.apiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini', // Using mini for cost/speed
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userMessage }
                ],
                response_format: { type: "json_object" },
                temperature: 0.3
            })
        });

        if (!response.ok) throw new Error(`OpenAI API error: ${response.status}`);
        
        const jsonResponse = await response.json();
        const content = JSON.parse(jsonResponse.choices[0].message.content);
        
        sendLogToPopup(`Match: ${content.is_match} - ${content.reasoning}`);
        
        // Extract ID from URL if provided
        if (content.is_match && storage.sheetUrl) {
            sendLogToPopup("Saving to Google Sheets...");
            
            // Extract the actual Google Sheet ID from the full URL using regex
            const match = storage.sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
            if (match && match[1]) {
                await appendToGoogleSheets(jobData, content, match[1]);
            } else {
                sendLogToPopup("ERROR: Invalid Google Sheet URL format.");
            }
        }
        
        return { success: true, evaluation: content };
    } catch (e) {
        sendLogToPopup(`Failed LLM eval: ${e.message}`);
        console.error(e);
        return { success: false, error: e.message };
    }
}

async function evaluateWithGeminiAPI(jobData, storage) {
    sendLogToPopup(`Evaluating with Gemini API: ${jobData.title}`);
    if (!storage.apiKey) {
        sendLogToPopup("ERROR: No Gemini API Key found.");
        return { success: false, error: "Missing API Key" };
    }

    const systemPrompt = `You are a career assistant evaluating jobs. Analyze the job against my resume. Respond with EXACTLY valid JSON containing keys "is_match" (boolean) and "reasoning" (string).`;
    const userMessage = `Resume: ${storage.resumeSummary || 'Not provided'}\\nJob Title: ${jobData.title}\\nCompany: ${jobData.company}\\nDescription:\\n${jobData.description}`;

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${storage.apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                system_instruction: { parts: { text: systemPrompt } },
                contents: [{ parts: [{ text: userMessage }] }],
                generationConfig: { response_mime_type: "application/json", temperature: 0.3 }
            })
        });

        if (!response.ok) throw new Error(`Gemini API error: ${response.status}`);
        
        const json = await response.json();
        const textResponse = json.candidates[0].content.parts[0].text;
        const content = JSON.parse(textResponse);
        
        sendLogToPopup(`Match: ${content.is_match} - ${content.reasoning}`);
        
        if (content.is_match && storage.sheetUrl) {
            let sheetId = null;
            if (storage.sheetUrl.includes('/d/')) sheetId = storage.sheetUrl.split('/d/')[1].split('/')[0];
            if (sheetId) await appendToGoogleSheets(jobData, content, sheetId);
        }
        return { success: true, evaluation: content };
    } catch (e) {
        sendLogToPopup(`Failed Gemini API eval: ${e.message}`);
        return { success: false, error: e.message };
    }
}

async function evaluateWithAnthropic(jobData, storage) {
    sendLogToPopup(`Evaluating with Anthropic: ${jobData.title}`);
    if (!storage.apiKey) {
        sendLogToPopup("ERROR: No Anthropic API Key found.");
        return { success: false, error: "Missing API Key" };
    }

    const systemPrompt = `You are a career assistant evaluating jobs. Analyze the job against my resume. Respond with EXACTLY valid JSON containing keys "is_match" (boolean) and "reasoning" (string).`;
    const userMessage = `Resume: ${storage.resumeSummary || 'Not provided'}\\nJob Title: ${jobData.title}\\nCompany: ${jobData.company}\\nDescription:\\n${jobData.description}\\n\\nReturn EXACTLY valid JSON ONLY. No other text.`;

    try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'x-api-key': storage.apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true',
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                model: 'claude-3-5-sonnet-20241022',
                max_tokens: 500,
                temperature: 0.3,
                system: systemPrompt,
                messages: [{ role: 'user', content: userMessage }]
            })
        });

        if (!response.ok) throw new Error(`Anthropic API error: ${response.status}`);
        
        const json = await response.json();
        let cleanText = json.content[0].text.replace(/\\`\\`\\`json/gi, '').replace(/\\`\\`\\`/g, '').trim();
        const content = JSON.parse(cleanText);
        
        sendLogToPopup(`Match: ${content.is_match} - ${content.reasoning}`);
        
        if (content.is_match && storage.sheetUrl) {
            let sheetId = null;
            if (storage.sheetUrl.includes('/d/')) sheetId = storage.sheetUrl.split('/d/')[1].split('/')[0];
            if (sheetId) await appendToGoogleSheets(jobData, content, sheetId);
        }
        return { success: true, evaluation: content };
    } catch (e) {
        sendLogToPopup(`Failed Anthropic API eval: ${e.message}`);
        return { success: false, error: e.message };
    }
}

async function appendToGoogleSheets(jobData, evaluation, sheetId) {
    return new Promise((resolve, reject) => {
        chrome.identity.getAuthToken({ interactive: true }, async function(token) {
            if (chrome.runtime.lastError || !token) {
                sendLogToPopup("Google OAuth Error: " + chrome.runtime.lastError.message);
                return resolve(false);
            }

            const range = "Sheet1!A:F"; // Adjust based on your sheet
            const valueInputOption = "USER_ENTERED";
            
            // Format: [Date, Details, Role, URL, Status, Reasoning]
            const values = [[
                new Date().toISOString(),
                `${jobData.title} at ${jobData.company}`,
                "Matched Role", // Would dynamically come from profile match in production
                jobData.url,
                "Draft",
                evaluation.reasoning
            ]];

            const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}:append?valueInputOption=${valueInputOption}`;
            
            try {
                const res = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ values })
                });

                if (!res.ok) throw new Error("Sheets API returned " + res.status);
                sendLogToPopup("✅ Saved to Google Sheets!");
                resolve(true);
            } catch (err) {
                sendLogToPopup("Failed saving to Sheets: " + err.message);
                resolve(false);
            }
        });
    });
}

function sendLogToPopup(message) {
    const time = new Date().toLocaleTimeString([], { hour12: false });
    const fullLog = `[${time}] ${message}`;

    // Save to storage so it persists when popup reopens
    chrome.storage.local.get(['sessionLogs'], (data) => {
        let logs = data.sessionLogs || [];
        logs.unshift(fullLog); // pre-pend
        if (logs.length > 50) logs.pop(); // keep only last 50 logs
        chrome.storage.local.set({ sessionLogs: logs });
    });

    // Send to popup if it happens to be open
    chrome.runtime.sendMessage({ type: 'LOG_MESSAGE', message: fullLog }).catch(() => {
        // Ignore errors if popup is closed
    });
}
