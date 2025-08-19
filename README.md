# Edge Text-To-Speech For All

A proof of concept browser extension attempting to port Edge's Text-To-Speech, as well as Edge's on-page word & sentence highlighting, and automatic page navigation into different browsers. The core of the code came from the ['Edge TTS' repository by Andresayac.](https://github.com/andresayac/edge-tts/)

![Extension Status](https://img.shields.io/badge/status-active%20development-green)
![Firefox Nightly](https://img.shields.io/badge/Firefox_Nightly-compatible-orange)


## How to Use It

### Quick Start
1. **Start reading**: Press `Ctrl+Shift+U` or right-click and choose "Read Aloud"
2. **Control playback**: Use the toolbar that appears at the top
3. **Adjust settings**: Click the gear icon to change voice, speed, etc.

### Reading Options
- **Read entire page**: Right-click anywhere → "Read Aloud"
- **Read from a specific spot**: Right-click on text → "Read Aloud From Here"  
- **Read just selected text**: Select text → right-click → "Read Aloud Selection"

### Keyboard Controls
- `Ctrl+Shift+U` - Start/pause reading
- `Ctrl+Shift+←` - Go back
- `Ctrl+Shift+→` - Go forward

## Installation

- This extension requires Firefox Nightly
- https://www.firefox.com/en-US/channel/desktop/#nightly

### 1. Temporary Installation
1. Download the `.zip` from this page. Extract to a folder.
2. In Firefox, go to `about:debugging`
3. Click "Load Temporary Add-on" and select the `manifest.json` file in your extracted folder
   
### 2. Permament Installation (Not recommended)
** Note: Permanent installation is not recommended because it requires `xpinstall.signatures.required` be set to false. **

1. Open Firefox Nightly.
2. Go to `about:config`.
3. Set `xpinstall.signatures.required` to `false`.
4. Download the `.zip` from this page.
5. Rename the file extension from `.zip` to `.xpi`
6. In Nightly, open Add-ons Manager (Menu → Add-ons).
7. Click gear icon → Install Add-on From File.... Select your `.xpi`. Confirm installation.

## Found a bug? [Report it here](https://github.com/TiredOfEverything/Edge-TTS-4-All/issues)
