const PREF_PEER_ID = 'petcam_camera_id';
let peer = null;
let currentCall = null;
let localStream = null;

// UI Elements
const peerIdDisplay = document.getElementById('peerIdDisplay');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const localVideo = document.getElementById('localVideo');
const remoteAudio = document.getElementById('remoteAudio');
const chimeAudio = document.getElementById('chimeAudio');

function updateStatus(status, text, isMonitoring = false) {
    statusDot.className = `status-indicator ${status}`;
    statusText.innerText = text;

    if (isMonitoring) {
        document.body.classList.add('is-monitoring');
    } else {
        document.body.classList.remove('is-monitoring');
    }
}

// Generate an easy-to-read unique ID or retrieve existing one
function getOrCreatePeerId() {
    let id = localStorage.getItem(PREF_PEER_ID);
    if (!id) {
        // Generate a 6-character uppercase alphanumeric ID
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Excluded confusing chars like O,0,1,I
        id = 'PET-';
        for (let i = 0; i < 4; i++) {
            id += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        localStorage.setItem(PREF_PEER_ID, id);
    }
    return id;
}

// Initialize Camera
async function initCamera() {
    updateStatus('error', '正在存取攝影機...');
    try {
        // Try getting the back camera with highly compatible minimal resolution for old phones
        // Older Android devices often fail to hardware encode WebRTC video if resolution is too high or unpredictable, sending a black screen instead.
        try {
            localStream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: 'environment',
                    width: { ideal: 640 },
                    height: { ideal: 480 },
                    frameRate: { ideal: 15 }
                },
                audio: true // Start pulling mic
            });
        } catch (initialErr) {
            console.warn('Back camera failed, trying ANY camera...', initialErr);
            // Fallback for older devices that don't recognize "environment" or have other issues
            localStream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 640 },
                    height: { ideal: 480 },
                    frameRate: { ideal: 15 }
                },
                audio: true
            });
        }

        localVideo.srcObject = localStream;

        lockWakeState();
        initPeer();

    } catch (err) {
        console.error('Failed to access camera completely:', err);
        updateStatus('error', '無法存取攝影機，請確認權限或硬體');
        peerIdDisplay.innerText = "Error: " + err.name;
    }
}

// Initialize PeerJS
function initPeer() {
    updateStatus('', '連接伺服器中...');
    const cameraId = getOrCreatePeerId();

    // Using free public PeerJS server
    peer = new Peer(cameraId);

    peer.on('open', (id) => {
        peerIdDisplay.innerText = id;
        updateStatus('online', '系統備妥，等待連線');
    });

    peer.on('call', (call) => {
        console.log('Incoming call...', call.peer);

        // Disconnect existing call if any
        if (currentCall) {
            currentCall.close();
        }

        currentCall = call;

        // Answer automatically with our video/audio stream
        call.answer(localStream);

        // When viewer sends their audio stream (Walkie-Talkie)
        call.on('stream', (remoteStream) => {
            remoteAudio.srcObject = remoteStream;
            // Unmute remote audio naturally
            remoteAudio.muted = false;
        });

        call.on('close', () => {
            console.log('Call ended');
            currentCall = null;
            remoteAudio.srcObject = null;
            updateStatus('online', '系統備妥，等待連線');
        });

        // Play Chime and go Blackout Mode
        if (chimeAudio) chimeAudio.play().catch(e => console.log(e));
        updateStatus('online', '連線中', true);
    });

    peer.on('disconnected', () => {
        updateStatus('error', '與伺服器斷線，重連中...');
        peer.reconnect();
    });

    peer.on('error', (err) => {
        console.error('Peer error:', err);
        updateStatus('error', '發生錯誤: ' + err.type);
    });
}

// Keep screen awake API
let wakeLock = null;
async function lockWakeState() {
    if ('wakeLock' in navigator) {
        try {
            wakeLock = await navigator.wakeLock.request('screen');
            wakeLock.addEventListener('release', () => {
                console.log('Wake Lock was released');
            });
            console.log('Wake Lock is active');
        } catch (err) {
            console.error('Wake Lock API err:', err);
        }
    }
}

// Reactivate wake lock if tab becomes visible again
document.addEventListener('visibilitychange', async () => {
    if (wakeLock !== null && document.visibilityState === 'visible') {
        lockWakeState();
    }
});

// Set up UI interactions
const startCameraButton = document.getElementById('startCameraButton');
if (startCameraButton) {
    startCameraButton.addEventListener('click', () => {
        startCameraButton.style.display = 'none';

        // Explicitly unlock audio context by attempting a silent play
        chimeAudio.volume = 0;
        chimeAudio.play().then(() => {
            chimeAudio.pause();
            chimeAudio.currentTime = 0;
            chimeAudio.volume = 1;
        }).catch(err => console.warn('Could not unlock audio context:', err));

        // Similarly attempt playing the dummy remoteAudio
        remoteAudio.volume = 0;
        remoteAudio.play().catch(() => { });
        remoteAudio.volume = 1;

        // Start the WebRTC connection process
        initCamera();
    });
}
