// background.js

let runningTTS = false;
let isPaused = false;
let currentAudioElement = null;
let currentSentenceText = "";
let activeTtsTabId = null;
let selectionOnly = false;

let prefetchedData = null;
const audioEndedListeners = new WeakMap();

let playbackTimeUpdater = null;

browser.contextMenus.create({
    id: "readAloud",
    title: "Read Aloud",
    contexts: ["page"]
});

browser.contextMenus.create({
    id: "readAloudFromHere",
    title: "Read Aloud From Here",
    contexts: ["selection"]
});

browser.contextMenus.create({
    id: "readAloudSelection",
    title: "Read Aloud Selection",
    contexts: ["selection"],
    visible: false,
});

browser.contextMenus.create({
    id: "closeReadAloud",
    title: "Close Read Aloud",
    contexts: ["page"],
    visible: false,
});


function startPlaybackUpdater() {
    if (playbackTimeUpdater) {
        clearInterval(playbackTimeUpdater);
    }

    playbackTimeUpdater = setInterval(() => {
        if (activeTtsTabId !== null && currentAudioElement && !isPaused) {
            browser.tabs.sendMessage(activeTtsTabId, {
                action: "updatePlaybackTime",
                time: currentAudioElement.currentTime
            }).catch(error => {
                console.warn("Failed to send time update, content script may have been invalidated.", error);
                stopTTS();
            });
        }
    }, 100);
}

function stopPlaybackUpdater() {
    if (playbackTimeUpdater) {
        clearInterval(playbackTimeUpdater);
        playbackTimeUpdater = null;
    }
}

async function isPrefetchEnabled() {
    try {
        const settings = await browser.storage.sync.get({ prefetchEnabled: true });
        return settings.prefetchEnabled;
    } catch (error) {
        console.warn("Failed to load prefetch setting, defaulting to true:", error);
        return true;
    }
}

async function handleAudioEnded(endedElement) {
    console.log("Audio finished playing naturally.");
    stopPlaybackUpdater();

    // 1. Clean up the audio element that just finished.
    if (endedElement.src && endedElement.src.startsWith('blob:')) {
        URL.revokeObjectURL(endedElement.src);
    }
    const listener = audioEndedListeners.get(endedElement);
    if (listener) {
        endedElement.removeEventListener('ended', listener);
    }

    // 2. Handle special case: 'read selection only' mode
    if (selectionOnly) {
        stopTTS();
        browser.tabs.sendMessage(activeTtsTabId, { action: "close-toolbar" });
        selectionOnly = false;
        return;
    }

    // 3. Continue to next block - either using prefetched audio or fetching on demand
    if (activeTtsTabId !== null) {
        try {
            // 3a. Get the next block text
            const response = await browser.tabs.sendMessage(activeTtsTabId, { action: "getNextBlock" });
            const nextText = response?.text;

            if (!nextText || !nextText.trim()) {
                console.log("Reached end of content (getNextBlock returned empty). Stopping.");
                stopTTS();
                browser.tabs.sendMessage(activeTtsTabId, { action: "close-toolbar" });
                return;
            }

            // 3b. Check if we have prefetched audio for this block
            if (prefetchedData) {
                console.log("Playing prefetched audio.");
                currentAudioElement = new Audio(prefetchedData.audioUrl);
                const wordBoundaries = prefetchedData.wordBoundaries;
                prefetchedData = null;

                await browser.tabs.sendMessage(activeTtsTabId, {
                    action: "startBlockPlayback",
                    boundaries: wordBoundaries
                });

                const onAudioEnded = () => handleAudioEnded(currentAudioElement);
                audioEndedListeners.set(currentAudioElement, onAudioEnded);
                currentAudioElement.addEventListener('ended', onAudioEnded);
                
                currentAudioElement.play().catch(playError => {
                    console.error("Error playing prefetched audio:", playError);
                    stopTTS();
                });
                startPlaybackUpdater();

                currentSentenceText = nextText;
                isPaused = false;
                pushUiUpdate();

                if (await isPrefetchEnabled()) {
                    prefetchNext();
                }
            } else {
                console.log("No prefetched audio, synthesizing on demand.");
                await runTTS(nextText);
            }

        } catch (error) {
            console.error("Error during transition to next block:", error);
            stopTTS();
        }
    } else {
        console.log("No active tab, ending session.");
        stopTTS();
    }
}

async function runTTS(textToSpeak) {
    const wordBoundaryQueue = [];

    const {
        voice = "en-US-AnaNeural",
        rate = "0%",
        pitch = "0Hz"
    } = await browser.storage.sync.get({
        voice: "en-US-AnaNeural",
        rate: "0%",
        pitch: "0Hz"
    });

    const tts = new window.EdgeTTS();
    
    tts.onWordBoundary = (wordData) => {
        wordBoundaryQueue.push(wordData);
    };
    
    try {
        await tts.synthesize(textToSpeak, voice, { rate, pitch });

        if (tts.audio_stream.length === 0) {
            throw new Error("No audio data was received from the synthesis.");
        }

        const combinedAudio = tts.concatUint8Arrays(tts.audio_stream);
        const audioBlob = new Blob([combinedAudio], { type: "audio/mp3" });
        const audioUrl = URL.createObjectURL(audioBlob);

        if (currentAudioElement) {
            currentAudioElement.pause();
            const oldListener = audioEndedListeners.get(currentAudioElement);
            if(oldListener) {
                currentAudioElement.removeEventListener('ended', oldListener);
            }
        }

        await browser.tabs.sendMessage(activeTtsTabId, {
            action: "startBlockPlayback",
            boundaries: wordBoundaryQueue
        });

        currentAudioElement = new Audio(audioUrl);

        const onAudioEnded = () => handleAudioEnded(currentAudioElement);
        audioEndedListeners.set(currentAudioElement, onAudioEnded);
        currentAudioElement.addEventListener('ended', onAudioEnded);

        currentAudioElement.play().catch(playError => {
            console.error("Error playing audio:", playError);
            stopTTS();
        });

        startPlaybackUpdater();

        currentSentenceText = textToSpeak;
        runningTTS = true;
        isPaused = false;
        pushUiUpdate();
        
        if (await isPrefetchEnabled()) {
            prefetchNext();
        }

    } catch (error) {
        console.error("Synthesis or playback error:", error);
        stopTTS();
    }
}

async function prefetchNext() {
    if (!(await isPrefetchEnabled())) {
        console.log("Prefetching is disabled, skipping.");
        if (prefetchedData) {
            URL.revokeObjectURL(prefetchedData.audioUrl);
            prefetchedData = null;
        }
        return;
    }

    if (activeTtsTabId === null || selectionOnly) {
        if (prefetchedData) {
            URL.revokeObjectURL(prefetchedData.audioUrl);
        }
        prefetchedData = null;
        return;
    }

    try {
        const response = await browser.tabs.sendMessage(activeTtsTabId, { action: "peekNextBlockText" });
        const nextText = response?.text;

        if (!nextText || !nextText.trim()) {
            console.log("Prefetch: No next block to fetch.");
            if (prefetchedData) {
                URL.revokeObjectURL(prefetchedData.audioUrl);
            }
            prefetchedData = null;
            return;
        }

        console.log("Prefetching text:", nextText.substring(0, 50) + "...");
        const { voice, rate, pitch } = await browser.storage.sync.get({
            voice: "en-US-AnaNeural", rate: "0%", pitch: "0Hz"
        });

        const tts = new window.EdgeTTS();
        const prefetchedWordBoundaries = [];
        tts.onWordBoundary = (wordData) => {
            prefetchedWordBoundaries.push(wordData);
        };

        await tts.synthesize(nextText, voice, { rate, pitch });

        if (tts.audio_stream.length > 0) {
            const combinedAudio = tts.concatUint8Arrays(tts.audio_stream);
            const audioBlob = new Blob([combinedAudio], { type: "audio/mp3" });
            
            if (prefetchedData) {
                URL.revokeObjectURL(prefetchedData.audioUrl);
            }
            
            prefetchedData = {
                audioUrl: URL.createObjectURL(audioBlob),
                wordBoundaries: prefetchedWordBoundaries
            };
            console.log("Prefetch successful.");
        } else {
            console.warn("Prefetch: Synthesis returned no audio data.");
            prefetchedData = null;
        }
    } catch (error) {
        console.error("Prefetch failed:", error);
        if (prefetchedData) {
            URL.revokeObjectURL(prefetchedData.audioUrl);
        }
        prefetchedData = null;
    }
}

function resetTtsState() {
    console.log("Resetting TTS state (excluding activeTabId)...");
    runningTTS = false;
    isPaused = false;
    currentSentenceText = "";
}

function stopTTS(preserveTabId = false) {
    console.log("Stopping TTS...");
    stopPlaybackUpdater();
    
    if (currentAudioElement) {
        currentAudioElement.pause();
        const listener = audioEndedListeners.get(currentAudioElement);
        if(listener) currentAudioElement.removeEventListener('ended', listener);

        if (currentAudioElement.src && currentAudioElement.src.startsWith('blob:')) {
            URL.revokeObjectURL(currentAudioElement.src);
        }
        currentAudioElement = null;
    }

    if (prefetchedData) {
        URL.revokeObjectURL(prefetchedData.audioUrl);
        prefetchedData = null;
    }

    resetTtsState();
    pushUiUpdate();

    if (!preserveTabId) {
        activeTtsTabId = null;
        console.log("Cleared active TTS tab ID.");
    } else {
        console.log("Preserving active TTS tab ID.");
    }
}

function pauseTTS() {
    if (currentAudioElement && !isPaused) {
        console.log("Pausing TTS...");
        currentAudioElement.pause();
        isPaused = true;
        stopPlaybackUpdater();
        console.log(`TTS Paused at ${currentAudioElement.currentTime.toFixed(2)}s. Current block:`, currentSentenceText);
    } else {
        console.log("Cannot pause: No audio playing or already paused.");
    }
    pushUiUpdate();
}

async function resumeTTS() {
    if (!isPaused || !currentAudioElement) {
        if (isPaused) {
            console.log("Cannot resume: No audio element available to resume.");
        } else {
            console.log("Cannot resume: TTS is not currently paused.");
        }
        return;
    }

    console.log(`Resuming TTS from ${currentAudioElement.currentTime.toFixed(2)}s...`);

    currentAudioElement.play().catch(playError => {
        console.error("Error resuming audio playback, restarting block:", playError);
        stopTTS(true);
        runTTS(currentSentenceText);
        return;
    });

    isPaused = false;
    startPlaybackUpdater();

    pushUiUpdate();
    console.log("TTS Resumed.");
}

function pushUiUpdate() {
    if (activeTtsTabId === null) return;

    const currentState = { runningTTS, isPaused };
    browser.tabs.sendMessage(activeTtsTabId, {
        action: "updateUiState",
        state: currentState
    }).catch(error => {
        console.warn(`[pushUiUpdate] Failed to send UI update to tab ${activeTtsTabId}.`, error);
        if (error.message.includes("Invalid tab ID") || error.message.includes("Receiving end does not exist")) {
            console.log(`[pushUiUpdate] Tab ${activeTtsTabId} seems closed, stopping TTS.`);
            if (runningTTS) {
                stopTTS();
            } else {
                activeTtsTabId = null;
            }
        }
    });
}


async function startPlayback(tabId) {
    try {
        console.log("Starting playback from beginning...");
        selectionOnly = false;
        const response = await browser.tabs.sendMessage(tabId, { action: "getFirstBlock" });

        if (response?.text?.trim()) {
            console.log("Received first block:", response.text);
            activeTtsTabId = tabId;
            await runTTS(response.text);
            await browser.tabs.sendMessage(tabId, { action: "open-toolbar" });
        } else {
            console.warn("Content script did not return a first block. Cannot start Read Aloud.");
        }
    } catch (error) {
        console.error("Error starting playback:", error);
    }
}

function handlePlayPauseToggle() {
    if (runningTTS) {
        if (isPaused) {
            console.log("Action: Resuming TTS");
            resumeTTS();
        } else {
            console.log("Action: Pausing TTS");
            pauseTTS();
        }
    } else if (activeTtsTabId) {
        startPlayback(activeTtsTabId);
    }
}

async function handleNext() {
    console.log("Action: Next");
    if (activeTtsTabId !== null && runningTTS) {
        stopTTS(true);
        try {
            console.log("Requesting next block from content script...");
            const res = await browser.tabs.sendMessage(activeTtsTabId, { action: "getNextBlock" });
            if (res?.text?.trim()) {
                await runTTS(res.text);
            } else {
                console.log("No next block (end of content).");
                stopTTS();
                browser.tabs.sendMessage(activeTtsTabId, { action: "close-toolbar" });
            }
        } catch (err) {
            console.error("Error requesting next block:", err);
            stopTTS();
        }
    }
}

async function handlePrevious() {
    console.log("Action: Previous");
    if (activeTtsTabId !== null && runningTTS) {
        stopTTS(true);
        try {
            console.log("Requesting previous block from content script...");
            const res = await browser.tabs.sendMessage(activeTtsTabId, { action: "getPreviousBlock" });
            if (res?.text?.trim()) {
                await runTTS(res.text);
            } else {
                console.log("No previous block (start of content).");
                pushUiUpdate();
            }
        } catch (err) {
            console.error("Error requesting previous block:", err);
            stopTTS();
        }
    }
}

browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (!tab?.id) return;

    switch (info.menuItemId) {
        case "readAloud":
            await startPlayback(tab.id);
            break;

        case "readAloudFromHere":
            selectionOnly = false;
            if (info.selectionText?.trim()) {
                activeTtsTabId = tab.id;
                browser.tabs.sendMessage(tab.id, {
                    action: "getBlockContainingSelection",
                    selectionText: info.selectionText.trim()
                }).then(res => {
                    if (res?.text?.trim()) {
                        runTTS(res.text);
                        browser.tabs.sendMessage(tab.id, { action: "open-toolbar" });
                    } else {
                        console.warn("No block found containing selection; nothing to read.");
                    }
                }).catch(err => {
                    console.error("Error getting block for selection:", err);
                });
            } else {
                console.warn("ReadAloudFromHere clicked, but no text was selected.");
            }
            break;

        case "readAloudSelection":
            if (info.selectionText?.trim()) {
                selectionOnly = true;
                console.log(`Reading only selection: "${info.selectionText}"`);
                activeTtsTabId = tab.id;
                runTTS(info.selectionText);
                browser.tabs.sendMessage(tab.id, { action: "open-toolbar" });
            } else {
                console.warn("ReadAloudSelection clicked, but no text was selected.");
            }
            break;

        case "closeReadAloud":
            stopTTS();
            browser.tabs.sendMessage(tab.id, { action: "close-toolbar" });
            break;
    }
});

browser.contextMenus.onShown.addListener((info, tab) => {
    const selected = info.selectionText?.trim() || "";
    const wordCount = selected.split(/\s+/).filter(Boolean).length;

    browser.contextMenus.update("readAloudSelection", { visible: wordCount > 1 });
    browser.contextMenus.update("readAloudFromHere", { visible: wordCount === 1 });
    browser.contextMenus.update("closeReadAloud", { visible: runningTTS });
    browser.contextMenus.refresh();
});

browser.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    switch(message.action) {
        case "playButton":
            handlePlayPauseToggle();
            break;
        case "nextButton":
            handleNext();
            break;
        case "prevButton":
            handlePrevious();
            break;
        case "stopTTS":
            stopTTS();
            break;
    }
});

browser.commands.onCommand.addListener(async (command) => {
    console.log(`Command received: ${command}`);

    const [currentTab] = await browser.tabs.query({ active: true, currentWindow: true });

    switch (command) {
        case "toggle-play-pause":
            if (runningTTS) {
                handlePlayPauseToggle();
            } else if (currentTab?.id) {
                await startPlayback(currentTab.id);
            } else {
                 console.warn("Command: Cannot toggle play/pause, no active tab found.");
            }
            break;
        case "next-block":
            if (runningTTS) await handleNext();
            break;
        case "previous-block":
            if (runningTTS) await handlePrevious();
            break;
    }
});

browser.webRequest.onBeforeSendHeaders.addListener(
    details => {
        const headers = details.requestHeaders.map(header => {
            if (header.name.toLowerCase() === "user-agent") {
                return {
                    name: "User-Agent",
                    value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 Edg/119.0.0.0"
                };
            }
            return header;
        });
        return { requestHeaders: headers };
    },
    { urls: ["wss://speech.platform.bing.com/*"] },
    ["blocking", "requestHeaders"]
);

console.log("WebRequest test. Is it defined?", typeof browser.webRequest);