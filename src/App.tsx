/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  doc, 
  getDoc, 
  setDoc, 
  collection, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  addDoc, 
  serverTimestamp,
  User,
  Timestamp,
  handleFirestoreError,
  OperationType
} from './firebase';
import { generateResponse, Mode } from './services/gemini';
import ReactMarkdown from 'react-markdown';
import { Send, LogOut, LogIn, Sparkles, Camera, Microscope, PenTool, Zap, Loader2, Copy, Check, Trash2, Plus, History, X, MessageSquare, ArrowDownCircle, ChevronRight } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { motion, AnimatePresence } from 'motion/react';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface Message {
  id: string;
  content: string;
  role: 'user' | 'ai';
  createdAt: Timestamp;
}

interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  role: 'user' | 'admin';
}

interface Chat {
  id: string;
  userId: string;
  mode: Mode;
  createdAt: Timestamp;
  lastMessage?: string;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [activeMode, setActiveMode] = useState<Mode>('Comedian');
  const [isLoading, setIsLoading] = useState(false);
  const [chatId, setChatId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [pastChats, setPastChats] = useState<Chat[]>([]);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        const userDoc = doc(db, 'users', u.uid);
        const snap = await getDoc(userDoc);
        if (!snap.exists()) {
          const newProfile: UserProfile = {
            uid: u.uid,
            email: u.email || '',
            displayName: u.displayName || 'Guest',
            photoURL: u.photoURL || '',
            role: 'user'
          };
          await setDoc(userDoc, newProfile);
          setProfile(newProfile);
        } else {
          setProfile(snap.data() as UserProfile);
        }
        await initializeChat(u.uid, 'Comedian');
      } else {
        setProfile(null);
        setMessages([]);
        setChatId(null);
        setPastChats([]);
      }
    });
    return unsubscribe;
  }, []);

  // Mode Change Listener
  useEffect(() => {
    if (user && !isHistoryOpen) {
      initializeChat(user.uid, activeMode);
    }
  }, [activeMode, user]);

  // Past Chats Listener
  useEffect(() => {
    if (!user) return;

    const chatsRef = collection(db, 'chats');
    const q = query(chatsRef, where('userId', '==', user.uid), orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(q, (snap) => {
      const chats = snap.docs.map(d => ({ id: d.id, ...d.data() } as Chat));
      setPastChats(chats);
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'chats'));

    return unsubscribe;
  }, [user]);

  // Auto-expand textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  }, [input]);

  const initializeChat = async (uid: string, mode: string) => {
    const chatsRef = collection(db, 'chats');
    const q = query(chatsRef, where('userId', '==', uid), where('mode', '==', mode), orderBy('createdAt', 'desc'));
    
    const unsubscribe = onSnapshot(q, (snap) => {
      if (!snap.empty) {
        setChatId(snap.docs[0].id);
      } else {
        createNewChat(uid, mode as Mode);
      }
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'chats'));
    
    return unsubscribe;
  };

  const createNewChat = async (uid: string, mode: Mode) => {
    try {
      const docRef = await addDoc(collection(db, 'chats'), {
        userId: uid,
        mode: mode,
        createdAt: serverTimestamp()
      });
      setChatId(docRef.id);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'chats');
    }
  };

  const handleScroll = useCallback(() => {
    if (chatContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
      setShowScrollBottom(!isNearBottom);
    }
  }, []);

  // Messages Listener
  useEffect(() => {
    if (!chatId) return;

    const messagesRef = collection(db, 'chats', chatId, 'messages');
    const q = query(messagesRef, orderBy('createdAt', 'asc'));

    const unsubscribe = onSnapshot(q, (snap) => {
      const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() } as Message));
      setMessages(msgs);
    }, (err) => handleFirestoreError(err, OperationType.LIST, `chats/${chatId}/messages`));

    return unsubscribe;
  }, [chatId]);

  // Scroll to bottom
  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    chatEndRef.current?.scrollIntoView({ behavior });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Login failed", error);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout failed", error);
    }
  };

  const handleNewChat = async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      await createNewChat(user.uid, 'Comedian');
      setActiveMode('Comedian');
      setMessages([]);
      if ('vibrate' in navigator) navigator.vibrate(20);
    } catch (err) {
      console.error("New chat failed", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || !user || !chatId || isLoading) return;

    const userMsg = input.trim();
    setInput('');
    setIsLoading(true);

    try {
      await addDoc(collection(db, 'chats', chatId, 'messages'), {
        content: userMsg,
        role: 'user',
        createdAt: serverTimestamp()
      });

      const aiResponse = await generateResponse(activeMode, userMsg, profile?.displayName || 'Guest');

      await addDoc(collection(db, 'chats', chatId, 'messages'), {
        content: aiResponse,
        role: 'ai',
        createdAt: serverTimestamp()
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `chats/${chatId}/messages`);
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
      
      if ('vibrate' in navigator) {
        navigator.vibrate(50);
      }
    });
  };

  const modes: { id: Mode; label: string; icon: any; color: string }[] = [
    { id: 'Comedian', label: 'Comedian', icon: Sparkles, color: 'text-brand' },
    { id: 'Identity-Lock', label: 'Identity Photo', icon: Camera, color: 'text-neon' },
    { id: 'Medical Artist', label: 'Medical Artist', icon: Microscope, color: 'text-med' },
    { id: 'Gen Z Story', label: 'Gen Z Story', icon: PenTool, color: 'text-story' },
    { id: 'Viral Beast', label: 'Viral Beast', icon: Zap, color: 'text-white' },
  ];

  return (
    <div className="flex flex-col h-screen bg-black text-white overflow-hidden select-none">
      {/* Dynamic Header */}
      <header className="px-5 py-4 pt-[env(safe-area-inset-top,40px)] bg-black/80 backdrop-blur-xl border-b border-white/5 flex justify-between items-center sticky top-0 z-[60]">
        <div className="flex items-center gap-3">
          {user && (
            <button 
              onClick={() => setIsHistoryOpen(true)}
              className="p-2 bg-white/5 hover:bg-white/10 text-white rounded-xl transition-all active:scale-95 group"
            >
              <History size={20} className="group-hover:text-brand transition-colors" />
            </button>
          )}
          <div className="flex flex-col">
            <div className="font-extrabold text-brand text-[10px] tracking-widest uppercase">
              No Dull Brain AI
            </div>
            <div className="text-[14px] font-black flex items-center gap-1.5">
              <span className="opacity-40">{activeMode}</span>
              <div className="w-1 h-1 rounded-full bg-brand/50 mt-1" />
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="hidden sm:flex flex-col items-end">
            <span className="text-[10px] font-black text-brand uppercase tracking-tighter line-clamp-1">
              {profile?.displayName || 'GUEST'}
            </span>
            <span className="text-[8px] text-white/30 uppercase tracking-[2px]">
              {user ? 'Verified' : 'Guest Mode'}
            </span>
          </div>
          {user ? (
            <button onClick={handleLogout} className="w-9 h-9 flex items-center justify-center bg-white/5 hover:bg-white/10 rounded-full transition-all active:scale-90 text-white/40 hover:text-white">
              <LogOut size={18} />
            </button>
          ) : (
            <button onClick={handleLogin} className="px-4 py-2 bg-brand text-black font-black text-[11px] rounded-full transition-all active:scale-95 shadow-[0_0_20px_rgba(255,153,0,0.3)]">
              JOIN AI
            </button>
          )}
        </div>
      </header>

      {/* Ticker */}
      <div className="ticker-wrap flex-shrink-0">
        <div className="ticker">
          🔥 TRENDING: #NoDullBrainAI • 📸 IDENTITY-LOCK READY • 🔬 MEDICAL ARTIST ONLINE • 🎬 STORYTELLER ACTIVE • 🦾 VIRAL BEAST SCRIPTS GENERATING
        </div>
      </div>

      {/* Main Chat View */}
      <main 
        id="chat" 
        ref={chatContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto no-scrollbar scroll-smooth relative"
      >
        <div className="chat-container py-10 flex flex-col min-h-full">
          <AnimatePresence initial={false}>
            {messages.length === 0 && !isLoading && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex-1 flex flex-col items-center justify-center text-center space-y-6 py-20"
              >
                <div className="relative">
                  <motion.div 
                    animate={{ scale: [1, 1.2, 1], opacity: [0.1, 0.3, 0.1] }}
                    transition={{ duration: 4, repeat: Infinity }}
                    className="absolute inset-0 bg-brand rounded-full blur-[60px]"
                  />
                  <Sparkles size={80} className="text-brand relative" />
                </div>
                <div className="space-y-2">
                  <h1 className="text-2xl font-black tracking-tight">Oshey {profile?.displayName?.split(' ')[0] || 'Guest'}! 😂</h1>
                  <p className="text-sm font-medium text-white/40 max-w-[280px] leading-relaxed">
                    Choose a mode and let's craft some magic today. Brain is steady on go!
                  </p>
                </div>
                
                <div className="grid grid-cols-2 gap-3 w-full max-w-sm pt-4">
                  {modes.slice(0, 4).map(m => (
                    <button 
                      key={m.id}
                      onClick={() => setActiveMode(m.id)}
                      className="p-4 bg-white/5 border border-white/5 rounded-2xl text-left hover:bg-white/10 hover:border-white/10 transition-all active:scale-95 group"
                    >
                      <m.icon size={20} className={cn("mb-2", activeMode === m.id ? "text-brand" : "text-white/40")} />
                      <div className="text-[11px] font-black uppercase tracking-wider">{m.label}</div>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
            
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: "spring", damping: 25, stiffness: 300 }}
                className={cn(
                  "bubble relative group select-text",
                  msg.role === 'ai' ? "bubble-ai" : "bubble-user"
                )}
              >
                <div className="markdown-body prose prose-invert prose-sm max-w-none">
                  <ReactMarkdown>
                    {msg.content}
                  </ReactMarkdown>
                </div>
                
                {msg.role === 'ai' && (
                  <button
                    onClick={() => copyToClipboard(msg.content, msg.id)}
                    className="absolute -right-3 -bottom-3 p-2 bg-[#121212] border border-white/5 rounded-full text-white/20 hover:text-brand transition-all active:scale-75 shadow-xl md:opacity-0 md:group-hover:opacity-100"
                  >
                    {copiedId === msg.id ? <Check size={14} className="text-brand" /> : <Copy size={14} />}
                  </button>
                )}
              </motion.div>
            ))}
            
            {isLoading && (
              <motion.div 
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className="bubble bubble-ai flex items-center gap-3 py-4"
              >
                <div className="flex gap-1 justify-center items-center">
                  <motion.div animate={{ scale: [1, 1.5, 1], opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1.2, delay: 0 }} className="w-1.5 h-1.5 bg-brand rounded-full" />
                  <motion.div animate={{ scale: [1, 1.5, 1], opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1.2, delay: 0.2 }} className="w-1.5 h-1.5 bg-brand rounded-full" />
                  <motion.div animate={{ scale: [1, 1.5, 1], opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1.2, delay: 0.4 }} className="w-1.5 h-1.5 bg-brand rounded-full" />
                </div>
                <span className="text-[10px] font-black uppercase tracking-widest text-brand/60">AI Computing</span>
              </motion.div>
            )}
          </AnimatePresence>
          <div ref={chatEndRef} />
        </div>
      </main>

      {/* Floating Scroll Bottom */}
      <AnimatePresence>
        {showScrollBottom && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: 10 }}
            onClick={() => scrollToBottom()}
            className="fixed bottom-36 right-1/2 translate-x-1/2 sm:right-10 sm:translate-x-0 z-[50] p-3 bg-white/10 backdrop-blur-md rounded-full border border-white/10 hover:bg-white/20 transition-all active:scale-90"
          >
            <ArrowDownCircle size={24} className="text-white" />
          </motion.button>
        )}
      </AnimatePresence>

      {/* Bottom Interface */}
      <div className="sticky bottom-0 w-full z-50">
        {/* Mode Pill Bar */}
        <div className="selector-row px-5 py-4 flex gap-3 overflow-x-auto no-scrollbar bg-gradient-to-t from-black via-black/90 to-transparent border-t border-white/5 scroll-smooth">
          {modes.map((m) => (
            <button
              key={m.id}
              onClick={() => {
                setActiveMode(m.id);
                if ('vibrate' in navigator) navigator.vibrate(10);
              }}
              className={cn(
                "pill flex items-center gap-2 px-5 py-2.5",
                activeMode === m.id && "active"
              )}
            >
              <m.icon size={14} className={cn(activeMode === m.id ? "text-black" : m.color)} />
              <span className="text-[11px] font-black uppercase tracking-widest">{m.label}</span>
            </button>
          ))}
        </div>

        {/* Input Footer */}
        <footer className="p-4 pb-[calc(1rem + env(safe-area-inset-bottom, 20px))] bg-black">
          <div className="chat-container">
            {!user ? (
              <button 
                onClick={handleLogin}
                className="w-full h-14 bg-brand text-black font-black rounded-full flex items-center justify-center gap-2 hover:scale-[1.01] active:scale-[0.98] transition-all shadow-[0_0_40px_rgba(255,153,0,0.2)]"
              >
                <LogIn size={22} />
                <span className="uppercase tracking-widest text-[12px]">Login to Start Creating</span>
              </button>
            ) : (
              <div className="relative group">
                <div className="absolute -inset-1 bg-gradient-to-r from-brand/20 to-neon/20 rounded-[32px] blur opacity-0 group-focus-within:opacity-100 transition-opacity duration-500" />
                <div className="relative bg-[#111] border border-white/5 rounded-[28px] flex items-end p-2 transition-all group-focus-within:border-white/20">
                  <textarea
                    ref={textareaRef}
                    rows={1}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                    placeholder={`Tell the ${activeMode} something...`}
                    className="flex-1 bg-transparent border-none text-white px-4 py-3 min-h-[50px] max-h-[180px] resize-none text-[15px] font-medium leading-relaxed focus:ring-0 placeholder:text-white/20 no-scrollbar"
                  />
                  <button
                    onClick={handleSend}
                    disabled={!input.trim() || isLoading}
                    className={cn(
                      "w-11 h-11 rounded-full flex items-center justify-center transition-all shrink-0 mb-0.5 mr-0.5",
                      input.trim() && !isLoading ? "bg-brand text-black shadow-lg" : "bg-white/5 text-white/10"
                    )}
                  >
                    {isLoading ? <Loader2 size={24} className="animate-spin" /> : <Zap size={22} fill="currentColor" />}
                  </button>
                </div>
              </div>
            )}
          </div>
        </footer>
      </div>

      {/* Copy Toast */}
      <AnimatePresence>
        {copiedId && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="fixed top-24 left-1/2 -translate-x-1/2 px-6 py-3 bg-brand text-black text-[11px] font-black rounded-full shadow-2xl z-[100] uppercase tracking-widest border-2 border-white/20"
          >
            Magic Copied! 🚀
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sidebar Panel */}
      <AnimatePresence>
        {isHistoryOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsHistoryOpen(false)}
              className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100]"
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="fixed right-0 top-0 bottom-0 w-full max-w-sm bg-[#080808] border-l border-white/5 z-[101] shadow-2xl flex flex-col"
            >
              <div className="p-6 pt-[env(safe-area-inset-top,48px)] border-b border-white/5 flex justify-between items-center bg-black/90 sticky top-0">
                <div className="flex flex-col">
                  <span className="text-brand font-black text-[10px] tracking-widest uppercase mb-1">Vault</span>
                  <div className="font-black text-xl flex items-center gap-2">
                    <History size={20} className="text-brand" />
                    PAST MAGIC
                  </div>
                </div>
                <button 
                  onClick={() => setIsHistoryOpen(false)}
                  className="w-10 h-10 flex items-center justify-center bg-white/5 rounded-full hover:bg-white/10 transition-all active:scale-90"
                >
                  <X size={24} />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto no-scrollbar p-5 space-y-3">
                {pastChats.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center opacity-30 space-y-4 px-10">
                    <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center border border-white/5">
                      <MessageSquare size={36} />
                    </div>
                    <p className="text-[13px] font-black uppercase tracking-widest leading-relaxed">No history yet! Start crafting to record your brilliance. ✨</p>
                  </div>
                ) : (
                  pastChats.map((chat) => (
                    <button
                      key={chat.id}
                      onClick={() => {
                        setActiveMode(chat.mode);
                        setChatId(chat.id);
                        setIsHistoryOpen(false);
                      }}
                      className={cn(
                        "w-full p-5 rounded-3xl border text-left transition-all active:scale-[0.98] group relative overflow-hidden",
                        chatId === chat.id 
                          ? "bg-brand/10 border-brand/30" 
                          : "bg-white/5 border-white/5 hover:border-white/10"
                      )}
                    >
                      {chatId === chat.id && (
                        <motion.div layoutId="activeChat" className="absolute left-0 top-0 bottom-0 w-1 bg-brand" />
                      )}
                      <div className="flex flex-col gap-2">
                        <div className="flex justify-between items-start">
                          <div className="flex flex-col">
                            <span className={cn(
                              "text-[10px] font-black uppercase tracking-[2px] mb-1",
                              chatId === chat.id ? "text-brand" : "text-white/40"
                            )}>
                              {chat.mode}
                            </span>
                            <div className="text-sm font-black text-white group-hover:text-brand transition-colors">
                              {chat.id.slice(-6).toUpperCase()} SESSION
                            </div>
                          </div>
                          <ChevronRight size={16} className="opacity-20 group-hover:opacity-100 transition-opacity" />
                        </div>
                        <div className="flex items-center gap-3 pt-2">
                          <span className="text-[9px] font-bold text-white/20 uppercase tracking-tighter">
                            {chat.createdAt?.toDate().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                          </span>
                          <div className="w-1 h-1 rounded-full bg-white/10" />
                          <span className="text-[9px] font-bold text-white/20 uppercase tracking-tighter">
                            {chat.createdAt?.toDate().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>

              <div className="p-6 bg-black border-t border-white/5">
                <button
                  onClick={handleNewChat}
                  className="w-full h-12 bg-white text-black font-black rounded-2xl flex items-center justify-center gap-2 hover:bg-brand transition-all active:scale-[0.98]"
                >
                  <Plus size={20} />
                  <span className="uppercase tracking-widest text-[11px]">New Session</span>
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
