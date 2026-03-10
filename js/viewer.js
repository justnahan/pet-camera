/**
 * PetCam — viewer.js v5
 * Bugfixes: back+switch buttons always work, no confirm() dialog, SDP dummy video track
 */

const PREF_CAMERA_ID = 'petcam_target_id';

// ─── SETUP SCREEN ─────────────────────────────────────────────
const setupScreen = document.getElementById('setupScreen');
const mainViewer = document.getElementById('mainViewer');
const cameraInput = document.getElementById('cameraIdInput');
const connectBtn = document.getElementById('connectButton');

// Pre-fill saved ID
const savedId = localStorage.getItem(PREF_CAMERA_ID);
if (savedId && cameraInput) cameraInput.value = savedId;

// Wire up BACK and SWITCH buttons right away (they always work, regardless of viewer state)
document.getElementById('backButton').addEventListener('click', function () {
    window.location.href = 'index.html';
});

document.getElementById('switchIdButton').addEventListener('click', function () {
    // Clear saved ID and return to setup screen without reloading
    localStorage.removeItem(PREF_CAMERA_ID);
    // Show setup, hide viewer
    mainViewer.style.display = 'none';
    setupScreen.style.display = 'flex';
    cameraInput.value = '';
    cameraInput.focus();
});

connectBtn.addEventListener('click', function () {
    let id = cameraInput.value.trim().toUpperCase();
    if (!id) { alert('請輸入攝影機 ID'); return; }
    if (!id.startsWith('PET-')) id = 'PET-' + id;

    localStorage.setItem(PREF_CAMERA_ID, id);

    setupScreen.style.display = 'none';
    mainViewer.style.display = 'flex';

    startViewer(id);
});

// ─── DUMMY VIDEO TRACK (ensures SDP includes m=video) ─────────
function makeDummyVideoTrack() {
    try {
        const c = document.createElement('canvas');
        c.width = 2; c.height = 2;
        c.getContext('2d').fillRect(0, 0, 2, 2);
        const tracks = c.captureStream(1).getVideoTracks();
        return tracks[0] || null;
    } catch (e) { return null; }
}

// ─── MAIN VIEWER MODE ─────────────────────────────────────────
async function startViewer(cameraId) {
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    const remoteVideo = document.getElementById('remoteVideo');
    const overlay = document.getElementById('videoOverlay');
    const overlayMsg = document.getElementById('overlayMessage');
    const spinner = document.getElementById('loadingSpinner');
    const talkBtn = document.getElementById('talkButton');
    const talkLabel = document.getElementById('talkLabel');

    let localStream = new MediaStream();
    let peer = null;
    let currentCall = null;

    function setStatus(cls, label, overlayText) {
        if (statusDot) statusDot.className = 'dot ' + cls;
        if (statusText) statusText.textContent = label;
        if (overlayText !== undefined) {
            overlay.style.display = 'flex';
            overlayMsg.textContent = overlayText;
            spinner.style.display = (cls === 'error') ? 'none' : 'block';
        } else {
            overlay.style.display = 'none';
        }
    }

    // ─── Step 1: Build outgoing stream ─────────────────────────
    setStatus('', '準備中...', '請求麥克風...');

    const dv = makeDummyVideoTrack();
    if (dv) localStream.addTrack(dv);

    try {
        const mic = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        const audioTrack = mic.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = false; // muted until push-to-talk
            localStream.addTrack(audioTrack);
        }
    } catch (e) {
        console.warn('Mic denied:', e);
        talkBtn.disabled = true;
        talkLabel.textContent = '麥克風未授權';
    }

    // ─── Step 2: PeerJS ────────────────────────────────────────
    setStatus('', '連線中...', '連接伺服器...');
    peer = new Peer();

    peer.on('open', function () {
        callCamera();
    });

    peer.on('error', function (err) {
        if (err.type === 'peer-unavailable') {
            setStatus('error', '找不到攝影機', '攝影機未開機\n點擊畫面重試');
        } else {
            setStatus('error', '連線錯誤', '錯誤: ' + err.type + '\n點擊畫面重試');
        }
        overlay.onclick = callCamera;
    });

    peer.on('disconnected', function () {
        setStatus('error', '伺服器斷線', '重新連線中...');
        try { peer.reconnect(); } catch (e) { }
    });

    // ─── Step 3: Call camera ───────────────────────────────────
    function callCamera() {
        setStatus('', '呼叫中...', '呼叫 ' + cameraId + '...');
        overlay.onclick = null;

        currentCall = peer.call(cameraId, localStream);
        if (!currentCall) {
            setStatus('error', '呼叫失敗', '無法建立連線\n點擊畫面重試');
            overlay.onclick = callCamera;
            return;
        }

        currentCall.on('stream', function (remoteStream) {
            remoteVideo.srcObject = remoteStream;
            remoteVideo.muted = true;

            remoteVideo.play().catch(function (e) {
                console.warn('play() failed:', e);
            });

            // Unmute to hear camera audio after brief delay
            setTimeout(function () { remoteVideo.muted = false; }, 600);

            setStatus('online', '已連線');
        });

        currentCall.on('close', function () {
            setStatus('error', '已斷線', '連線中斷\n點擊畫面重試');
            remoteVideo.srcObject = null;
            overlay.onclick = callCamera;
        });

        currentCall.on('error', function () {
            setStatus('error', '通話錯誤', '點擊畫面重試');
            overlay.onclick = callCamera;
        });
    }

    // ─── Push-to-talk ──────────────────────────────────────────
    function startTalking(e) {
        if (e.type === 'touchstart') e.preventDefault();
        localStream.getAudioTracks().forEach(t => t.enabled = true);
        talkBtn.classList.add('recording');
        talkLabel.textContent = '放開結束';
    }
    function stopTalking(e) {
        if (e && e.type === 'touchend') e.preventDefault();
        localStream.getAudioTracks().forEach(t => t.enabled = false);
        talkBtn.classList.remove('recording');
        talkLabel.textContent = '按住說話';
    }

    talkBtn.addEventListener('mousedown', startTalking);
    talkBtn.addEventListener('touchstart', startTalking, { passive: false });
    window.addEventListener('mouseup', stopTalking);
    window.addEventListener('touchend', stopTalking, { passive: false });
    window.addEventListener('touchcancel', stopTalking);
}
