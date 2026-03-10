/**
 * PetCam — viewer.js v6
 * ROOT CAUSE: Old service worker was caching stale JS files.
 *
 * Fixes in this version:
 * - Back button: goes to index.html (bound at page load, NOT inside startViewer)
 * - Switch button: clears saved ID, returns to setup screen inline
 * - SDP dummy video track for video negotiation
 * - Push-to-talk
 */

var PREF_CAMERA_ID = 'petcam_target_id';

// Get all elements immediately at page load — they exist in DOM even when hidden
var setupScreen = document.getElementById('setupScreen');
var mainViewer = document.getElementById('mainViewer');
var cameraInput = document.getElementById('cameraIdInput');
var connectBtn = document.getElementById('connectButton');
var backBtn = document.getElementById('backButton');
var switchBtn = document.getElementById('switchIdButton');

// Pre-fill saved ID
var savedId = localStorage.getItem(PREF_CAMERA_ID);
if (savedId && cameraInput) cameraInput.value = savedId;

// ─── BACK BUTTON: always go home ──────────────────────────────
if (backBtn) {
    backBtn.onclick = function () {
        window.location.href = 'index.html';
    };
}

// ─── SWITCH BUTTON: clear ID, show setup screen ───────────────
if (switchBtn) {
    switchBtn.onclick = function () {
        localStorage.removeItem(PREF_CAMERA_ID);
        mainViewer.style.display = 'none';
        setupScreen.style.display = 'flex';
        cameraInput.value = '';
        cameraInput.focus();
    };
}

// ─── CONNECT BUTTON ───────────────────────────────────────────
if (connectBtn) {
    connectBtn.onclick = function () {
        var id = cameraInput.value.trim().toUpperCase();
        if (!id) { alert('請輸入攝影機 ID'); return; }
        if (!id.startsWith('PET-')) id = 'PET-' + id;

        localStorage.setItem(PREF_CAMERA_ID, id);
        setupScreen.style.display = 'none';
        mainViewer.style.display = 'flex';

        startViewer(id);
    };
}

// ─── DUMMY VIDEO TRACK ───────────────────────────────────────
function makeDummyVideoTrack() {
    try {
        var c = document.createElement('canvas');
        c.width = 2; c.height = 2;
        c.getContext('2d').fillRect(0, 0, 2, 2);
        var tracks = c.captureStream(1).getVideoTracks();
        return tracks.length > 0 ? tracks[0] : null;
    } catch (e) { return null; }
}

// ─── MAIN VIEWER ──────────────────────────────────────────────
function startViewer(cameraId) {
    var statusDot = document.getElementById('statusDot');
    var statusText = document.getElementById('statusText');
    var remoteVideo = document.getElementById('remoteVideo');
    var overlay = document.getElementById('videoOverlay');
    var overlayMsg = document.getElementById('overlayMessage');
    var spinner = document.getElementById('loadingSpinner');
    var talkBtn = document.getElementById('talkButton');
    var talkLabel = document.getElementById('talkLabel');

    var localStream = new MediaStream();
    var peer = null;

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

    // Step 1: build stream
    setStatus('', '準備中...', '請求麥克風...');

    var dv = makeDummyVideoTrack();
    if (dv) localStream.addTrack(dv);

    navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        .then(function (mic) {
            var audioTrack = mic.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = false;
                localStream.addTrack(audioTrack);
            }
        })
        .catch(function (e) {
            console.warn('Mic denied:', e);
            if (talkBtn) talkBtn.disabled = true;
            if (talkLabel) talkLabel.textContent = '麥克風未授權';
        })
        .then(function () {
            // Step 2: connect PeerJS
            setStatus('', '連線中...', '連接伺服器...');
            peer = new Peer();

            peer.on('open', function () {
                callCamera();
            });

            peer.on('error', function (err) {
                if (err.type === 'peer-unavailable') {
                    setStatus('error', '找不到攝影機', '攝影機未開機\n點擊畫面重試');
                } else {
                    setStatus('error', '連線錯誤', err.type + '\n點擊畫面重試');
                }
                overlay.onclick = callCamera;
            });

            peer.on('disconnected', function () {
                setStatus('error', '斷線', '重新連線中...');
                try { peer.reconnect(); } catch (e) { }
            });
        });

    // Step 3: call camera
    function callCamera() {
        setStatus('', '呼叫中...', '呼叫 ' + cameraId + '...');
        overlay.onclick = null;

        var call = peer.call(cameraId, localStream);
        if (!call) {
            setStatus('error', '呼叫失敗', '無法連線\n點擊重試');
            overlay.onclick = callCamera;
            return;
        }

        call.on('stream', function (remoteStream) {
            remoteVideo.srcObject = remoteStream;
            remoteVideo.muted = true;
            remoteVideo.play().catch(function () { });
            setTimeout(function () { remoteVideo.muted = false; }, 600);
            setStatus('online', '已連線');
        });

        call.on('close', function () {
            setStatus('error', '已斷線', '連線中斷\n點擊重試');
            remoteVideo.srcObject = null;
            overlay.onclick = callCamera;
        });

        call.on('error', function () {
            setStatus('error', '通話錯誤', '點擊重試');
            overlay.onclick = callCamera;
        });
    }

    // Push-to-talk
    function startTalk(e) {
        if (e.type === 'touchstart') e.preventDefault();
        localStream.getAudioTracks().forEach(function (t) { t.enabled = true; });
        if (talkBtn) talkBtn.classList.add('recording');
        if (talkLabel) talkLabel.textContent = '放開結束';
    }
    function stopTalk(e) {
        if (e && e.type === 'touchend') e.preventDefault();
        localStream.getAudioTracks().forEach(function (t) { t.enabled = false; });
        if (talkBtn) talkBtn.classList.remove('recording');
        if (talkLabel) talkLabel.textContent = '按住說話';
    }

    if (talkBtn) {
        talkBtn.addEventListener('mousedown', startTalk);
        talkBtn.addEventListener('touchstart', startTalk, { passive: false });
    }
    window.addEventListener('mouseup', stopTalk);
    window.addEventListener('touchend', stopTalk, { passive: false });
    window.addEventListener('touchcancel', stopTalk);
}
