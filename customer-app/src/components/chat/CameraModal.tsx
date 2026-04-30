import React, { useRef, useState, useEffect } from 'react';
import { FaCamera, FaTimes, FaSync } from 'react-icons/fa';

interface CameraModalProps {
    onCapture: (_file: File) => void;
    onClose: () => void;
}

const CameraModal: React.FC<CameraModalProps> = ({ onCapture, onClose }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [stream, setStream] = useState<MediaStream | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');

    const startCamera = React.useCallback(async () => {
        // Stop current tracks from Ref
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }

        try {
            const newStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: facingMode },
                audio: false
            });
            streamRef.current = newStream;
            setStream(newStream);
            if (videoRef.current) {
                videoRef.current.srcObject = newStream;
            }
        } catch (err) {
            console.error('Error accessing camera:', err);
            setError('Could not access camera. Please check permissions.');
        }
    }, [facingMode]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        startCamera();
        return () => {
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
                streamRef.current = null;
            }
        };
    }, [startCamera]);

    const handleCapture = () => {
        if (videoRef.current && canvasRef.current) {
            const video = videoRef.current;
            const canvas = canvasRef.current;
            const context = canvas.getContext('2d');

            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;

            if (context) {
                context.drawImage(video, 0, 0, canvas.width, canvas.height);
                canvas.toBlob((blob) => {
                    if (blob) {
                        const file = new File([blob], `capture_${Date.now()}.jpg`, { type: 'image/jpeg' });
                        onCapture(file);
                        onClose();
                    }
                }, 'image/jpeg', 0.9);
            }
        }
    };

    const toggleCamera = () => {
        setFacingMode(prev => prev === 'user' ? 'environment' : 'user');
    };

    return (
        <div className="fixed inset-0 z-[300] bg-black flex flex-col items-center justify-center animate-in fade-in duration-300">
            {/* Header */}
            <div className="absolute top-0 left-0 right-0 p-6 flex justify-between items-center z-10 bg-gradient-to-b from-black/60 to-transparent">
                <h3 className="text-white font-black tracking-tight text-lg">Camera</h3>
                <button onClick={onClose} className="w-10 h-10 bg-white/10 backdrop-blur-md rounded-full flex items-center justify-center text-white hover:bg-white/20 transition-all">
                    <FaTimes size={18} />
                </button>
            </div>

            {/* Video Preview */}
            <div className="relative w-full h-full flex items-center justify-center overflow-hidden">
                {error ? (
                    <div className="text-center p-6">
                        <p className="text-red-400 font-bold mb-4">{error}</p>
                        <button onClick={onClose} className="px-6 py-2 bg-white rounded-full font-bold">Close</button>
                    </div>
                ) : (
                    <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        className="w-full h-full object-cover"
                    />
                )}
                <canvas ref={canvasRef} className="hidden" />
            </div>

            {/* Controls */}
            <div className="absolute bottom-0 left-0 right-0 p-10 flex items-center justify-around bg-gradient-to-t from-black/80 to-transparent">
                <button
                    onClick={toggleCamera}
                    className="w-12 h-12 bg-white/10 backdrop-blur-md rounded-full flex items-center justify-center text-white hover:bg-white/20 transition-all active:scale-90"
                >
                    <FaSync size={20} />
                </button>

                <button
                    onClick={handleCapture}
                    disabled={!stream}
                    className="w-20 h-20 bg-white rounded-full flex items-center justify-center text-black shadow-2xl hover:scale-105 transition-all active:scale-95 disabled:opacity-50"
                >
                    <div className="w-16 h-16 border-4 border-black/10 rounded-full flex items-center justify-center">
                        <FaCamera size={28} />
                    </div>
                </button>

                <div className="w-12" /> {/* Placeholder for symmetry */}
            </div>
        </div>
    );
};

export default CameraModal;
