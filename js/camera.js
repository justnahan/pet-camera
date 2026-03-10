/**
 * PetCam — camera.js v3
 * Fixes: camera always uses back camera, chime plays on call, flip button works
 */

const PREF_PEER_ID = 'petcam_camera_id';
const PREF_FACING = 'petcam_facing_mode';

let peer = null;
let currentCall = null;
let localStream = null;
let facingMode = localStorage.getItem(PREF_FACING) || 'environment';

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

async function startCamera() {
    setStatus('', '啟動鏡頭中...');
    try {
        // Try requested facing mode first
        try {
            localStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: { exact: facingMode }, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15 } },
                audio: true
            });
        } catch (e) {
            // Fallback: try without "exact" (some old phones don't support exact)
            localStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15 } },
                audio: true
            });
        }
    } catch (e) {
        // Final fallback: any camera
        try {
            localStream = await navigator.mediaDevices.getUserMedia({
                video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15 } },
                audio: true
            });
        } catch (finalErr) {
            setStatus('error', '無法存取攝影機');
            peerIdDisplay.textContent = 'Error: ' + finalErr.name;
            startBtn.disabled = false;
            return;
        }
    }

    localVideo.srcObject = localStream;
    localVideo.style.display = 'block';
    flipBtn.classList.remove('hidden');

    requestWakeLock();
    initPeer();
}

function initPeer() {
    setStatus('', '連線伺服器...');
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

        // Answer with camera stream
        call.answer(localStream);

        // Play chime IMMEDIATELY when call arrives
        chimeAudio.currentTime = 0;
        chimeAudio.play().catch(() => { });

        // Enter blackout mode
        document.body.classList.add('monitoring');
        setStatus('online', '觀看中');

        // Receive viewer's audio (walkie-talkie)
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

        call.on('error', err => {
            console.error('Call error:', err);
            document.body.classList.remove('monitoring');
            setStatus('online', '等待觀看端連線');
        });
    });

    peer.on('disconnected', () => {
        setStatus('error', '伺服器斷線，重連中...');
        peer.reconnect();
    });

    peer.on('error', err => {
        console.error('Peer error:', err);
        if (err.type === 'unavailable-id') {
            // ID conflict — generate new one
            localStorage.removeItem(PREF_PEER_ID);
            peer.destroy();
            initPeer();
        } else {
            setStatus('error', '錯誤: ' + err.type);
        }
    });
}

// ── FLIP CAMERA ──
async function flipCamera() {
    facingMode = facingMode === 'environment' ? 'user' : 'environment';
    localStorage.setItem(PREF_FACING, facingMode);

    // Stop existing tracks
    if (localStream) localStream.getTracks().forEach(t => t.stop());

    try {
        const newStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15 } },
            audio: true
        });

        localVideo.srcObject = newStream;
        localStream = newStream;

        // Replace video track in active call
        if (currentCall && currentCall.peerConnection) {
            const newVideoTrack = newStream.getVideoTracks()[0];
            const sender = currentCall.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender && newVideoTrack) sender.replaceTrack(newVideoTrack);
        }
    } catch (e) {
        console.warn('Flip failed:', e);
        // Revert
        facingMode = facingMode === 'environment' ? 'user' : 'environment';
        localStorage.setItem(PREF_FACING, facingMode);
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
    // Unlock audio context
    chimeAudio.volume = 0;
    chimeAudio.play().then(() => { chimeAudio.pause(); chimeAudio.currentTime = 0; chimeAudio.volume = 1; }).catch(() => { });
    remoteAudio.volume = 0;
    remoteAudio.play().catch(() => { });
    remoteAudio.volume = 1;
    startCamera();
});

flipBtn.addEventListener('click', flipCamera);
