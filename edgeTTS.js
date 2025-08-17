// EdgeTTS.js

// ---- Global Constants ----
const Constants = {
	TRUSTED_CLIENT_TOKEN: '6A5AA1D4EAFF4E9FB37E23D68491D6F4',
	WSS_URL: 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1',
	VOICES_URL: 'https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list'
};

// ---------- GEC Hash Generator ----------
async function generateSecMsGec(trustedClientToken) {
	const WIN_EPOCH = 11644473600n; // Windows epoch offset (1601 → 1970)
	const INTERVAL = 300n;           // Round to nearest 5 minutes

	const unixTime = BigInt(Math.floor(Date.now() / 1000)); // seconds since 1970
	let fileTimeSec = unixTime + WIN_EPOCH;

	fileTimeSec -= fileTimeSec % INTERVAL;

	const ticks = (fileTimeSec * 10000000n) / 100n;

	const hashInput = ticks.toString() + trustedClientToken;
	const data = new TextEncoder().encode(hashInput);

	const hashBuffer = await crypto.subtle.digest("SHA-256", data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	const hexHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();

	return hexHash;
}

// ---- EdgeTTS Class Definition ----
class EdgeTTS {
	constructor() {
		this.audio_stream = []; // Array to hold Uint8Array pieces of audio
		this.audio_format = 'mp3';
		this.ws = null;
		this.onWordBoundary = null; // Callback for word boundary events
	}

	async getVoices() {
		const url = Constants.VOICES_URL + "?trustedclienttoken=" + Constants.TRUSTED_CLIENT_TOKEN;
		const response = await fetch(url);
		const data = await response.json();
		return data.map(voice => {
			delete voice.VoiceTag;
			delete voice.SuggestedCodec;
			delete voice.Status;
			return voice;
		});
	}

	generateUUID() {
		return 'xxxxxxxx-xxxx-xxxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
			const r = Math.random() * 16 | 0;
			const v = c === 'x' ? r : ((r & 0x3) | 0x8);
			return v.toString(16);
		});
	}

	validatePitch(pitch) {
		if (!/^(-?\d{1,3}Hz)$/.test(pitch)) {
			throw new Error("Invalid pitch format. Expected format: '-100Hz to 100Hz'.");
		}
		return pitch;
	}

	validateRate(rate) {
		if (!/^(-?\d{1,3}%)$/.test(rate)) {
			throw new Error("Invalid rate format. Expected format: '-100% to 100%'.");
		}
		return rate;
	}

	validateVolume(volume) {
		if (!/^(-?\d{1,3}%)$/.test(volume)) {
			throw new Error("Invalid volume format. Expected format: '-100% to 100%'.");
		}
		return volume;
	}

	getSSML(text, voice, options = {}) {
		options.pitch = (options.pitch || '0Hz').replace('hz', 'Hz');
		const pitch = this.validatePitch(options.pitch);
		const rate = this.validateRate(options.rate || '0%');
		const volume = this.validateVolume(options.volume || '0%');
		return `<speak version='1.0' xml:lang='en-US'><voice name='${voice}'><prosody pitch='${pitch}' rate='${rate}' volume='${volume}'>${text}</prosody></voice></speak>`;
	}

	buildTTSConfigMessage() {
		return `X-Timestamp:${new Date().toISOString()}Z\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
			`{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":false,"wordBoundaryEnabled":true},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}`;
	}

	// NEW: Parse different types of WebSocket messages
	parseWebSocketMessage(event) {
		if (event.data instanceof ArrayBuffer) {
			return {
				type: 'audio',
				data: event.data
			};
		}
		
		if (typeof event.data === 'string') {
			// Check for turn.end signal
			if (event.data.includes("Path:turn.end")) {
				return {
					type: 'end',
					data: event.data
				};
			}
			
			// Check for word boundary metadata
			if (event.data.includes("Path:audio.metadata")) {
				try {
					// Extract JSON from the message
					const lines = event.data.split('\r\n');
					const jsonLine = lines.find(line => line.startsWith('{'));
					if (jsonLine) {
						const metadata = JSON.parse(jsonLine);
						return {
							type: 'metadata',
							data: metadata
						};
					}
				} catch (e) {
					console.warn("Failed to parse metadata JSON:", e);
				}
			}
			
			// Unknown string message
			return {
				type: 'unknown',
				data: event.data
			};
		}
		
		return {
			type: 'unknown',
			data: event.data
		};
	}

	// NEW: Handle word boundary metadata
	processWordBoundaryMetadata(metadata) {
		if (metadata.Metadata && Array.isArray(metadata.Metadata)) {
			metadata.Metadata.forEach(item => {
				if (item.Type === 'WordBoundary' && item.Data) {
					const wordData = {
						offset: item.Data.Offset,
						duration: item.Data.Duration,
						text: item.Data.text
					};
					
					// Call the callback if it's set
					if (this.onWordBoundary && typeof this.onWordBoundary === 'function') {
						this.onWordBoundary(wordData);
					}
				}
			});
		}
	}

	async synthesize(text, voice = 'en-US-AnaNeural', options = {}) {
		let synthesisCompleted = false;
		return new Promise(async (resolve, reject) => {
			const connectionId = this.generateUUID().replace(/-/g, "");
			const secMsGec = await generateSecMsGec(Constants.TRUSTED_CLIENT_TOKEN);
			const wsUrl = `${Constants.WSS_URL}?TrustedClientToken=${Constants.TRUSTED_CLIENT_TOKEN}` +
				`&Sec-MS-GEC=${secMsGec}` +
				`&Sec-MS-GEC-Version=1-130.0.2849.68` +
				`&ConnectionId=${connectionId}`;

			this.ws = new WebSocket(wsUrl);
			this.ws.binaryType = "arraybuffer";
			const SSML_text = this.getSSML(text, voice, options);

			this.ws.onopen = () => {
				const configMessage = this.buildTTSConfigMessage();
				this.ws.send(configMessage);

				setTimeout(() => {
					const speechMessage = `X-RequestId:${connectionId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${new Date().toISOString()}Z\r\nPath:ssml\r\n\r\n${SSML_text}`;
					this.ws.send(speechMessage);
				}, 250);
			};

			this.ws.onmessage = (event) => {
				const message = this.parseWebSocketMessage(event);
				
				switch (message.type) {
					case 'end':
						synthesisCompleted = true;
						this.ws.close();
						break;
						
					case 'audio':
						this.processAudioData(message.data);
						break;
						
					case 'metadata':
						this.processWordBoundaryMetadata(message.data);
						break;
						
					case 'unknown':
						console.log("Unknown WebSocket message:", message.data);
						break;
				}
			};

			this.ws.onclose = () => {
				resolve();
			};

			this.ws.onerror = (err) => {
				if (!synthesisCompleted) {
					console.error("WebSocket failed before synthesis finished");
					reject(err);
				} else {
					console.warn("WebSocket error after successful synthesis:", err);
				}
			};
		});
	}

	processAudioData(data) {
		if (data instanceof ArrayBuffer) {
			const uint8Data = new Uint8Array(data);
			const needle = new TextEncoder().encode("Path:audio\r\n");
			const start_ind = this.uint8ArrayIndexOf(uint8Data, needle);
			if (start_ind !== -1) {
				const audioData = uint8Data.slice(start_ind + needle.length);
				this.audio_stream.push(audioData);
			}
		}
	}

	uint8ArrayIndexOf(haystack, needle) {
		for (let i = 0; i <= haystack.length - needle.length; i++) {
			let found = true;
			for (let j = 0; j < needle.length; j++) {
				if (haystack[i + j] !== needle[j]) {
					found = false;
					break;
				}
			}
			if (found) return i;
		}
		return -1;
	}

	concatUint8Arrays(arrays) {
		const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
		const result = new Uint8Array(totalLength);
		let offset = 0;
		arrays.forEach(arr => {
			result.set(arr, offset);
			offset += arr.length;
		});
		return result;
	}

	toFile(outputFilename) {
		if (this.audio_stream.length === 0) {
			throw new Error("No audio data available to save.");
		}
		const combined = this.concatUint8Arrays(this.audio_stream);
		const blob = new Blob([combined], { type: 'audio/mp3' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.style.display = 'none';
		a.href = url;
		a.download = `${outputFilename}.${this.audio_format}`;
		document.body.appendChild(a);
		a.click();
		setTimeout(() => {
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
		}, 100);
	}

	async toBase64() {
		if (this.audio_stream.length === 0) {
			throw new Error("No audio data available.");
		}
		const combined = this.concatUint8Arrays(this.audio_stream);
		let binary = "";
		for (let i = 0; i < combined.byteLength; i++) {
			binary += String.fromCharCode(combined[i]);
		}
		return btoa(binary);
	}

	async toRaw() {
		return this.toBase64();
	}
}

// ---- Expose EdgeTTS Globally ----
window.EdgeTTS = EdgeTTS;