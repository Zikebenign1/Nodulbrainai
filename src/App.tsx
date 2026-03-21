/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from 'react';
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
import { Send, LogOut, LogIn, Sparkles, Camera, Microscope, PenTool, Zap, Loader2, Copy, Check, Trash2 } from 'lucide-react';
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

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [activeMode, setActiveMode] = useState<Mode>('Comedian');
  const [isLoading, setIsLoading] = useState(false);
  const [chatId, setChatId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

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
        await initializeChat(u.uid, activeMode);
      } else {
        setProfile(null);
        setMessages([]);
        setChatId(null);
      }
    });
    return unsubscribe;
  }, []);

  // Mode Change Listener
  useEffect(() => {
    if (user) {
      initializeChat(user.uid, activeMode);
    }
  }, [activeMode, user]);

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
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
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
      
      // Native vibration feedback if available
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
      {/* Header */}
      <header className="px-5 py-4 pt-[env(safe-area-inset-top,48px)] bg-black/95 border-b border-border flex justify-between items-center sticky top-0 z-50 backdrop-blur-md">
        <div className="font-extrabold text-brand text-sm tracking-wider flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-brand animate-pulse" />
          NO DULL BRAIN AI
        </div>
        <div className="flex items-center gap-3">
          <div className="text-[10px] font-black text-brand uppercase tracking-tighter">
            {profile?.displayName || 'GUEST'}
          </div>
          {user ? (
            <button onClick={handleLogout} className="text-white/50 hover:text-white transition-colors p-1 active:scale-90">
              <LogOut size={18} />
            </button>
          ) : (
            <button onClick={handleLogin} className="text-brand hover:text-brand/80 transition-colors p-1 active:scale-90">
              <LogIn size={18} />
            </button>
          )}
        </div>
      </header>

      {/* Ticker */}
      <div className="ticker-wrap">
        <div className="ticker">
          🔥 TRENDING: #NoDullBrainAI • 📸 IDENTITY-LOCK READY • 🔬 MEDICAL ARTIST ONLINE • 🎬 STORYTELLER ACTIVE • 🦾 VIRAL BEAST SCRIPTS GENERATING
        </div>
      </div>

      {/* Chat Area */}
      <main id="chat" className="flex-1 overflow-y-auto p-5 pb-40 flex flex-col no-scrollbar scroll-smooth">
        <AnimatePresence initial={false}>
          {messages.length === 0 && !isLoading && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex-1 flex flex-col items-center justify-center text-center opacity-30 space-y-4"
            >
              <Sparkles size={64} className="text-brand animate-pulse" />
              <div className="text-sm font-bold max-w-[200px]">
                {user ? `Oshey ${profile?.displayName}! 😂 Wetin we dey create today?` : "Login to start creating magic! ✨"}
              </div>
            </motion.div>
          )}
          
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ type: "spring", damping: 20, stiffness: 300 }}
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
                  className="absolute -right-2 -bottom-2 p-2 bg-panel border border-border rounded-full text-white/40 hover:text-brand transition-all active:scale-75 shadow-lg"
                >
                  {copiedId === msg.id ? <Check size={14} className="text-brand" /> : <Copy size={14} />}
                </button>
              )}
            </motion.div>
          ))}
          
          {isLoading && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              className="bubble bubble-ai flex items-center gap-2"
            >
              <Loader2 size={16} className="animate-spin text-brand" />
              <span className="text-xs font-bold animate-pulse">Brain dey cook... 🍳</span>
            </motion.div>
          )}
        </AnimatePresence>
        <div ref={chatEndRef} />
      </main>

      {/* Mode Selector */}
      <div className="selector-row px-5 py-3 flex gap-2 overflow-x-auto no-scrollbar bg-black/50 backdrop-blur-xl border-t border-border/30 sticky bottom-0 z-40">
        {modes.map((m) => (
          <button
            key={m.id}
            onClick={() => {
              setActiveMode(m.id);
              if ('vibrate' in navigator) navigator.vibrate(10);
            }}
            className={cn(
              "pill flex items-center gap-1.5 active:scale-95 transition-transform",
              activeMode === m.id && "active",
              !activeMode && m.color
            )}
          >
            <m.icon size={12} className={cn(activeMode === m.id ? "text-black" : m.color)} />
            {m.label}
          </button>
        ))}
      </div>

      {/* Footer Input */}
      <footer className="fixed bottom-0 w-full p-4 pb-[calc(1.5rem + env(safe-area-inset-bottom, 20px))] bg-gradient-to-t from-black via-black/95 to-transparent z-50">
        <div className="max-w-4xl mx-auto">
          {!user ? (
            <button 
              onClick={handleLogin}
              className="w-full bg-brand text-black font-black py-4 rounded-full flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-[0.98] transition-all shadow-[0_0_30px_rgba(255,153,0,0.3)]"
            >
              <LogIn size={20} />
              LOGIN TO START CREATING
            </button>
          ) : (
            <div className="bg-[#151515] border border-[#333] rounded-[30px] flex items-center p-1.5 shadow-2xl focus-within:border-brand/50 transition-colors">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Talk your mind..."
                className="flex-1 bg-transparent border-none text-white px-4 py-2 h-12 resize-none text-sm focus:ring-0 placeholder:text-white/20"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || isLoading}
                className={cn(
                  "w-11 h-11 rounded-full flex items-center justify-center transition-all active:scale-90",
                  input.trim() && !isLoading ? "bg-brand text-black shadow-[0_0_15px_rgba(255,153,0,0.4)]" : "bg-white/5 text-white/20"
                )}
              >
                {isLoading ? <Loader2 size={20} className="animate-spin" /> : <Zap size={20} fill="currentColor" />}
              </button>
            </div>
          )}
        </div>
      </footer>

      {/* Toast Notification for Copy */}
      <AnimatePresence>
        {copiedId && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed top-24 left-1/2 -translate-x-1/2 px-4 py-2 bg-brand text-black text-[10px] font-black rounded-full shadow-2xl z-[100] uppercase tracking-widest"
          >
            Copied to clipboard! 🚀
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
