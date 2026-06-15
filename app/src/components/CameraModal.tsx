'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

const CloseIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);

const CheckIcon = () => (
  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);

const SwitchIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/>
    <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
  </svg>
);

const CameraErrorIcon = () => (
  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
    <circle cx="12" cy="13" r="4"/>
  </svg>
);

const VideoIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="23 7 16 12 23 17 23 7"/>
    <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
  </svg>
);

const PhotoIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
    <circle cx="12" cy="13" r="4"/>
  </svg>
);

const StopIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="#ffffff">
    <rect x="6" y="6" width="12" height="12" rx="2"/>
  </svg>
);

interface CameraModalProps {
  onCapture: (file: File) => void;
  onClose: () => void;
  enableVideo?: boolean;
}

const MAX_VIDEO_DURATION = 10;

export default function CameraModal({ onCapture, onClose, enableVideo = true }: CameraModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [mode, setMode] = useState<'photo' | 'video'>('photo');
  const [preview, setPreview] = useState<string | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [capturedType, setCapturedType] = useState<'photo' | 'video'>('photo');
  const [error, setError] = useState<string | null>(null);
  const [isFlashing, setIsFlashing] = useState(false);
  const [isStarting, setIsStarting] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);

  const startCamera = useCallback(async (facing: 'environment' | 'user') => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setIsStarting(true);
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: true,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setIsStarting(false);
    } catch (err: any) {
      console.error('Camera error:', err);
      if (err.name === 'NotAllowedError') {
        setError('Autorisez l\'acces a la camera et au micro dans les parametres de votre navigateur');
      } else if (err.name === 'NotFoundError') {
        setError('Aucune camera trouvee sur cet appareil');
      } else {
        setError('Impossible d\'acceder a la camera');
      }
      setIsStarting(false);
    }
  }, []);

  useEffect(() => {
    startCamera(facingMode);
    return () => {
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchCamera = async () => {
    const newFacing = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(newFacing);
    await startCamera(newFacing);
  };

  const switchMode = (newMode: 'photo' | 'video') => {
    if (newMode === mode) return;
    setMode(newMode);
  };

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (facingMode === 'user') { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
    ctx.drawImage(video, 0, 0);
    setIsFlashing(true);
    setTimeout(() => setIsFlashing(false), 150);
    canvas.toBlob((blob) => {
      if (blob) {
        setCapturedBlob(blob);
        setCapturedType('photo');
        setPreview(URL.createObjectURL(blob));
      }
    }, 'image/jpeg', 0.92);
  };

  const startRecording = () => {
    if (!streamRef.current) return;
    chunksRef.current = [];
    setRecordingTime(0);

    let mimeType = 'video/webm;codecs=vp9';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm;codecs=vp8';
    }
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm';
    }
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/mp4';
    }

    try {
      const recorder = new MediaRecorder(streamRef.current, { mimeType });
      recorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
        const type = mimeType.includes('mp4') ? 'video/mp4' : 'video/webm';
        const blob = new Blob(chunksRef.current, { type });
        setCapturedBlob(blob);
        setCapturedType('video');
        setPreview(URL.createObjectURL(blob));
        setIsRecording(false);
        if (timerRef.current) clearInterval(timerRef.current);
      };

      recorder.start(100);
      setIsRecording(true);

      const startTime = Date.now();
      timerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        setRecordingTime(elapsed);
        if (elapsed >= MAX_VIDEO_DURATION) {
          stopRecording();
        }
      }, 200);
    } catch (err) {
      console.error('Recording error:', err);
      setError('Enregistrement video non supporte sur ce navigateur');
    }
  };

  const stopRecording = () => {
    if (recorderRef.current && recorderRef.current.state === 'recording') {
      recorderRef.current.stop();
    }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  };

  const handleCapture = () => {
    if (mode === 'photo') {
      capturePhoto();
    } else {
      if (isRecording) {
        stopRecording();
      } else {
        startRecording();
      }
    }
  };

  const retake = () => {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setCapturedBlob(null);
    setRecordingTime(0);
  };

  const confirmCapture = () => {
    if (!capturedBlob) return;
    if (capturedType === 'photo') {
      const file = new File([capturedBlob], 'camera_photo.jpg', { type: 'image/jpeg' });
      onCapture(file);
    } else {
      const ext = capturedBlob.type.includes('mp4') ? 'mp4' : 'webm';
      const file = new File([capturedBlob], `camera_video.${ext}`, { type: capturedBlob.type });
      onCapture(file);
    }
    cleanup();
  };

  const cleanup = () => {
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    if (preview) URL.revokeObjectURL(preview);
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const handleClose = () => { cleanup(); onClose(); };

  const progressPercent = (recordingTime / MAX_VIDEO_DURATION) * 100;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: '#000', display: 'flex', flexDirection: 'column' }}>
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
        padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        background: 'linear-gradient(to bottom, rgba(0,0,0,0.6), transparent)',
      }}>
        <button onClick={handleClose} aria-label="Fermer" style={{
          background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(10px)',
          border: 'none', width: 40, height: 40, borderRadius: '50%', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <CloseIcon />
        </button>

        {isRecording && (
          <div style={{
            background: 'rgba(239,68,68,0.9)', borderRadius: 20, padding: '6px 14px',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#fff', animation: 'pulse 1s infinite' }} />
            <span style={{ color: '#fff', fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
              {recordingTime}s / {MAX_VIDEO_DURATION}s
            </span>
          </div>
        )}

        {!preview && !error && !isRecording && (
          <button onClick={switchCamera} aria-label="Changer camera" style={{
            background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(10px)',
            border: 'none', width: 40, height: 40, borderRadius: '50%', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <SwitchIcon />
          </button>
        )}
      </div>

      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {error ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 40, textAlign: 'center' }}>
            <div style={{ marginBottom: 16 }}><CameraErrorIcon /></div>
            <p style={{ color: '#fff', fontSize: 16, marginBottom: 20 }}>{error}</p>
            <button onClick={handleClose} style={{ background: '#fff', color: '#000', border: 'none', padding: '12px 32px', borderRadius: 12, fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
              Retour
            </button>
          </div>
        ) : preview ? (
          capturedType === 'video' ? (
            <video src={preview} playsInline autoPlay loop muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <img src={preview} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          )
        ) : (
          <>
            <video ref={videoRef} playsInline muted autoPlay style={{ width: '100%', height: '100%', objectFit: 'cover', transform: facingMode === 'user' ? 'scaleX(-1)' : 'none' }} />
            {isStarting && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <p style={{ color: '#fff', fontSize: 15 }}>Chargement...</p>
              </div>
            )}
          </>
        )}
        {isFlashing && <div style={{ position: 'absolute', inset: 0, background: '#fff', opacity: 0.8 }} />}
      </div>

      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10,
        padding: '20px 20px 36px',
        background: 'linear-gradient(to top, rgba(0,0,0,0.6), transparent)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
      }}>
        {!preview && !error ? (
          <>
            <div style={{ position: 'relative' }}>
              {isRecording && (
                <svg width="84" height="84" style={{ position: 'absolute', top: -6, left: -6, transform: 'rotate(-90deg)' }}>
                  <circle cx="42" cy="42" r="38" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="4" />
                  <circle cx="42" cy="42" r="38" fill="none" stroke="#ef4444" strokeWidth="4"
                    strokeDasharray={`${2 * Math.PI * 38}`}
                    strokeDashoffset={`${2 * Math.PI * 38 * (1 - progressPercent / 100)}`}
                    strokeLinecap="round"
                    style={{ transition: 'stroke-dashoffset 0.3s' }}
                  />
                </svg>
              )}
              <button onClick={handleCapture} disabled={isStarting} style={{
                width: 72, height: 72, borderRadius: '50%', background: 'transparent',
                border: `4px solid ${mode === 'video' ? '#ef4444' : '#fff'}`,
                padding: 4, cursor: isStarting ? 'default' : 'pointer',
                opacity: isStarting ? 0.4 : 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {isRecording ? (
                  <StopIcon />
                ) : (
                  <div style={{
                    width: '100%', height: '100%', borderRadius: '50%',
                    background: mode === 'video' ? '#ef4444' : '#fff',
                  }} />
                )}
              </button>
            </div>

            {enableVideo && !isRecording && (
              <div style={{
                display: 'flex', gap: 0, borderRadius: 20,
                background: 'rgba(255,255,255,0.1)', backdropFilter: 'blur(10px)',
                overflow: 'hidden',
              }}>
                <button onClick={() => switchMode('photo')} style={{
                  padding: '8px 20px', border: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: mode === 'photo' ? 'rgba(255,255,255,0.25)' : 'transparent',
                  color: '#fff', fontSize: 13, fontWeight: mode === 'photo' ? 700 : 400,
                }}>
                  <PhotoIcon /> Photo
                </button>
                <button onClick={() => switchMode('video')} style={{
                  padding: '8px 20px', border: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: mode === 'video' ? 'rgba(255,255,255,0.25)' : 'transparent',
                  color: '#fff', fontSize: 13, fontWeight: mode === 'video' ? 700 : 400,
                }}>
                  <VideoIcon /> Video
                </button>
              </div>
            )}
          </>
        ) : preview ? (
          <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
            <button onClick={retake} aria-label="Reprendre" style={{
              width: 56, height: 56, borderRadius: '50%',
              background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(10px)',
              border: '2px solid rgba(255,255,255,0.4)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <CloseIcon />
            </button>
            <button onClick={confirmCapture} aria-label="Valider" style={{
              width: 72, height: 72, borderRadius: '50%', background: '#22c55e',
              border: '4px solid rgba(255,255,255,0.3)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 20px rgba(34,197,94,0.4)',
            }}>
              <CheckIcon />
            </button>
          </div>
        ) : null}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>

      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </div>
  );
}