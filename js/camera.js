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
    if (localStream) localStream.getTracks().forEach(function (t) { t.stop(); });

    var deviceId = cameraDevices[index] ? cameraDevices[index].deviceId : undefined;
    var constraints = deviceId
        ? { video: { deviceId: { exact: deviceId }, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15 } }, audio: true }
        : { video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15 } }, audio: true };

    navigator.mediaDevices.getUserMedia(constraints)
        .then(function (stream) {
            localStream = stream;
            localVideo.srcObject = stream;

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
    });

    // Data channel: listen for flip commands from viewer
    peer.on('connection', function (conn) {
        conn.on('data', function (data) {
            if (data === 'flip') flipCamera();
            if (data === 'dim') togglePowerSave();
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
        });

        call.on('error', function () {
            document.body.classList.remove('monitoring');
            setStatus('online', '等待觀看端連線');
        });
    });

    peer.on('disconnected', function () {
        setStatus('error', '伺服器斷線，重連中...');
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
