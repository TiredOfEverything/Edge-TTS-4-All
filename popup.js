// popup.js

(async () => {
    const slider = document.getElementById("sliderInput");
    const sliderValue = document.getElementById("sliderValue");
    const pitchSlider = document.getElementById("pitchSlider");
    const pitchValue = document.getElementById("pitchValue");
    const voiceSelect = document.getElementById("voiceSelect");
    const navModeSelect = document.getElementById("navModeSelect");
    const highlightColorInput = document.getElementById("highlightColorInput");
    const highlightTransparencyInput = document.getElementById("highlightTransparencyInput");
    const highlightTransparencyValue = document.getElementById("highlightTransparencyValue");
    
    const wordHighlightColorInput = document.getElementById("wordHighlightColorInput");
    const wordHighlightTransparencyInput = document.getElementById("wordHighlightTransparencyInput");
    const wordHighlightTransparencyValue = document.getElementById("wordHighlightTransparencyValue");
    
    const prefetchEnabledInput = document.getElementById("prefetchEnabledInput");

    const STORAGE_DEFAULTS = {
        rate: "0%",
        pitch: "0Hz",
        voice: "en-US-AnaNeural",
        navigationMode: "block",
        highlightColor: "#add8e6",
        highlightTransparency: 25,
        wordHighlightColor: "#ffff00",
        wordHighlightTransparency: 100,
        prefetchEnabled: true
    };

    async function loadSettings() {
        const stored = await browser.storage.sync.get(STORAGE_DEFAULTS);
        return {
            rate: stored.rate,
            pitch: stored.pitch,
            voice: stored.voice,
            navigationMode: stored.navigationMode,
            highlightColor: stored.highlightColor,
            highlightTransparency: stored.highlightTransparency,
            wordHighlightColor: stored.wordHighlightColor,
            wordHighlightTransparency: stored.wordHighlightTransparency,
            prefetchEnabled: stored.prefetchEnabled
        };
    }

    async function saveSetting(key, value) {
        await browser.storage.sync.set({ [key]: value });
    }
    
    const contentWrapper = document.getElementById('content-wrapper');
    const sendResizeMessage = () => {
        const requiredHeight = contentWrapper.scrollHeight;
        const requiredWidth = contentWrapper.scrollWidth;

        window.parent.postMessage({
            type: 'resize-voice-options-panel',
            height: requiredHeight,
            width: requiredWidth
        }, '*'); 
    };

    const tabButtons = document.querySelectorAll('.tab-button');
    const tabPanes = document.querySelectorAll('.tab-pane');
    
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabPanes.forEach(pane => pane.classList.remove('active'));

            const tabId = button.dataset.tab;
            button.classList.add('active');
            document.getElementById(tabId).classList.add('active');

            sendResizeMessage();
        });
    });

    // 1. Populate voices dropdown
    try {
        const tts = new EdgeTTS();
        const voices = await tts.getVoices();
        voices.forEach(v => {
            const option = document.createElement("option");
            option.value = v.ShortName || v.Name || v.voiceName || v.name;
            option.textContent = v.DisplayName || v.LocalName || option.value;
            voiceSelect.appendChild(option);
        });
    } catch (err) {
        console.error("Failed to load voices:", err);
    }

    // 2. Initialize controls from storage
    const { 
        rate, 
        pitch, 
        voice, 
        navigationMode, 
        highlightColor, 
        highlightTransparency,
        wordHighlightColor,
        wordHighlightTransparency,
        prefetchEnabled
    } = await loadSettings();
    
    slider.value = parseInt(rate, 10);
    sliderValue.textContent = `${rate}`;

    pitchSlider.value = parseInt(pitch, 10);
    pitchValue.textContent = pitch;

    voiceSelect.value = voice;
    navModeSelect.value = navigationMode;
    highlightColorInput.value = highlightColor;
    highlightTransparencyInput.value = highlightTransparency;
    highlightTransparencyValue.textContent = `${highlightTransparency}%`;

    wordHighlightColorInput.value = wordHighlightColor;
    wordHighlightTransparencyInput.value = wordHighlightTransparency;
    wordHighlightTransparencyValue.textContent = `${wordHighlightTransparency}%`;

    prefetchEnabledInput.checked = prefetchEnabled;

    // 3. Hook up events to persist changes
    slider.addEventListener("input", async () => {
        const pct = `${slider.value}%`;
        sliderValue.textContent = pct;
        await saveSetting("rate", pct);
    });

    pitchSlider.addEventListener("input", async () => {
        const ph = `${pitchSlider.value}Hz`;
        pitchValue.textContent = ph;
        await saveSetting("pitch", ph);
    });

    voiceSelect.addEventListener("change", async () => {
        const v = voiceSelect.value;
        await saveSetting("voice", v);
    });

    navModeSelect.addEventListener("change", async () => {
        const mode = navModeSelect.value;
        await saveSetting("navigationMode", mode);
    });

    highlightColorInput.addEventListener("input", async () => {
        const color = highlightColorInput.value;
        await saveSetting("highlightColor", color);
    });

    highlightTransparencyInput.addEventListener("input", async () => {
        const transparency = highlightTransparencyInput.value;
        highlightTransparencyValue.textContent = `${transparency}%`;
        await saveSetting("highlightTransparency", parseInt(transparency, 10));
    });

    wordHighlightColorInput.addEventListener("input", async () => {
        const color = wordHighlightColorInput.value;
        await saveSetting("wordHighlightColor", color);
    });

    wordHighlightTransparencyInput.addEventListener("input", async () => {
        const transparency = wordHighlightTransparencyInput.value;
        wordHighlightTransparencyValue.textContent = `${transparency}%`;
        await saveSetting("wordHighlightTransparency", parseInt(transparency, 10));
    });

    prefetchEnabledInput.addEventListener("change", async () => {
        const enabled = prefetchEnabledInput.checked;
        await saveSetting("prefetchEnabled", enabled);
    });

    const resizeObserver = new ResizeObserver(sendResizeMessage);
    resizeObserver.observe(document.body);
    sendResizeMessage();
})();