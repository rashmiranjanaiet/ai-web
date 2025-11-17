

import React, { useState, useRef, useCallback, useEffect } from 'react';
// Fix: Removed `LiveSession` as it is not an exported member of '@google/genai'.
import { GoogleGenAI, Chat, Modality, Blob, LiveServerMessage } from '@google/genai';
import { Message, ChatRole, GroundingSource } from './types';
import ChatMessage from './components/ChatMessage';
import { SendIcon, MicIcon, StopIcon } from './components/icons';
import { encode, decode, decodeAudioData } from './utils/audio';

// Add type declarations for the aistudio object on the window
declare global {
    // Fix: Defined a named interface `AIStudio` to avoid declaration conflicts.
    interface AIStudio {
        hasSelectedApiKey: () => Promise<boolean>;
        openSelectKey: () => Promise<void>;
    }
    interface Window {
        aistudio?: AIStudio;
    }
}


// Helper to check for grounding keywords
const hasGroundingKeywords = (text: string, keywords: string[]): boolean => {
    const lowerText = text.toLowerCase();
    return keywords.some(keyword => lowerText.includes(keyword));
};

const SEARCH_KEYWORDS = ['who', 'what is', 'when', 'latest', 'news', 'search for'];
const MAPS_KEYWORDS = ['where', 'nearby', 'directions', 'restaurants', 'locations', 'find'];

const App: React.FC = () => {
    const [messages, setMessages] = useState<Message[]>([
        { id: '1', role: ChatRole.AI, text: 'Hello! How can I help you today? You can ask me questions, or press the microphone to talk.' }
    ]);
    const [input, setInput] = useState('');
    const [isListening, setIsListening] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [isApiKeyReady, setIsApiKeyReady] = useState(false);
    
    const chatRef = useRef<Chat | null>(null);
    // Fix: Using `any` for the session promise as `LiveSession` type is not exported.
    const sessionPromiseRef = useRef<Promise<any> | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);

    const chatContainerRef = useRef<HTMLDivElement>(null);

     useEffect(() => {
        // Check for API key when the component mounts
        const checkApiKey = async () => {
            if (window.aistudio && await window.aistudio.hasSelectedApiKey()) {
                setIsApiKeyReady(true);
            }
        };
        checkApiKey();
    }, []);

    useEffect(() => {
        if (chatContainerRef.current) {
            chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }
    }, [messages]);
    
    const handleSelectApiKey = async () => {
        if (window.aistudio) {
            await window.aistudio.openSelectKey();
            // Optimistically assume the user selected a key and update the state
            setIsApiKeyReady(true);
        }
    };
    
    // Initialize text chat
    const initializeChat = useCallback(() => {
        if (!chatRef.current) {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
            chatRef.current = ai.chats.create({ model: 'gemini-2.5-flash' });
        }
    }, []);

    const handleApiError = (error: unknown, aiMessageId?: string) => {
        console.error("API Error:", error);
        const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
        
        if (errorMessage.includes("API Key") || errorMessage.includes("Requested entity was not found")) {
            setIsApiKeyReady(false); // Reset state to show the key selection screen
             const systemMessage: Message = {
                id: Date.now().toString(),
                role: ChatRole.SYSTEM,
                text: "Your API key is invalid or missing. Please select a valid key to continue."
            };
            if(aiMessageId){
                 setMessages(prev => prev.filter(msg => msg.id !== aiMessageId).concat(systemMessage));
            } else {
                 setMessages(prev => [...prev, systemMessage]);
            }
        } else {
            const displayError = `Sorry, I ran into an error: ${errorMessage}`;
            if(aiMessageId){
                setMessages(prev => prev.map(msg => msg.id === aiMessageId ? { ...msg, text: displayError, isLoading: false } : msg));
            } else {
                setMessages(prev => [...prev, { id: Date.now().toString(), role: ChatRole.SYSTEM, text: displayError }]);
            }
        }
    };

    const sendMessage = async (messageText: string) => {
        if (!messageText.trim() || isLoading) return;

        setIsLoading(true);
        const userMessage: Message = { id: Date.now().toString(), role: ChatRole.USER, text: messageText };
        setMessages(prev => [...prev, userMessage]);
        setInput('');

        const aiMessageId = (Date.now() + 1).toString();
        const aiMessagePlaceholder: Message = { id: aiMessageId, role: ChatRole.AI, text: '', isLoading: true };
        setMessages(prev => [...prev, aiMessagePlaceholder]);

        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
            let responseText = '';
            let sources: GroundingSource[] = [];

            if (hasGroundingKeywords(messageText, MAPS_KEYWORDS)) {
                // Maps Grounding
                const position = await new Promise<GeolocationPosition>((resolve, reject) => {
                    navigator.geolocation.getCurrentPosition(resolve, reject);
                });
                const { latitude, longitude } = position.coords;

                const response = await ai.models.generateContent({
                    model: "gemini-2.5-flash",
                    contents: messageText,
                    config: {
                        tools: [{ googleMaps: {} }],
                        toolConfig: { retrievalConfig: { latLng: { latitude, longitude } } }
                    },
                });
                responseText = response.text;
                sources = response.candidates?.[0]?.groundingMetadata?.groundingChunks
                    ?.map((chunk: any) => ({
                        title: chunk.maps?.title || 'Map Result',
                        uri: chunk.maps?.uri,
                        // Fix: Using `as const` to ensure the type is inferred as 'maps' literal, not string.
                        type: 'maps' as const
                    })).filter((s: any) => s.uri) || [];

            } else if (hasGroundingKeywords(messageText, SEARCH_KEYWORDS)) {
                // Search Grounding
                const response = await ai.models.generateContent({
                    model: "gemini-2.5-flash",
                    contents: messageText,
                    config: { tools: [{ googleSearch: {} }] },
                });
                responseText = response.text;
                sources = response.candidates?.[0]?.groundingMetadata?.groundingChunks
                    ?.map((chunk: any) => ({
                        title: chunk.web?.title || 'Web Search Result',
                        uri: chunk.web?.uri,
                        // Fix: Using `as const` to ensure the type is inferred as 'search' literal, not string.
                        type: 'search' as const
                    })).filter((s: any) => s.uri) || [];
            } else {
                // Standard Chat
                initializeChat();
                if(chatRef.current){
                    const response = await chatRef.current.sendMessage({ message: messageText });
                    responseText = response.text;
                }
            }

            setMessages(prev => prev.map(msg => msg.id === aiMessageId ? { ...msg, text: responseText, sources: sources, isLoading: false } : msg));
        } catch (error) {
            handleApiError(error, aiMessageId);
        } finally {
            setIsLoading(false);
        }
    };
    
    const stopListening = useCallback(() => {
        if (sessionPromiseRef.current) {
            sessionPromiseRef.current.then(session => session.close());
            sessionPromiseRef.current = null;
        }
        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(track => track.stop());
            mediaStreamRef.current = null;
        }
        if(scriptProcessorRef.current){
            scriptProcessorRef.current.disconnect();
            scriptProcessorRef.current = null;
        }
        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
            audioContextRef.current.close();
            audioContextRef.current = null;
        }
        setIsListening(false);
    }, []);


    const startListening = async () => {
        if (isListening) {
            stopListening();
            return;
        }
        
        try {
            mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
            setIsListening(true);
            
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
            let currentInputTranscription = '';
            let currentOutputTranscription = '';
            
            let nextStartTime = 0;
            const outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
            const outputNode = outputAudioContext.createGain();
            outputNode.connect(outputAudioContext.destination);

            let userInputId: string | null = null;
            let aiResponseId: string | null = null;

            sessionPromiseRef.current = ai.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                callbacks: {
                    onopen: () => {
                        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
                        const source = audioContextRef.current.createMediaStreamSource(mediaStreamRef.current as MediaStream);
                        scriptProcessorRef.current = audioContextRef.current.createScriptProcessor(4096, 1, 1);
                        
                        scriptProcessorRef.current.onaudioprocess = (audioProcessingEvent) => {
                            const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                            const l = inputData.length;
                            const int16 = new Int16Array(l);
                            for (let i = 0; i < l; i++) {
                                int16[i] = inputData[i] * 32768;
                            }
                            const pcmBlob: Blob = {
                                data: encode(new Uint8Array(int16.buffer)),
                                mimeType: 'audio/pcm;rate=16000',
                            };
                            sessionPromiseRef.current?.then((session) => {
                                session.sendRealtimeInput({ media: pcmBlob });
                            });
                        };
                        source.connect(scriptProcessorRef.current);
                        scriptProcessorRef.current.connect(audioContextRef.current.destination);
                    },
                    onmessage: async (message: LiveServerMessage) => {
                        if (message.serverContent?.inputTranscription) {
                            const text = message.serverContent.inputTranscription.text;
                            currentInputTranscription += text;
                            if (!userInputId) {
                                userInputId = Date.now().toString();
                                setMessages(prev => [...prev, { id: userInputId as string, role: ChatRole.USER, text: `*${currentInputTranscription}*` }]);
                            } else {
                                setMessages(prev => prev.map(msg => msg.id === userInputId ? { ...msg, text: `*${currentInputTranscription}*` } : msg));
                            }
                        }
                        
                        if (message.serverContent?.outputTranscription) {
                            const text = message.serverContent.outputTranscription.text;
                            currentOutputTranscription += text;
                            if (!aiResponseId) {
                                aiResponseId = (Date.now() + 1).toString();
                                setMessages(prev => [...prev, { id: aiResponseId as string, role: ChatRole.AI, text: currentOutputTranscription }]);
                            } else {
                                setMessages(prev => prev.map(msg => msg.id === aiResponseId ? { ...msg, text: currentOutputTranscription } : msg));
                            }
                        }

                        if(message.serverContent?.turnComplete){
                            const fullInput = currentInputTranscription;
                            setMessages(prev => prev.map(msg => msg.id === userInputId ? { ...msg, text: fullInput } : msg));
                            
                            currentInputTranscription = '';
                            currentOutputTranscription = '';
                            userInputId = null;
                            aiResponseId = null;
                        }

                        const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData.data;
                        if (base64Audio) {
                            nextStartTime = Math.max(nextStartTime, outputAudioContext.currentTime);
                            const audioBuffer = await decodeAudioData(decode(base64Audio), outputAudioContext, 24000, 1);
                            const source = outputAudioContext.createBufferSource();
                            source.buffer = audioBuffer;
                            source.connect(outputNode);
                            source.start(nextStartTime);
                            nextStartTime = nextStartTime + audioBuffer.duration;
                        }
                    },
                    // Fix: The onerror callback expects an ErrorEvent, not an Error.
                    onerror: (e: ErrorEvent) => {
                        handleApiError(new Error(e.message));
                        stopListening();
                    },
                    onclose: () => {
                       // Session closed
                    },
                },
                config: {
                    responseModalities: [Modality.AUDIO],
                    inputAudioTranscription: {},
                    outputAudioTranscription: {},
                },
            });

        } catch (error) {
            console.error("Failed to start microphone:", error);
            setIsListening(false);
            setMessages(prev => [...prev, {id: Date.now().toString(), role: ChatRole.SYSTEM, text: "Could not access microphone. Please check permissions."}])
        }
    };


    if (!isApiKeyReady) {
        return (
            <div className="flex flex-col items-center justify-center h-screen bg-gray-900 text-white font-sans">
                <div className="text-center p-6 bg-gray-800 rounded-xl shadow-2xl">
                    <h1 className="text-3xl font-bold mb-3 bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-indigo-500">
                       Welcome to LAXMI BRO
                    </h1>
                    <p className="mb-6 text-gray-400 max-w-sm">
                        To get started, please select a Gemini API key. This is required to power the AI features of the assistant.
                    </p>
                    <button
                        onClick={handleSelectApiKey}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-6 rounded-lg transition-all duration-300 transform hover:scale-105"
                    >
                        Select API Key
                    </button>
                     <p className="text-xs text-gray-500 mt-4">
                        Ensure your key is configured for the Gemini API. For details on billing, visit <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noopener noreferrer" className="underline hover:text-indigo-400">ai.google.dev</a>.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-screen bg-gray-900 text-white font-sans">
            <header className="p-4 border-b border-gray-700 shadow-md">
                <h1 className="text-xl font-bold text-center bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-indigo-500">
                    LAXMI BRO
                </h1>
            </header>
            <main ref={chatContainerRef} className="flex-1 overflow-y-auto p-4 md:p-6">
                <div className="max-w-4xl mx-auto">
                    {messages.map((msg) => (
                        <ChatMessage key={msg.id} message={msg} />
                    ))}
                </div>
            </main>
            <footer className="p-4 border-t border-gray-700 bg-gray-900/80 backdrop-blur-sm">
                <div className="max-w-4xl mx-auto flex items-center gap-4">
                    <div className="flex-1 relative">
                        <input
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && sendMessage(input)}
                            placeholder={isListening ? "Listening..." : "Type your message..."}
                            disabled={isListening || isLoading}
                            className="w-full bg-gray-800 border border-gray-600 rounded-full py-3 px-6 pr-16 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all duration-300 disabled:opacity-50"
                        />
                         <button
                            onClick={() => sendMessage(input)}
                            disabled={isLoading || !input.trim() || isListening}
                            className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-indigo-400 disabled:hover:text-gray-400 disabled:opacity-50 transition-colors"
                         >
                            <SendIcon className="w-6 h-6" />
                        </button>
                    </div>
                    <button
                        onClick={isListening ? stopListening : startListening}
                        className={`p-3 rounded-full transition-all duration-300 ${isListening ? 'bg-red-500 hover:bg-red-600 animate-pulse' : 'bg-indigo-600 hover:bg-indigo-700'}`}
                    >
                        {isListening ? <StopIcon className="w-6 h-6 text-white"/> : <MicIcon className="w-6 h-6 text-white" />}
                    </button>
                </div>
            </footer>
        </div>
    );
};

export default App;
