// content.js

const styleEl = document.createElement("style");
styleEl.textContent = `
  .readAloudHighlight {
    background-color: var(--read-aloud-highlight-color, LightBlue) !important;
  }
  .readAloudWordHighlight {
    background-color: var(--read-aloud-word-highlight-color, yellow) !important;
    color: black !important;
    border-radius: 2px;
  }
`;
document.head.appendChild(styleEl);

async function applyHighlightColors() {
    try {
        const settings = await browser.storage.sync.get({
            highlightColor: '#add8e6',
            highlightTransparency: 25,
            wordHighlightColor: '#ffff00',
            wordHighlightTransparency: 100
        });
        
        const baseColor = settings.highlightColor;
        const transparency = settings.highlightTransparency;
        const alpha = transparency / 100;
        let cssColorValue = applyColorWithAlpha(baseColor, alpha);
        document.documentElement.style.setProperty('--read-aloud-highlight-color', cssColorValue);
        
        const wordBaseColor = settings.wordHighlightColor;
        const wordTransparency = settings.wordHighlightTransparency;
        const wordAlpha = wordTransparency / 100;
        let wordCssColorValue = applyColorWithAlpha(wordBaseColor, wordAlpha);
        document.documentElement.style.setProperty('--read-aloud-word-highlight-color', wordCssColorValue);
        
    } catch (e) {
        console.error("Read Aloud: Could not apply highlight colors.", e);
    }
}

function applyColorWithAlpha(baseColor, alpha) {
    let cssColorValue = `rgba(0, 0, 0, ${alpha})`;

    if (baseColor.startsWith("#") && baseColor.length === 7) {
        const r = parseInt(baseColor.slice(1, 3), 16);
        const g = parseInt(baseColor.slice(3, 5), 16);
        const b = parseInt(baseColor.slice(5, 7), 16);
        cssColorValue = `rgba(${r}, ${g}, ${b}, ${alpha})`;
    } else {
        console.warn("Read Aloud: Color is not a valid hex code. Applying transparency will not work.");
        cssColorValue = baseColor;
    }
    
    return cssColorValue;
}

applyHighlightColors();

browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && (changes.highlightColor || changes.highlightTransparency || 
                           changes.wordHighlightColor || changes.wordHighlightTransparency)) {
        applyHighlightColors();
    }
});


function normalize(str) {
	return str
		.replace(/\[[0-9]+\]/g, "")
		.replace(/\/[^\/]+\/|ℹ/g, "")
		.replace(/\s+/g, " ")
		.trim()
		.toLowerCase();
}

let voiceOptionsPanelResizeHandler = null;
let closePanelOnClickOutsideHandler = null;

function toggleVoiceOptionsPanel() {
	const toolbar = document.getElementById("extension-toolbar");
	if (!toolbar) return;

	const existing = toolbar.querySelector("#voice-options-panel");
	if (existing) {
		existing.remove();
		if (voiceOptionsPanelResizeHandler) {
			window.removeEventListener("message", voiceOptionsPanelResizeHandler);
			voiceOptionsPanelResizeHandler = null;
		}

		if (closePanelOnClickOutsideHandler) {
			document.removeEventListener('click', closePanelOnClickOutsideHandler);
			closePanelOnClickOutsideHandler = null;
		}
		return;
	}

	const panel = document.createElement("iframe");
	panel.id = "voice-options-panel";
	panel.src = browser.runtime.getURL("popup.html");
	Object.assign(panel.style, {
		position: "absolute",
		top: "40px",
		right: "10px",
		minWidth: "300px",
		border: "1px solid #ccc",
		boxShadow: "0 2px 8px rgb(56, 54, 54)",
		zIndex: 10001,
		background: "white",
		transition: "height 0.2s ease-in-out, width 0.2s ease-in-out"
	});

	voiceOptionsPanelResizeHandler = (event) => {
		if (event.source !== panel.contentWindow) {
			return;
		}
		if (event.data && event.data.type === 'resize-voice-options-panel') {
			if (typeof event.data.height === 'number') {
				panel.style.height = `${event.data.height}px`;
			}
			if (typeof event.data.width === 'number') {
				panel.style.width = `${event.data.width}px`;
			}
		}
	};
	window.addEventListener("message", voiceOptionsPanelResizeHandler);

	toolbar.appendChild(panel);

	closePanelOnClickOutsideHandler = (event) => {
		const currentToolbar = document.getElementById("extension-toolbar");
		const currentPanel = document.getElementById("voice-options-panel");

		if (currentToolbar && currentPanel && !currentToolbar.contains(event.target)) {
			toggleVoiceOptionsPanel();
		}
	};

	setTimeout(() => {
		document.addEventListener('click', closePanelOnClickOutsideHandler);
	}, 0);
}

let lastHighlightedElement = null;
let lastHighlightedSpan = null;
let currentWordHighlightSpan = null;

let currentWordBoundaries = [];
let currentBlockWordMap = [];
let lastHighlightedWordIndex = -1;

let readableBlocks = [];
let readableSentences = [];
let currentBlockIndex = -1;
let currentSentenceIndex = -1;
let currentNavigationMode = "block";

function buildWordMap(dirtyText, cleanText) {
    const map = [];
    let dirtyPtr = 0;
    let cleanPtr = 0;

    while (cleanPtr < cleanText.length) {
        if (/\s/.test(cleanText[cleanPtr])) {
            cleanPtr++;
            continue;
        }

        const wordStartClean = cleanPtr;
        while (cleanPtr < cleanText.length && !/\s/.test(cleanText[cleanPtr])) {
            cleanPtr++;
        }
        const wordEndClean = cleanPtr;
        const currentCleanWord = cleanText.substring(wordStartClean, wordEndClean);

        let alignPtr = 0;
        let wordStartDirty = -1;
        while (dirtyPtr < dirtyText.length && alignPtr < currentCleanWord.length) {
            const dirtyCharLower = dirtyText[dirtyPtr].toLowerCase();
            const cleanChar = currentCleanWord[alignPtr];

            if (dirtyCharLower === cleanChar) {
                if (wordStartDirty === -1) {
                    wordStartDirty = dirtyPtr;
                }
                alignPtr++;
            } else if (wordStartDirty !== -1) {
            }
            dirtyPtr++;
        }
        
        if (alignPtr === currentCleanWord.length) {
            map.push({
                text: currentCleanWord,
                startIndex: wordStartDirty,
                endIndex: dirtyPtr
            });
        } else {
            console.warn(`Read Aloud: Could not fully align word "${currentCleanWord}". Highlighting may be affected.`);
        }
    }
    return map;
}

function splitIntoSentences(text) {
    const sentences = text.match(/[^.!?]+[.!?]*(\s+|$)/g) || [text];
    return sentences.map(s => s.trim()).filter(s => s.length > 0);
}

async function loadNavigationMode() {
    try {
        const stored = await browser.storage.sync.get({ navigationMode: "block" });
        currentNavigationMode = stored.navigationMode;
    } catch (error) {
        console.warn("Failed to load navigation mode, defaulting to block:", error);
        currentNavigationMode = "block";
    }
}

function extractReadableBlocks() {
	readableBlocks = [];
	readableSentences = [];
	currentBlockIndex = -1;
	currentSentenceIndex = -1;

	const article = new Readability(document.cloneNode(true)).parse();
	if (!article?.content) return;

	const frag = document.createElement("div");
	frag.innerHTML = article.content;

	const selector = "p, li, h1, h2, h3, h4, h5, h6";
	const fragBlocks = Array.from(frag.querySelectorAll(selector));
	const liveBlocks = Array.from(document.querySelectorAll(selector));

	let liveIdx = 0;
	for (const fragEl of fragBlocks) {
		const text = fragEl.textContent.trim();
		if (!text) continue;

		for (let i = liveIdx; i < liveBlocks.length; i++) {
			const liveEl = liveBlocks[i];
            const dirtyText = liveEl.textContent;
            const cleanTextForComparison = normalize(dirtyText);
            const fragCleanText = normalize(text);

			if (cleanTextForComparison === fragCleanText || cleanTextForComparison.startsWith(fragCleanText.slice(0, 40))) {

                const cleanText = normalize(dirtyText);
                const wordMap = buildWordMap(dirtyText, cleanText);

				const blockEntry = {
					text: cleanText,
					element: liveEl,
                    wordMap: wordMap
				};
				readableBlocks.push(blockEntry);
                const blockIdx = readableBlocks.length - 1;

                let wordMapCursor = 0;
				const sentences = splitIntoSentences(cleanText);

				sentences.forEach((sentenceText, sentenceIdx) => {
                    const sentenceWordCount = (sentenceText.match(/\S+/g) || []).length;
                    const wordMapSlice = wordMap.slice(wordMapCursor, wordMapCursor + sentenceWordCount);

					readableSentences.push({
						text: sentenceText,
						element: liveEl,
						blockIndex: blockIdx,
						sentenceIndex: sentenceIdx,
                        wordMap: wordMapSlice
					});
                    wordMapCursor += sentenceWordCount;
				});

				liveIdx = i + 1;
				break;
			}
		}
	}
}

async function getFirstBlock() {
	if (readableBlocks.length === 0) extractReadableBlocks();
	await loadNavigationMode();
	
	if (currentNavigationMode === "sentence") {
		currentSentenceIndex = 0;
        const sentence = readableSentences[0];
		currentBlockIndex = sentence?.blockIndex ?? -1;
		return sentence?.text || "";
	} else {
		currentBlockIndex = 0;
		currentSentenceIndex = -1;
		return readableBlocks[0]?.text || "";
	}
}

async function getNextBlock() {
	await loadNavigationMode();
	
	if (currentNavigationMode === "sentence") {
		if (currentSentenceIndex < readableSentences.length - 1) {
			currentSentenceIndex++;
		}
        const sentence = readableSentences[currentSentenceIndex];
		currentBlockIndex = sentence?.blockIndex ?? currentBlockIndex;
		return sentence?.text || "";
	} else {
		if (currentBlockIndex < readableBlocks.length - 1) {
			currentBlockIndex++;
		}
		currentSentenceIndex = -1;
		return readableBlocks[currentBlockIndex]?.text || "";
	}
}

async function getPreviousBlock() {
	await loadNavigationMode();
	
	if (currentNavigationMode === "sentence") {
		if (currentSentenceIndex > 0) {
			currentSentenceIndex--;
		}
        const sentence = readableSentences[currentSentenceIndex];
		currentBlockIndex = sentence?.blockIndex ?? currentBlockIndex;
		return sentence?.text || "";
	} else {
		if (currentBlockIndex > 0) {
			currentBlockIndex--;
		}
		currentSentenceIndex = -1;
		return readableBlocks[currentBlockIndex]?.text || "";
	}
}

async function peekNextBlockText() {
    await loadNavigationMode();
    if (currentNavigationMode === "sentence") {
        if (currentSentenceIndex < readableSentences.length - 1) {
            return readableSentences[currentSentenceIndex + 1]?.text || null;
        }
    } else {
        if (currentBlockIndex < readableBlocks.length - 1) {
            return readableBlocks[currentBlockIndex + 1]?.text || null;
        }
    }
    return null;
}

function clearWordHighlight() {
    if (currentWordHighlightSpan) {
        const parent = currentWordHighlightSpan.parentNode;
        if (parent) {
            while (currentWordHighlightSpan.firstChild) {
                parent.insertBefore(currentWordHighlightSpan.firstChild, currentWordHighlightSpan);
            }
            parent.removeChild(currentWordHighlightSpan);
            parent.normalize();
        }
        currentWordHighlightSpan = null;
    }
}

function clearHighlight() {
    clearWordHighlight();

    currentBlockWordMap = [];
    currentWordBoundaries = [];
    lastHighlightedWordIndex = -1;

	if (lastHighlightedElement) {
		lastHighlightedElement.classList.remove("readAloudHighlight");
		lastHighlightedElement = null;
	}
	
	if (lastHighlightedSpan) {
		const parent = lastHighlightedSpan.parentNode;
		if (parent) {
			while (lastHighlightedSpan.firstChild) {
				parent.insertBefore(lastHighlightedSpan.firstChild, lastHighlightedSpan);
			}
			parent.removeChild(lastHighlightedSpan);
			parent.normalize();
		}
		lastHighlightedSpan = null;
	}
}

function highlightCurrentBlock() {
	clearHighlight();

	let elementToScrollTo = null;
    let currentUnit = null;

    if (currentNavigationMode === "sentence" && currentSentenceIndex !== -1) {
        currentUnit = readableSentences[currentSentenceIndex];
    } else if (currentBlockIndex !== -1) {
        currentUnit = readableBlocks[currentBlockIndex];
    }

    if (!currentUnit) return;

    currentBlockWordMap = currentUnit.wordMap;

	if (currentNavigationMode === "sentence" && currentSentenceIndex >= 0) {
		const sentenceEntry = readableSentences[currentSentenceIndex];
		if (sentenceEntry) {
			const element = sentenceEntry.element;
			
            const sentenceMap = sentenceEntry.wordMap;
            if (!sentenceMap || sentenceMap.length === 0) {
                element.classList.add("readAloudHighlight");
				lastHighlightedElement = element;
				elementToScrollTo = element;
            } else {
                const startOffset = sentenceMap[0].startIndex;
                const endOffset = sentenceMap[sentenceMap.length - 1].endIndex;
                const range = createRangeFromOffsets(element, startOffset, endOffset);
                
                if (range) {
                    try {
                        const span = document.createElement('span');
						span.className = 'readAloudHighlight';
						range.surroundContents(span);
						lastHighlightedSpan = span;
						elementToScrollTo = span;
                    } catch (e) {
                        console.warn("Failed to highlight sentence with a span, falling back to block highlight.", e);
                        element.classList.add("readAloudHighlight");
                        lastHighlightedElement = element;
                        elementToScrollTo = element;
                    }
                } else {
                    element.classList.add("readAloudHighlight");
                    lastHighlightedElement = element;
                    elementToScrollTo = element;
                }
            }
		}
	} else if (currentBlockIndex >= 0) {
		const blockEntry = readableBlocks[currentBlockIndex];
		if (blockEntry) {
			blockEntry.element.classList.add("readAloudHighlight");
			lastHighlightedElement = blockEntry.element;
			elementToScrollTo = blockEntry.element;
		}
	}

	if (elementToScrollTo) {
		const rect = elementToScrollTo.getBoundingClientRect();
		const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
		const toolbarHeight = 40;

		const isOffscreen = rect.top < toolbarHeight || rect.bottom > viewportHeight;

		if (isOffscreen) {
			const offset = toolbarHeight + 15;
			const elementPosition = rect.top + window.scrollY;
			const targetPosition = elementPosition - offset;

			window.scrollTo({
				top: targetPosition,
				behavior: 'smooth'
			});
		}
	}
}

async function getBlockContainingSelection() {
	if (readableBlocks.length === 0) extractReadableBlocks();
	await loadNavigationMode();

	const sel = window.getSelection();
	if (!sel || sel.isCollapsed) return "";

	let node = sel.anchorNode;
	let element = (node.nodeType === Node.ELEMENT_NODE) ? node : node.parentElement;

	while (element) {
		const blockIdx = readableBlocks.findIndex(entry => entry.element === element);
		if (blockIdx !== -1) {
			if (currentNavigationMode === "sentence") {
				const container = readableBlocks[blockIdx].element;
				const sentencesInBlock = readableSentences.filter(s => s.blockIndex === blockIdx);
				let targetSentence = null;

				try {
					const selectionRange = sel.getRangeAt(0);

					targetSentence = sentencesInBlock.find(sentence => {
						const sentenceMap = sentence.wordMap;
						if (!sentenceMap || sentenceMap.length === 0) return false;

						const startOffset = sentenceMap[0].startIndex;
						const endOffset = sentenceMap[sentenceMap.length - 1].endIndex;
						const sentenceRange = createRangeFromOffsets(container, startOffset, endOffset);

						if (sentenceRange) {
							const isAfterStart = selectionRange.compareBoundaryPoints(Range.START_TO_START, sentenceRange) >= 0;
							const isBeforeEnd = selectionRange.compareBoundaryPoints(Range.END_TO_END, sentenceRange) <= 0;
							return isAfterStart && isBeforeEnd;
						}
						return false;
					});
				} catch (e) {
					console.error("Error finding selected sentence, falling back.", e);
					targetSentence = null;
				}

				if (targetSentence) {
					currentSentenceIndex = readableSentences.indexOf(targetSentence);
					currentBlockIndex = blockIdx;
					return targetSentence.text;
				}

				const firstSentenceIdx = readableSentences.findIndex(entry => entry.blockIndex === blockIdx);
				if (firstSentenceIdx !== -1) {
					currentSentenceIndex = firstSentenceIdx;
					currentBlockIndex = blockIdx;
					return readableSentences[firstSentenceIdx].text;
				}
			} else {
				currentBlockIndex = blockIdx;
				currentSentenceIndex = -1;
				return readableBlocks[blockIdx].text;
			}
		}
		element = element.parentElement;
	}

    currentBlockWordMap = buildWordMap(sel.toString(), normalize(sel.toString()));
	return normalize(sel.toString());
}

function createRangeFromOffsets(container, startOffset, endOffset) {
    if (startOffset < 0 || endOffset < startOffset) return null;

    const range = document.createRange();
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
    let currentPos = 0;
    let startNode = null, rangeStartOffset = 0, endNode = null, rangeEndOffset = 0;
    let textNode;

    while ((textNode = walker.nextNode())) {
        const nodeLength = textNode.textContent.length;
        const nodeEnd = currentPos + nodeLength;

        if (!startNode && nodeEnd >= startOffset) {
            startNode = textNode;
            rangeStartOffset = startOffset - currentPos;
        }
        if (!endNode && nodeEnd >= endOffset) {
            endNode = textNode;
            rangeEndOffset = endOffset - currentPos;
            break;
        }
        currentPos = nodeEnd;
    }

    if (startNode && endNode) {
        try {
            range.setStart(startNode, rangeStartOffset);
            range.setEnd(endNode, rangeEndOffset);
            return range;
        } catch (e) {
            console.error("Read Aloud: Error setting range", e, { startNode, rangeStartOffset, endNode, rangeEndOffset });
            return null;
        }
    }
    
    console.warn("Read Aloud: Could not create DOM range from offsets.", {container, startOffset, endOffset});
    return null;
}

function highlightWordByIndex(wordIndex) {
    clearWordHighlight();

    if (!currentBlockWordMap || wordIndex < 0 || wordIndex >= currentBlockWordMap.length) {
        return;
    }

    const wordMapEntry = currentBlockWordMap[wordIndex];
    if (!wordMapEntry) return;

    const highlightContainer = lastHighlightedSpan || lastHighlightedElement;
    if (!highlightContainer) return;

    let { startIndex, endIndex } = wordMapEntry;

    if (currentNavigationMode === 'sentence' && lastHighlightedSpan && currentBlockWordMap.length > 0) {
        const sentenceStartOffsetInBlock = currentBlockWordMap[0].startIndex;
        startIndex -= sentenceStartOffsetInBlock;
        endIndex -= sentenceStartOffsetInBlock;
    }

    const range = createRangeFromOffsets(highlightContainer, startIndex, endIndex);
    if (!range) {
        console.warn(`Read Aloud: Failed to create range for word: "${wordMapEntry.text}" at adjusted offsets ${startIndex}-${endIndex}`);
        return;
    }

    try {
        const span = document.createElement('span');
        span.className = 'readAloudWordHighlight';
        const contents = range.extractContents();
        span.appendChild(contents);
        range.insertNode(span);
        currentWordHighlightSpan = span;
    } catch (e) {
        console.error("Read Aloud: Error during word highlighting span insertion.", e);
        if (currentWordHighlightSpan) currentWordHighlightSpan.remove();
    }
}

let indicatorGIF = null;

function showIndicator(indicatorFlag) {
	indicatorGIF.style.display = indicatorFlag ? "" : "none";
}

let btnPlayPause = null;

function showPlayButton(showFlag) {
	btnPlayPause.textContent = showFlag ? "▶" : "⏸";
}

function createToolbar() {
	const toolbar = document.createElement("div");
	toolbar.id = "extension-toolbar";
	toolbar.style.position = "fixed";
	toolbar.style.top = "0";
	toolbar.style.left = "0";
	toolbar.style.width = "100%";
	toolbar.style.height = "40px";
	toolbar.style.display = "flex";
	toolbar.style.alignItems = "center";
	toolbar.style.justifyContent = "space-between";
	toolbar.style.padding = "0 10px";
	toolbar.style.borderBottom = "1px solid #ccc";
	toolbar.style.zIndex = "10000";

	const containerIndicator = document.createElement("div");
	containerIndicator.style.display = "flex";
	containerIndicator.style.alignItems = "center";
	containerIndicator.style.gap = "10px";

	indicatorGIF = document.createElement("img");
	indicatorGIF.src = browser.runtime.getURL("speaker.gif");
	indicatorGIF.style.width = "20px";
	indicatorGIF.style.height = "20px";

	const indicatorHeader = document.createElement("span");
	indicatorHeader.textContent = "Read Aloud";
	indicatorHeader.style.color = "cyan"

	const containerControls = document.createElement("div");
	containerControls.style.display = "flex";
	containerControls.style.alignItems = "center";
	containerControls.style.gap = "10px";

	const btnPrev = document.createElement("button");
	btnPrev.textContent = "⏮";
	btnPrev.style.fontSize = "16px";
	btnPrev.addEventListener("click", () => {
		console.log("[content.js] Sending prevButton command to background.");
		browser.runtime.sendMessage({ action: "prevButton" })
			.catch(error => console.error("Error sending prevButton message:", error));
	});

	btnPlayPause = document.createElement("button");
	btnPlayPause.textContent = "⏸";
	btnPlayPause.style.fontSize = "16px";
	btnPlayPause.addEventListener("click", () => {
		console.log("[content.js] Sending playButton command to background.");
		browser.runtime.sendMessage({ action: "playButton" }).catch(error => {
			console.error("Error sending playButton message:", error);
		});
	});

	const btnNext = document.createElement("button");
	btnNext.textContent = "⏭";
	btnNext.style.fontSize = "16px";
	btnNext.addEventListener("click", () => {
		console.log("[content.js] Next button clicked, sending command.");
		browser.runtime.sendMessage({ action: "nextButton" }).catch(error => {
			console.error("Error sending nextButton message:", error);
		});
	});

	const containerTTSOptions = document.createElement("div");
	containerTTSOptions.style.display = "flex";
	containerTTSOptions.style.alignItems = "center";
	containerTTSOptions.style.gap = "20px";

	const voiceOptionsButton = document.createElement("button");
	voiceOptionsButton.id = "voice-options-button";
	voiceOptionsButton.textContent = "⚙️";
	voiceOptionsButton.style.fontSize = "16px";
	voiceOptionsButton.style.cursor = "pointer";
	voiceOptionsButton.addEventListener("click", toggleVoiceOptionsPanel);

	const closeButton = document.createElement("button");
	closeButton.id = "close-toolbar-button";
	closeButton.textContent = "x";
	closeButton.style.fontSize = "32px";
	closeButton.style.color = "white";
	closeButton.style.padding = "5px 10px";
	closeButton.style.border = "none";
	closeButton.style.cursor = "pointer";
	closeButton.style.zIndex = "10001";
	closeButton.addEventListener("click", () => {
		removeToolbar();
	});

	containerIndicator.appendChild(indicatorGIF);
	containerIndicator.appendChild(indicatorHeader);

	containerControls.appendChild(btnPrev);
	containerControls.appendChild(btnPlayPause);
	containerControls.appendChild(btnNext);

	containerTTSOptions.appendChild(voiceOptionsButton);
	containerTTSOptions.appendChild(closeButton);

	toolbar.appendChild(containerIndicator);
	toolbar.appendChild(containerControls);
	toolbar.appendChild(containerTTSOptions);

	document.body.appendChild(toolbar);
	document.body.style.paddingTop = "40px";
}

function removeToolbar() {
	const toolbar = document.getElementById("extension-toolbar");
	if (toolbar) {
		browser.runtime.sendMessage({ action: "stopTTS" });
		clearHighlight();
		toolbar.remove();
		document.body.style.paddingTop = "";
	}
}

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
	const toolbar = document.getElementById("extension-toolbar");
	switch (message.action) {
		case "open-toolbar":
			if (!toolbar) createToolbar();
			return;

		case "close-toolbar":
			if (toolbar) removeToolbar();
			else clearHighlight();
			return;

		case "getFirstBlock":
			getFirstBlock().then(text => {
				highlightCurrentBlock();
				sendResponse({ text });
			});
			return true;

		case "getNextBlock":
			getNextBlock().then(text => {
				highlightCurrentBlock();
				sendResponse({ text });
			});
			return true;

		case "getPreviousBlock":
			getPreviousBlock().then(text => {
				highlightCurrentBlock();
				sendResponse({ text });
			});
			return true;

		case "getBlockContainingSelection":
			getBlockContainingSelection(message.selectionText || "").then(blockText => {
                highlightCurrentBlock();
				sendResponse({ text: blockText });
			});
			return true;

		case "peekNextBlockText":
			peekNextBlockText().then(text => {
				sendResponse({ text: text });
			});
			return true;
        
        case "startBlockPlayback":
            clearWordHighlight();
            currentWordBoundaries = message.boundaries;
            lastHighlightedWordIndex = -1;
            return;

        case "updatePlaybackTime":
            if (currentWordBoundaries.length > 0) {
                const currentTimeMs = message.time * 1000;
                
                let wordIndexToHighlight = -1;
                for (let i = 0; i < currentWordBoundaries.length; i++) {
                    const wordStartTimeMs = currentWordBoundaries[i].offset / 10000;
                    if (wordStartTimeMs <= currentTimeMs) {
                        wordIndexToHighlight = i;
                    } else {
                        break;
                    }
                }
                
                if (wordIndexToHighlight !== -1 && wordIndexToHighlight !== lastHighlightedWordIndex) {
                    lastHighlightedWordIndex = wordIndexToHighlight;
                    highlightWordByIndex(wordIndexToHighlight);
                }
            }
            return;

		case "updateUiState":
			const state = message.state;
			if (toolbar && state) {
				if (state.runningTTS) {
					showIndicator(!state.isPaused);
					showPlayButton(state.isPaused);
				} else {
					showIndicator(false);
					showPlayButton(true);
				}
			} else if (!toolbar) {
			} else {
				console.warn("[content.js] Cannot update UI state - state missing.");
			}
			return;
	}
});