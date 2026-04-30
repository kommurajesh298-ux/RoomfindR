import { useEffect, useRef, useState, useCallback } from 'react';
import { FaMicrophone, FaMicrophoneSlash, FaPhoneSlash } from 'react-icons/fa6';
import { chatService } from '../../services/chat.service';
import { toast } from 'react-hot-toast';

interface ParticipantInfo {
    userId: string;
    name: string;
    photo?: string;
}

interface CallOverlayProps {
    chatId: string;
    currentUserId: string;
    currentUserName: string;
    currentUserPhoto?: string;
    participants: ParticipantInfo[]; // Changed to objects for better UI
    onLeave: () => void;
}

interface SignalingMessage {
    userId: string;
    offer?: RTCSessionDescriptionInit;
    answer?: RTCSessionDescriptionInit;
    candidate?: RTCIceCandidateInit;
}

const CallOverlay = ({
    chatId,
    currentUserId,
    currentUserName,
    currentUserPhoto,
    participants,
    onLeave
}: CallOverlayProps) => {
    const [isMuted, setIsMuted] = useState(false);
    const localStreamRef = useRef<MediaStream | null>(null);
    const peerConnections = useRef<Record<string, RTCPeerConnection>>({});
    const remoteStreams = useRef<Record<string, MediaStream>>({});

    const createPeerConnection = useCallback((userId: string) => {
        const pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });

        localStreamRef.current?.getTracks().forEach(track => pc.addTrack(track, localStreamRef.current!));

        pc.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
            if (event.candidate) {
                chatService.updateCallSignal(chatId, currentUserId, { candidate: event.candidate.toJSON() });
            }
        };

        pc.ontrack = (event) => {
            remoteStreams.current[userId] = event.streams[0];
            // Render remote audio (hidden)
            const audio = new Audio();
            audio.srcObject = event.streams[0];
            audio.play();
        };

        peerConnections.current[userId] = pc;
        return pc;
    }, [chatId, currentUserId]);

    const handleOffer = useCallback(async (userId: string, offer: RTCSessionDescriptionInit) => {
        const pc = createPeerConnection(userId);
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await chatService.updateCallSignal(chatId, currentUserId, { answer });
    }, [chatId, currentUserId, createPeerConnection]);

    const startSignaling = useCallback(async () => {
        // Every new joiner sends an offer to all existing participants in the 'participants' list
        // Filter out ourselves
        const otherParticipantIds = participants.map(p => p.userId).filter(id => id !== currentUserId);

        for (const targetUserId of otherParticipantIds) {
            const pc = createPeerConnection(targetUserId);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            await chatService.updateCallSignal(chatId, currentUserId, { offer, targetUserId });
        }
    }, [chatId, currentUserId, participants, createPeerConnection]);

    useEffect(() => {
        let unsubscribe: (() => void) | undefined;
        let stream: MediaStream | undefined;

        const initCall = async () => {
            try {
                stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                localStreamRef.current = stream;

                // Subscribe to other participants' signaling
                unsubscribe = chatService.subscribeToCallSignals(chatId, async (rawSignals) => {
                    const signals = rawSignals as unknown as SignalingMessage[];
                    for (const signal of signals) {
                        if (signal.userId === currentUserId) continue;

                        if (signal.offer && !peerConnections.current[signal.userId]) {
                            await handleOffer(signal.userId, signal.offer);
                        } else if (signal.answer && peerConnections.current[signal.userId]) {
                            await peerConnections.current[signal.userId].setRemoteDescription(new RTCSessionDescription(signal.answer));
                        } else if (signal.candidate && peerConnections.current[signal.userId]) {
                            await peerConnections.current[signal.userId].addIceCandidate(new RTCIceCandidate(signal.candidate));
                        }
                    }
                });

                // Start signaling process
                await startSignaling();
            } catch (error) {
                console.error('Call initialization failed:', error);
                toast.error('Could not access microphone');
                onLeave();
            }
        };

        initCall();

        return () => {
            if (unsubscribe) unsubscribe();
            if (stream) stream.getTracks().forEach(track => track.stop());
            Object.values(peerConnections.current).forEach(pc => pc.close()); // eslint-disable-line react-hooks/exhaustive-deps
        };
    }, [chatId, currentUserId, handleOffer, onLeave, startSignaling]);

    const toggleMute = () => {
        if (localStreamRef.current) {
            localStreamRef.current.getAudioTracks()[0].enabled = isMuted;
            setIsMuted(!isMuted);
        }
    };

    return (
        <div className="fixed inset-0 z-[300] bg-black/95 backdrop-blur-2xl flex flex-col p-6 animate-in fade-in duration-500">
            {/* Call Header */}
            <div className="flex flex-col items-center mt-12 mb-12">
                <div className="relative">
                    <div className="absolute inset-0 bg-blue-500/20 rounded-full animate-ping"></div>
                    <div className="w-24 h-24 bg-blue-600 rounded-full flex items-center justify-center text-white relative z-10 shadow-2xl shadow-blue-500/40">
                        <FaPhoneSlash size={32} className="rotate-[135deg]" />
                    </div>
                </div>
                <h2 className="text-2xl font-black text-white mt-8 tracking-tight">Active Hostel Call</h2>
                <p className="text-blue-400 font-bold uppercase tracking-[0.2em] text-[10px] mt-2">Connecting Residents...</p>
            </div>

            {/* Participants Grid */}
            <div className="flex-1 grid grid-cols-2 md:grid-cols-3 gap-8 max-w-5xl mx-auto w-full px-4 overflow-y-auto no-scrollbar content-center justify-items-center">
                {/* Current User */}
                <div className="flex flex-col items-center">
                    <div className={`relative w-24 h-24 rounded-[36px] border-4 transition-all duration-700 ${!isMuted ? 'border-blue-500 shadow-2xl shadow-blue-500/60 scale-110' : 'border-white/5 opacity-50'}`}>
                        <img
                            src={currentUserPhoto || `https://ui-avatars.com/api/?name=${encodeURIComponent(currentUserName)}&background=3B82F6&color=fff`}
                            className="w-full h-full rounded-[30px] object-cover"
                            alt="Me"
                        />
                        {!isMuted && (
                            <div className="absolute -bottom-2 -right-2 w-8 h-8 bg-blue-500 rounded-2xl flex items-center justify-center shadow-lg animate-bounce">
                                <FaMicrophone size={12} className="text-white" />
                            </div>
                        )}
                    </div>
                    <span className="text-white/80 text-[11px] font-black mt-4 uppercase tracking-[0.2em]">Me</span>
                </div>

                {/* Other Participants */}
                {participants.filter(p => p.userId !== currentUserId).map((p) => (
                    <div key={p.userId} className="flex flex-col items-center animate-in zoom-in duration-700">
                        <div className="relative w-24 h-24 rounded-[36px] border-4 border-white/10 bg-white/5 group overflow-hidden">
                            <img
                                src={p.photo || `https://ui-avatars.com/api/?name=${encodeURIComponent(p.name)}&background=1e293b&color=fff`}
                                className="w-full h-full rounded-[30px] object-cover opacity-60 group-hover:opacity-100 transition-opacity"
                                alt={p.name}
                            />
                            <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                                <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse mx-1"></div>
                                <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse mx-1 [animation-delay:200ms]"></div>
                                <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse mx-1 [animation-delay:400ms]"></div>
                            </div>
                        </div>
                        <span className="text-white/40 text-[11px] font-black mt-4 uppercase tracking-[0.2em]">{p.name}</span>
                    </div>
                ))}

                {/* If no one else is here yet */}
                {participants.length <= 1 && (
                    <div className="flex flex-col items-center col-span-full mt-8 animate-pulse">
                        <p className="text-white/20 text-xs font-bold uppercase tracking-widest">Waiting for others to join...</p>
                    </div>
                )}
            </div>

            {/* Call Controls */}
            <div className="flex items-center justify-center gap-6 mb-12">
                <button
                    onClick={toggleMute}
                    className={`w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300 ${isMuted ? 'bg-white/10 text-white' : 'bg-white text-black shadow-xl shadow-white/20'}`}
                >
                    {isMuted ? <FaMicrophoneSlash size={24} /> : <FaMicrophone size={24} />}
                </button>
                <button
                    onClick={onLeave}
                    className="w-16 h-16 bg-red-500 text-white rounded-full flex items-center justify-center shadow-xl shadow-red-500/40 hover:scale-110 active:scale-95 transition-all"
                >
                    <FaPhoneSlash size={24} />
                </button>
            </div>
        </div>
    );
};

export default CallOverlay;
