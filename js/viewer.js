/**
 * PetCam — viewer.js v7
 * Back/Switch buttons now use inline onclick in HTML (most reliable on mobile)
 */

var PREF_CAMERA_ID = 'petcam_target_id';

var setupScreen = document.getElementById('setupScreen');
var mainViewer = document.getElementById('mainViewer');
var cameraInput = document.getElementById('cameraIdInput');
var connectBtn = document.getElementById('connectButton');

// Pre-fill saved camera ID
var savedId = localStorage.getItem(PREF_CAMERA_ID);
if (savedId && cameraInput) cameraInput.value = savedId;

// Connect button
if (connectBtn) {
    connectBtn.onclick = function () {
        var id = cameraInput.value.trim().toUpperCase();
        if (!id) { alert('請輸入攝影機 ID'); return; }

        localStorage.setItem(PREF_CAMERA_ID, id);
        setupScreen.style.display = 'none';
        mainViewer.style.display = 'flex';

        startViewer(id);
    };
}

// Dummy video track for SDP m=video negotiation
function makeDummyVideoTrack() {
    try {
        var c = document.createElement('canvas');
        c.width = 2; c.height = 2;
        c.getContext('2d').fillRect(0, 0, 2, 2);
        var tracks = c.captureStream(1).getVideoTracks();
        return tracks.length > 0 ? tracks[0] : null;
    } catch (e) { return null; }
}

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

    setStatus('', '準備中...', '請求麥克風...');

    var dv = makeDummyVideoTrack();
    if (dv) localStream.addTrack(dv);

    navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        .then(function (mic) {
            var t = mic.getAudioTracks()[0];
            if (t) { t.enabled = false; localStream.addTrack(t); }
        })
        .catch(function () {
            if (talkBtn) talkBtn.disabled = true;
            if (talkLabel) talkLabel.textContent = '麥克風未授權';
        })
        .then(function () {
            setStatus('', '連線中...', '連接伺服器...');
            peer = new Peer();
            window._viewerPeer = peer;
            peer.on('open', function () { callCamera(); });
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

    function callCamera() {
        setStatus('', '呼叫中...', '呼叫 ' + cameraId + '...');
        overlay.onclick = null;
        var call = peer.call(cameraId, localStream);
        if (!call) {
            setStatus('error', '呼叫失敗', '無法連線\n點擊重試');
            overlay.onclick = callCamera;
            return;
        }
        call.on('stream', function (rs) {
            console.log('[Viewer] Received remote stream, tracks:', rs.getTracks().map(function(t){ return t.kind + ':' + t.readyState; }));
            
            // Ensure video element is ready
            remoteVideo.muted = true; // Required for autoplay policy
            remoteVideo.setAttribute('playsinline', '');
            remoteVideo.setAttribute('autoplay', '');
            remoteVideo.srcObject = rs;
            
            // Attempt immediate play (helps some Android browsers)
            var p = remoteVideo.play();
            if (p && p.catch) p.catch(function() {});
            
            // Use loadedmetadata for reliable playback on mobile
            remoteVideo.onloadedmetadata = function () {
                console.log('[Viewer] Video metadata loaded:', remoteVideo.videoWidth, 'x', remoteVideo.videoHeight);
                remoteVideo.play().then(function () {
                    console.log('[Viewer] Video playing successfully');
                    setStatus('online', '已連線');
                    // Unmute after successful play
                    setTimeout(function () { remoteVideo.muted = false; }, 800);
                }).catch(function (e) {
                    console.error('[Viewer] Play error:', e);
                    // Retry with muted
                    remoteVideo.muted = true;
                    remoteVideo.play().catch(function () { });
                    setStatus('online', '已連線（靜音）');
                });
            };
            
            // Fallback: if metadata doesn't fire within 3s, force play
            setTimeout(function () {
                if (remoteVideo.readyState < 2) {
                    console.warn('[Viewer] Metadata timeout, forcing play...');
                    remoteVideo.play().catch(function () { });
                    setStatus('online', '已連線');
                }
            }, 3000);
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

    // Ensure audio is strictly muted by default before adding listeners
    localStream.getAudioTracks().forEach(function (t) { t.enabled = false; });

    var isTalking = false;
    var talkBtn = document.getElementById('talkButton');
    var talkLabel = document.getElementById('talkLabel');

    function startTalk(e) {
        if (e.type === 'touchstart') e.preventDefault();
        isTalking = true;
        localStream.getAudioTracks().forEach(function (t) { t.enabled = true; });
        if (talkBtn) talkBtn.classList.add('recording');
        if (talkLabel) talkLabel.textContent = '放開結束';
    }

    function stopTalk(e) {
        if (!isTalking) return;
        isTalking = false;
        localStream.getAudioTracks().forEach(function (t) { t.enabled = false; });
        if (talkBtn) talkBtn.classList.remove('recording');
        if (talkLabel) talkLabel.textContent = '按住說話';
    }

    if (talkBtn) {
        talkBtn.addEventListener('mousedown', startTalk);
        talkBtn.addEventListener('touchstart', startTalk, { passive: false });
    }

    // Bind to window to catch releases anywhere on screen
    window.addEventListener('mouseup', stopTalk);
    window.addEventListener('touchend', stopTalk);
    window.addEventListener('touchcancel', stopTalk);
}
