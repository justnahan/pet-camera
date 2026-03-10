/**
 * PetCam Viewer - v3 (SDP video negotiation fix)
 * 
 * ROOT CAUSE OF VIDEO NOT SHOWING:
 * When peer.call(id, audioOnlyStream) is used, the SDP offer only includes m=audio.
 * The camera can only answer with what the offer requests, so video is never negotiated.
 * FIX: Include a dummy video track (from a 1x1 canvas) in the viewer's outgoing stream
 * so the SDP offer includes BOTH m=audio AND m=video.
 */

const PREF_CAMERA_ID = 'petcam_target_id';

// =============================================
// SETUP SCREEN
// =============================================
var setupView = document.getElementById('setupView');
var mainViewer = document.getElementById('mainViewer');
var cameraIdInput = document.getElementById('cameraIdInput');
var connectButton = document.getElementById('connectButton');

// Pre-fill saved ID
var savedId = localStorage.getItem(PREF_CAMERA_ID);
if (savedId && cameraIdInput) {
    cameraIdInput.value = savedId;
}

connectButton.addEventListener('click', function () {
    var inputId = cameraIdInput.value.trim().toUpperCase();
    if (!inputId) {
        alert('請輸入攝影機 ID');
        return;
    }
    if (!inputId.startsWith('PET-')) {
        inputId = 'PET-' + inputId;
    }

    localStorage.setItem(PREF_CAMERA_ID, inputId);
    setupView.style.display = 'none';
    mainViewer.style.display = 'flex';

    beginConnection(inputId);
});

// =============================================
// Create a dummy video track from a canvas
// This is CRITICAL: without a video track in the outgoing stream,
// the SDP offer won't include m=video, and the camera can't send video back.
// =============================================
function createDummyVideoTrack() {
    try {
        var canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, 1, 1);
        var stream = canvas.captureStream(1); // 1 fps
        var tracks = stream.getVideoTracks();
        if (tracks.length > 0) {
            console.log('✅ Dummy video track created');
            return tracks[0];
        }
    } catch (e) {
        console.warn('Cannot create dummy video track:', e);
    }
    return null;
}

// =============================================
// CONNECTION PIPELINE
// =============================================
async function beginConnection(cameraId) {
    var statusDot = document.getElementById('statusDot');
    var statusText = document.getElementById('statusText');
    var remoteVideo = document.getElementById('remoteVideo');
    var videoOverlay = document.getElementById('videoOverlay');
    var overlayMessage = document.getElementById('overlayMessage');
    var loadingSpinner = document.getElementById('loadingSpinner');
    var talkButton = document.getElementById('talkButton');
    var talkLabel = document.getElementById('talkLabel');

    var localStream = null; // Will contain audio + dummy video
    var peer = null;
    var currentCall = null;

    function setStatus(dotClass, label, overlay) {
        if (statusDot) statusDot.className = 'status-indicator ' + dotClass;
        if (statusText) statusText.innerText = label;
        if (overlay) {
            if (videoOverlay) videoOverlay.style.display = 'flex';
            if (overlayMessage) overlayMessage.innerText = overlay;
            if (loadingSpinner) loadingSpinner.style.display = (dotClass === 'error') ? 'none' : 'block';
        } else {
            if (videoOverlay) videoOverlay.style.display = 'none';
        }
    }

    // --- Step 1: Build outgoing stream with audio + dummy video ---
    setStatus('', '準備中...', '正在準備麥克風...');

    // Create the combined stream
    localStream = new MediaStream();

    // Add dummy video track (CRITICAL for SDP negotiation)
    var dummyVideo = createDummyVideoTrack();
    if (dummyVideo) {
        localStream.addTrack(dummyVideo);
        console.log('✅ Dummy video track added to outgoing stream');
    }

    // Try to get microphone
    try {
        var micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        var audioTrack = micStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = false; // Mute initially (push-to-talk)
            localStream.addTrack(audioTrack);
            console.log('✅ Microphone track added');
        }
    } catch (micErr) {
        console.warn('Mic denied:', micErr);
        if (talkButton) talkButton.disabled = true;
        if (talkLabel) talkLabel.innerText = '麥克風未授權';
    }

    console.log('📤 Outgoing stream tracks:', localStream.getTracks().map(function (t) {
        return t.kind + ' (' + t.label + ')';
    }));

    // --- Step 2: Connect to PeerJS ---
    setStatus('', '連線伺服器...', '正在連接信令伺服器...');

    peer = new Peer();

    peer.on('open', function () {
        console.log('✅ PeerJS connected, my ID:', peer.id);
        makeCall();
    });

    peer.on('error', function (err) {
        console.error('❌ Peer error:', err);
        if (err.type === 'peer-unavailable') {
            setStatus('error', '找不到攝影機', '攝影機可能未開機\n\n點擊此處重試');
        } else {
            setStatus('error', '連線錯誤', '錯誤: ' + err.type + '\n\n點擊此處重試');
        }
        if (videoOverlay) videoOverlay.onclick = makeCall;
    });

    peer.on('disconnected', function () {
        setStatus('error', '伺服器斷線', '正在重新連線...');
        peer.reconnect();
    });

    // --- Step 3: Call the camera ---
    function makeCall() {
        setStatus('', '呼叫攝影機...', '正在呼叫 ' + cameraId + '...');

        console.log('📞 Calling camera:', cameraId);
        currentCall = peer.call(cameraId, localStream);

        if (!currentCall) {
            setStatus('error', '呼叫失敗', '無法建立連線\n請重新整理頁面');
            return;
        }

        currentCall.on('stream', function (remoteStream) {
            console.log('✅ GOT REMOTE STREAM!');
            console.log('  Video tracks:', remoteStream.getVideoTracks().length);
            console.log('  Audio tracks:', remoteStream.getAudioTracks().length);

            remoteVideo.srcObject = remoteStream;

            // Play video (muted first for autoplay policy)
            remoteVideo.muted = true;
            var p = remoteVideo.play();
            if (p && p.catch) {
                p.catch(function (e) {
                    console.warn('play() failed:', e);
                });
            }

            // Unmute after a short delay to hear camera audio
            setTimeout(function () {
                remoteVideo.muted = false;
                console.log('🔊 Video unmuted');
            }, 800);

            // Clear overlay
            setStatus('online', '已連線', null);
        });

        currentCall.on('close', function () {
            console.log('📴 Call closed');
            setStatus('error', '已斷線', '連線已中斷\n\n點擊此處重新連線');
            remoteVideo.srcObject = null;
            if (videoOverlay) videoOverlay.onclick = makeCall;
        });

        currentCall.on('error', function (err) {
            console.error('❌ Call error:', err);
            setStatus('error', '通話錯誤', '發生錯誤\n\n點擊此處重試');
            if (videoOverlay) videoOverlay.onclick = makeCall;
        });
    }

    // =============================================
    // PUSH-TO-TALK
    // =============================================
    function startTalking(e) {
        if (e.type === 'touchstart') e.preventDefault();
        if (!localStream) return;
        localStream.getAudioTracks().forEach(function (t) { t.enabled = true; });
        if (talkButton) talkButton.classList.add('recording');
        if (talkButton) talkButton.setAttribute('aria-pressed', 'true');
        if (talkLabel) talkLabel.innerText = '放開 結束';
    }

    function stopTalking(e) {
        if (e && e.type === 'touchend') e.preventDefault();
        if (!localStream) return;
        localStream.getAudioTracks().forEach(function (t) { t.enabled = false; });
        if (talkButton) talkButton.classList.remove('recording');
        if (talkButton) talkButton.setAttribute('aria-pressed', 'false');
        if (talkLabel) talkLabel.innerText = '按住 叫貓咪';
    }

    if (talkButton) {
        talkButton.addEventListener('mousedown', startTalking);
        talkButton.addEventListener('touchstart', startTalking, { passive: false });
    }
    window.addEventListener('mouseup', stopTalking);
    window.addEventListener('touchend', stopTalking, { passive: false });
    window.addEventListener('touchcancel', stopTalking);

    // =============================================
    // SWITCH ID
    // =============================================
    var switchBtn = document.getElementById('switchIdButton');
    if (switchBtn) {
        switchBtn.addEventListener('click', function () {
            if (confirm('確定要切換攝影機 ID？')) {
                localStorage.removeItem(PREF_CAMERA_ID);
                window.location.reload();
            }
        });
    }
}
