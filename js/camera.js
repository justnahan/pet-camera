/**
 * PetCam — camera.js v5
 * Unified UI: setupScreen → liveView transition
 * Features: enumerate all cameras, flip cycling, chime, data channel for remote flip
 */

var PREF_PEER_ID = 'petcam_camera_id';
var PREF_CAM_INDEX = 'petcam_cam_index';

var peer = null;
var currentCall = null;
var localStream = null;
var cameraDevices = [];
var currentCamIndex = parseInt(localStorage.getItem(PREF_CAM_INDEX) || '0', 10);

// Setup screen elements
var setupScreen = document.getElementById('setupScreen');
var liveView = document.getElementById('liveView');
var peerIdDisplay = document.getElementById('peerIdDisplay');
var statusDot = document.getElementById('statusDot');
var statusText = document.getElementById('statusText');
var startBtn = document.getElementById('startCameraButton');

// Live view elements
var localVideo = document.getElementById('localVideo');
var liveIdDisplay = document.getElementById('liveIdDisplay');
var liveStatusDot = document.getElementById('liveStatusDot');
var liveStatusText = document.getElementById('liveStatusText');
var remoteAudio = document.getElementById('remoteAudio');
var chimeAudio = document.getElementById('chimeAudio');

// Discord Webhook
var PREF_DISCORD_WEBHOOK = 'petcam_discord_webhook';
var discordWebhookInput = document.getElementById('discordWebhookInput');
var webhookSavedStatus = document.getElementById('webhookSavedStatus');
var webhookSaveTimer = null;

if (discordWebhookInput) {
    discordWebhookInput.value = localStorage.getItem(PREF_DISCORD_WEBHOOK) || '';
    discordWebhookInput.addEventListener('input', function () {
        localStorage.setItem(PREF_DISCORD_WEBHOOK, this.value.trim());
        if (webhookSavedStatus) {
            webhookSavedStatus.style.opacity = '1';
            clearTimeout(webhookSaveTimer);
            webhookSaveTimer = setTimeout(function () { webhookSavedStatus.style.opacity = '0'; }, 2000);
        }

        var guardModeToggle = document.getElementById('guardModeToggle');
        var guardStatusDisplay = document.getElementById('guardStatusDisplay');
        var isGuardMode = localStorage.getItem('petcam_guard_mode') === 'true';

        if (guardModeToggle) {
            guardModeToggle.checked = isGuardMode;
            guardModeToggle.addEventListener('change', function () {
                isGuardMode = this.checked;
                localStorage.setItem('petcam_guard_mode', isGuardMode);
                if (guardStatusDisplay) {
                    guardStatusDisplay.style.display = isGuardMode ? 'block' : 'none';
                    if (isGuardMode && detectionInterval) {
                        guardStatusDisplay.textContent = '🟢 警衛模式運作中：正在背景偵測動靜與聲音...';
                        guardStatusDisplay.style.color = '#22c55e';
                    } else if (isGuardMode) {
                        guardStatusDisplay.textContent = '🟡 警衛模式已就緒，啟動攝影機後開始偵測。';
                        guardStatusDisplay.style.color = '#facc15';
                    }
                }
                if (isGuardMode && localStream) {
                    startDetection(localStream);
                } else {
                    stopDetection();
                }
            });
            // Init display
            if (isGuardMode && guardStatusDisplay) guardStatusDisplay.style.display = 'block';
        }

        // Detection logic
        var audioContext = null;
        var analyser = null;
        var dataArray = null;
        var motionCanvas = null;
        var motionCtx = null;
        var lastImageData = null;

        var detectionInterval = null;
        var audioRAF = null;
        var lastAlertTime = 0;
        var COOLDOWN_MS = 30000; // 30 seconds cooldown between alerts

        function startDetection(stream) {
            if (!isGuardMode || detectionInterval) return;

            // 1. Audio Setup
            try {
                var AudioContextClass = window.AudioContext || window.webkitAudioContext;
                if (AudioContextClass) {
                    audioContext = new AudioContextClass();
                    var source = audioContext.createMediaStreamSource(stream);
                    analyser = audioContext.createAnalyser();
                    analyser.fftSize = 256;
                    source.connect(analyser);
                    dataArray = new Uint8Array(analyser.frequencyBinCount);
                    checkAudio();
                }
            } catch (e) { console.error('Audio detection setup failed:', e); }

            // 2. Motion Setup
            if (!motionCanvas) {
                motionCanvas = document.createElement('canvas');
                motionCanvas.width = 64;
                motionCanvas.height = 48; // downscale for perf
                motionCtx = motionCanvas.getContext('2d', { willReadFrequently: true });
            }

            lastImageData = null;
            detectionInterval = setInterval(checkMotion, 1000); // Check every 1s
            if (guardStatusDisplay) {
                guardStatusDisplay.textContent = '🟢 警衛模式運作中：正在背景偵測動靜與聲音...';
                guardStatusDisplay.style.color = '#22c55e';
            }
        }

        function stopDetection() {
            if (detectionInterval) {
                clearInterval(detectionInterval);
                detectionInterval = null;
            }
            if (audioRAF) {
                cancelAnimationFrame(audioRAF);
                audioRAF = null;
            }
            if (audioContext && audioContext.state !== 'closed') {
                audioContext.close().catch(function () { });
                audioContext = null;
            }
            lastImageData = null;
            if (guardStatusDisplay && isGuardMode) {
                guardStatusDisplay.textContent = '🟡 警衛模式已就緒，啟動攝影機後開始偵測。';
                guardStatusDisplay.style.color = '#facc15';
            }
        }

        function checkAudio() {
            if (!analyser || !isGuardMode) return;
            audioRAF = requestAnimationFrame(checkAudio);

            analyser.getByteFrequencyData(dataArray);
            var sum = 0;
            for (var i = 0; i < dataArray.length; i++) {
                sum += dataArray[i];
            }
            var average = sum / dataArray.length;

            // Threshold for loud noise (e.g. bark/crash)
            if (average > 60) {
                triggerAlert('🔊 **偵測到異常聲響！** (音量: ' + Math.round(average) + ')');
            }
        }

        function checkMotion() {
            if (!localVideo || localVideo.videoWidth === 0 || !isGuardMode) return;

            motionCtx.drawImage(localVideo, 0, 0, motionCanvas.width, motionCanvas.height);
            var currentData = motionCtx.getImageData(0, 0, motionCanvas.width, motionCanvas.height);

            if (lastImageData) {
                var diffPixels = 0;
                var totalPixels = currentData.data.length / 4;

                for (var i = 0; i < currentData.data.length; i += 4) {
                    var rDiff = Math.abs(currentData.data[i] - lastImageData.data[i]);
                    var gDiff = Math.abs(currentData.data[i + 1] - lastImageData.data[i + 1]);
                    var bDiff = Math.abs(currentData.data[i + 2] - lastImageData.data[i + 2]);

                    // If pixel color difference is significant
                    if (rDiff + gDiff + bDiff > 100) {
                        diffPixels++;
                    }
                }

                var diffRatio = diffPixels / totalPixels;
                if (diffRatio > 0.08) { // 8% of pixels changed
                    triggerAlert('🏃‍♂️ **偵測到異常動靜！** (變動率: ' + Math.round(diffRatio * 100) + '%)');
                }
            }

            lastImageData = currentData;
        }

        function triggerAlert(message) {
            if (!isGuardMode) return;
            var now = Date.now();
            if (now - lastAlertTime < COOLDOWN_MS) return; // Cooldown active

            var webhookUrl = localStorage.getItem(PREF_DISCORD_WEBHOOK);
            if (!webhookUrl) return; // Only trigger if webhook is configured

            lastAlertTime = now;
            console.log('ALERT TRIGGERED:', message);

            // Capture high-res screenshot
            if (!localVideo || !localVideo.videoWidth) {
                sendDiscordMessage(webhookUrl, message); // Send without image
                return;
            }

            try {
                var fullCanvas = document.createElement('canvas');
                fullCanvas.width = localVideo.videoWidth;
                fullCanvas.height = localVideo.videoHeight;
                var fullCtx = fullCanvas.getContext('2d');
                fullCtx.drawImage(localVideo, 0, 0);

                fullCanvas.toBlob(function (blob) {
                    sendDiscordMessage(webhookUrl, message, blob);
                }, 'image/jpeg', 0.85);
            } catch (e) {
                console.error('Alert screenshot error:', e);
                sendDiscordMessage(webhookUrl, message); // Send without image as fallback
            }
        }
    });
}

// Discord Webhook Helper Function
function sendDiscordMessage(webhookUrl, content, fileBlob) {
    if (!webhookUrl) return;

    var formData = new FormData();
    if (content) formData.append('content', content);
    if (fileBlob) formData.append('file', fileBlob, 'petcam_screenshot.png');

    fetch(webhookUrl, {
        method: 'POST',
        body: formData
    }).catch(function (err) {
        console.error('Discord Webhook Error:', err);
    });
}

function setStatus(cls, text) {
    if (statusDot) statusDot.className = 'dot ' + cls;
    if (statusText) statusText.textContent = text;
    if (liveStatusDot) liveStatusDot.className = 'dot ' + cls;
    if (liveStatusText) liveStatusText.textContent = text;
}

function getOrCreatePeerId() {
    var id = localStorage.getItem(PREF_PEER_ID);
    if (!id) {
        var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        id = 'PET-';
        for (var i = 0; i < 4; i++) id += chars[Math.floor(Math.random() * chars.length)];
        localStorage.setItem(PREF_PEER_ID, id);
    }
    return id;
}

// Show peer ID on both screens
var peerId = getOrCreatePeerId();
if (peerIdDisplay) peerIdDisplay.textContent = peerId;
if (liveIdDisplay) liveIdDisplay.textContent = peerId;

// Enumerate all video input devices
function getCameraDevices(cb) {
    navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        .then(function (temp) {
            temp.getTracks().forEach(function (t) { t.stop(); });
            return navigator.mediaDevices.enumerateDevices();
        })
        .then(function (devices) {
            cb(devices.filter(function (d) { return d.kind === 'videoinput'; }));
        })
        .catch(function () { cb([]); });
}

function startCamera() {
    setStatus('', '啟動鏡頭...');
    getCameraDevices(function (devices) {
        cameraDevices = devices;
        if (currentCamIndex >= cameraDevices.length) {
            currentCamIndex = 0;
            localStorage.setItem(PREF_CAM_INDEX, '0');
        }
        openCamera(currentCamIndex);
    });
}

function openCamera(index) {
    if (localStream) {
        stopDetection();
        var tracks = localStream.getTracks();
        for (var i = 0; i < tracks.length; i++) {
            tracks[i].stop();
        }
    }

    var deviceId = cameraDevices[index] ? cameraDevices[index].deviceId : undefined;
    var constraints = deviceId
        ? { video: { deviceId: { exact: deviceId }, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15 } }, audio: true }
        : { video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15 } }, audio: true };

    navigator.mediaDevices.getUserMedia(constraints)
        .then(function (stream) {
            localStream = stream;
            localVideo.srcObject = stream;
            localVideo.onloadedmetadata = function () {
                localVideo.play();
                initPeer();
                if (isGuardMode) startDetection(stream);
            };
            // Switch to live view
            setupScreen.style.display = 'none';
            liveView.style.display = 'flex';

            // Hot-swap video track in active call
            if (currentCall && currentCall.peerConnection) {
                var newTrack = stream.getVideoTracks()[0];
                var senders = currentCall.peerConnection.getSenders();
                for (var i = 0; i < senders.length; i++) {
                    if (senders[i].track && senders[i].track.kind === 'video' && newTrack) {
                        senders[i].replaceTrack(newTrack);
                        break;
                    }
                }
            }

            if (!peer) {
                requestWakeLock();
                initPeer();
            }
        })
        .catch(function (err) {
            console.error('Camera error:', err);
            setStatus('error', '無法存取攝影機');
        });
}

function initPeer() {
    setStatus('', '連線中...');
    var cameraId = getOrCreatePeerId();
    if (peerIdDisplay) peerIdDisplay.textContent = cameraId;
    if (liveIdDisplay) liveIdDisplay.textContent = cameraId;

    peer = new Peer(cameraId);

    peer.on('open', function (id) {
        if (peerIdDisplay) peerIdDisplay.textContent = id;
        if (liveIdDisplay) liveIdDisplay.textContent = id;
        setStatus('online', '等待觀看端連線');

        var webhookUrl = localStorage.getItem(PREF_DISCORD_WEBHOOK);
        if (webhookUrl) {
            sendDiscordMessage(webhookUrl, '🟢 **攝影機已上線** (ID: `' + id + '`)\n準備好接收連線！');
        }
    });

    // Data channel: listen for commands from viewer
    peer.on('connection', function (conn) {
        conn.on('data', function (data) {
            if (data === 'flip') flipCamera();
            if (data === 'dim') togglePowerSave();
            if (data === 'screenshot') takeAndSendScreenshot();
        });
    });

    peer.on('call', function (call) {
        if (currentCall) currentCall.close();
        currentCall = call;
        call.answer(localStream);

        // Play chime
        if (chimeAudio) {
            chimeAudio.currentTime = 0;
            chimeAudio.play().catch(function () { });
        }

        document.body.classList.add('monitoring');
        setStatus('online', '觀看中');

        var webhookUrl = localStorage.getItem(PREF_DISCORD_WEBHOOK);
        if (webhookUrl) sendDiscordMessage(webhookUrl, '👀 **有觀看端連線加入**');

        call.on('stream', function (remoteStream) {
            if (remoteAudio) {
                remoteAudio.srcObject = remoteStream;
                remoteAudio.muted = false;
            }
        });

        call.on('close', function () {
            currentCall = null;
            if (remoteAudio) remoteAudio.srcObject = null;
            document.body.classList.remove('monitoring');
            setStatus('online', '等待觀看端連線');
            var webhookUrl = localStorage.getItem(PREF_DISCORD_WEBHOOK);
            if (webhookUrl) sendDiscordMessage(webhookUrl, '👋 **觀看端已中斷連線**');
        });

        call.on('error', function () {
            document.body.classList.remove('monitoring');
            setStatus('online', '等待觀看端連線');
        });
    });

    peer.on('disconnected', function () {
        setStatus('error', '伺服器斷線，重連中...');
        var webhookUrl = localStorage.getItem(PREF_DISCORD_WEBHOOK);
        if (webhookUrl) sendDiscordMessage(webhookUrl, '⚠️ **攝影機伺服器意外斷線，嘗試重連中...**');
        peer.reconnect();
    });

    peer.on('error', function (err) {
        if (err.type === 'unavailable-id') {
            localStorage.removeItem(PREF_PEER_ID);
            peer.destroy();
            peer = null;
            initPeer();
        } else {
            setStatus('error', '錯誤: ' + err.type);
        }
    });
}

// Capture frame and send to Discord
function takeAndSendScreenshot() {
    var webhookUrl = localStorage.getItem(PREF_DISCORD_WEBHOOK);
    if (!webhookUrl || !localVideo || !localVideo.videoWidth) return;

    try {
        var canvas = document.createElement('canvas');
        canvas.width = localVideo.videoWidth;
        canvas.height = localVideo.videoHeight;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(localVideo, 0, 0);

        canvas.toBlob(function (blob) {
            if (blob) {
                sendDiscordMessage(webhookUrl, '📸 **手動擷取畫面**', blob);
            }
        }, 'image/png');
    } catch (e) {
        console.error('Screenshot error:', e);
    }
}

// Flip camera: cycle through all lenses
function flipCamera() {
    if (cameraDevices.length <= 1) return;
    currentCamIndex = (currentCamIndex + 1) % cameraDevices.length;
    localStorage.setItem(PREF_CAM_INDEX, String(currentCamIndex));
    openCamera(currentCamIndex);
}

// Wake lock & Power Save
var wakeLock = null;
function requestWakeLock() {
    if ('wakeLock' in navigator) {
        navigator.wakeLock.request('screen')
            .then(function (wl) {
                wakeLock = wl;
                wl.addEventListener('release', function () { wakeLock = null; });
            })
            .catch(function () { });
    }
}
document.addEventListener('visibilitychange', function () {
    if (wakeLock !== null && document.visibilityState === 'visible') {
        requestWakeLock();
    }
});
function togglePowerSave(forceDim) {
    var overlay = document.getElementById('dimOverlay');
    if (!overlay) return;
    if (typeof forceDim === 'boolean') {
        overlay.style.display = forceDim ? 'flex' : 'none';
    } else {
        overlay.style.display = overlay.style.display === 'flex' ? 'none' : 'flex';
    }
    requestWakeLock();
}

// Start button
if (startBtn) {
    startBtn.onclick = function () {
        startBtn.disabled = true;
        // Unlock audio
        if (chimeAudio) {
            chimeAudio.volume = 0;
            chimeAudio.play().then(function () { chimeAudio.pause(); chimeAudio.currentTime = 0; chimeAudio.volume = 1; }).catch(function () { });
        }
        if (remoteAudio) {
            remoteAudio.volume = 0;
            remoteAudio.play().catch(function () { });
            remoteAudio.volume = 1;
        }
        startCamera();
    };
}
