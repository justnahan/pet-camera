/**
 * PetCam — camera.js v4
 * Fixes: enumerate all cameras (not just front/back), chime on call, proper flip cycling
 */

const PREF_PEER_ID = 'petcam_camera_id';
const PREF_CAM_INDEX = 'petcam_cam_index';

let peer = null;
let currentCall = null;
let localStream = null;

// List of all available camera device IDs
let cameraDevices = [];
let currentCamIndex = parseInt(localStorage.getItem(PREF_CAM_INDEX) || '0', 10);

const peerIdDisplay = document.getElementById('peerIdDisplay');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const localVideo = document.getElementById('localVideo');
const remoteAudio = document.getElementById('remoteAudio');
const chimeAudio = document.getElementById('chimeAudio');
const startBtn = document.getElementById('startCameraButton');
const flipBtn = document.getElementById('flipBtn');

function setStatus(cls, text) {
    statusDot.className = 'dot ' + cls;
    statusText.textContent = text;
}

function getOrCreatePeerId() {
    let id = localStorage.getItem(PREF_PEER_ID);
    if (!id) {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        id = 'PET-';
        for (let i = 0; i < 4; i++) id += chars[Math.floor(Math.random() * chars.length)];
        localStorage.setItem(PREF_PEER_ID, id);
    }
    return id;
}

// Enumerate all video input devices
async function getCameraDevices() {
    try {
        // Need to request any stream first to unlock enumerateDevices labels
        const temp = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        temp.getTracks().forEach(t => t.stop());
    } catch (e) { }

    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(d => d.kind === 'videoinput');
}

async function startCamera() {
    setStatus('', '啟動鏡頭...');
    try {
        // Get all available cameras
        cameraDevices = await getCameraDevices();
        console.log('Available cameras:', cameraDevices.map(d => d.label));

        // If saved index is out of bounds, reset to 0
        if (currentCamIndex >= cameraDevices.length) {
            currentCamIndex = 0;
            localStorage.setItem(PREF_CAM_INDEX, '0');
        }

        await openCamera(currentCamIndex);

    } catch (err) {
        console.error('Camera start failed:', err);
        setStatus('error', '無法存取攝影機');
        peerIdDisplay.textContent = 'Error: ' + err.name;
        startBtn.disabled = false;
    }
}

async function openCamera(index) {
    // Stop previous stream
    if (localStream) localStream.getTracks().forEach(t => t.stop());

    const deviceId = cameraDevices[index] ? cameraDevices[index].deviceId : undefined;
    const constraints = deviceId
        ? { video: { deviceId: { exact: deviceId }, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15 } }, audio: true }
        : { video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15 } }, audio: true };

    localStream = await navigator.mediaDevices.getUserMedia(constraints);
    localVideo.srcObject = localStream;
    localVideo.style.display = 'block';
    flipBtn.classList.remove('hidden');

    // Update flip icon tooltip with count
    if (cameraDevices.length > 1) {
        flipBtn.title = `鏡頭 ${index + 1} / ${cameraDevices.length}`;
    }

    // Replace video track in active call (hot-swap without reconnect)
    if (currentCall && currentCall.peerConnection) {
        const newTrack = localStream.getVideoTracks()[0];
        const sender = currentCall.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender && newTrack) {
            sender.replaceTrack(newTrack).catch(e => console.warn('replaceTrack failed:', e));
        }
    }

    if (!peer) {
        requestWakeLock();
        initPeer();
    }
}

function initPeer() {
    setStatus('', '連線中...');
    const cameraId = getOrCreatePeerId();
    peerIdDisplay.textContent = cameraId;

    peer = new Peer(cameraId);

    peer.on('open', id => {
        peerIdDisplay.textContent = id;
        setStatus('online', '等待觀看端連線');
    });

    peer.on('call', call => {
        if (currentCall) currentCall.close();
        currentCall = call;

        call.answer(localStream);

        // Play chime immediately
        chimeAudio.currentTime = 0;
        chimeAudio.play().catch(() => { });

        document.body.classList.add('monitoring');
        setStatus('online', '觀看中');

        call.on('stream', remoteStream => {
            remoteAudio.srcObject = remoteStream;
            remoteAudio.muted = false;
        });

        call.on('close', () => {
            currentCall = null;
            remoteAudio.srcObject = null;
            document.body.classList.remove('monitoring');
            setStatus('online', '等待觀看端連線');
        });

        call.on('error', () => {
            document.body.classList.remove('monitoring');
            setStatus('online', '等待觀看端連線');
        });
    });

    peer.on('disconnected', () => {
        setStatus('error', '伺服器斷線，重連中...');
        peer.reconnect();
    });

    peer.on('error', err => {
        if (err.type === 'unavailable-id') {
            localStorage.removeItem(PREF_PEER_ID);
            peer.destroy();
            initPeer();
        } else {
            setStatus('error', '錯誤: ' + err.type);
        }
    });
}

// ── FLIP: cycle through all cameras ──
async function flipCamera() {
    if (cameraDevices.length <= 1) {
        setStatus('error', '此裝置只有一個鏡頭');
        setTimeout(() => setStatus('online', '等待觀看端連線'), 2000);
        return;
    }

    currentCamIndex = (currentCamIndex + 1) % cameraDevices.length;
    localStorage.setItem(PREF_CAM_INDEX, String(currentCamIndex));

    try {
        await openCamera(currentCamIndex);
    } catch (e) {
        console.warn('Camera flip error:', e);
    }
}

// ── WAKE LOCK ──
let wakeLock = null;
async function requestWakeLock() {
    if ('wakeLock' in navigator) {
        try { wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { }
    }
}
document.addEventListener('visibilitychange', () => {
    if (wakeLock && document.visibilityState === 'visible') requestWakeLock();
});

// ── EVENTS ──
startBtn.addEventListener('click', () => {
    startBtn.disabled = true;
    // Unlock audio context with a silent play
    chimeAudio.volume = 0;
    chimeAudio.play().then(() => { chimeAudio.pause(); chimeAudio.currentTime = 0; chimeAudio.volume = 1; }).catch(() => { });
    remoteAudio.volume = 0;
    remoteAudio.play().catch(() => { });
    remoteAudio.volume = 1;
    startCamera();
});

flipBtn.addEventListener('click', flipCamera);
