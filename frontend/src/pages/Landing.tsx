import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAtom } from "jotai";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import {
  userIdAtom,
  usernameAtom,
  isHostAtom,
  currentUserAtom,
  isAuthenticatedAtom,
} from "../store/roomStore";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import { 
  Zap, 
  Waves, 
  Sparkles, 
  Video, 
  Mic, 
  Monitor,
  Users,
  ArrowRight,
  Flower2
} from "lucide-react";

function generateRoomId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz";
  const part1 = Array.from(
    { length: 3 },
    () => chars[Math.floor(Math.random() * chars.length)],
  ).join("");
  const part2 = Array.from(
    { length: 3 },
    () => chars[Math.floor(Math.random() * chars.length)],
  ).join("");
  return `${part1}-${part2}`;
}

function generateUserId(): string {
  return `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export function Landing() {
  const navigate = useNavigate();
  const [currentUser] = useAtom(currentUserAtom);
  const [isAuthenticated] = useAtom(isAuthenticatedAtom);
  const [, setUserId] = useAtom(userIdAtom);
  const [, setUsername] = useAtom(usernameAtom);
  const [, setIsHost] = useAtom(isHostAtom);
  const [name] = useState(currentUser?.username || "Test User");
  const [roomCode, setRoomCode] = useState("");
  const [showJoinInput, setShowJoinInput] = useState(false);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const featuresRef = useRef<HTMLDivElement>(null);
  const workflowRef = useRef<HTMLDivElement>(null);
  const testimonialsRef = useRef<HTMLDivElement>(null);
  const ctaRef = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
    
    tl.from(".hero-title", { y: 60, opacity: 0, duration: 1 })
      .from(".hero-subtitle", { y: 40, opacity: 0, duration: 0.8 }, "-=0.6")
      .from(".hero-input", { y: 30, opacity: 0, duration: 0.8 }, "-=0.4")
      .from(".hero-mockup", { y: 80, opacity: 0, duration: 1.2 }, "-=0.4");
    
    gsap.from(".feature-card", {
      scrollTrigger: {
        trigger: featuresRef.current,
        start: "top 80%",
      },
      y: 60,
      opacity: 0,
      duration: 0.8,
      stagger: 0.2,
    });
    
    gsap.from(".workflow-text", {
      scrollTrigger: {
        trigger: workflowRef.current,
        start: "top 75%",
      },
      x: -60,
      opacity: 0,
      duration: 1,
    });
    
    gsap.from(".workflow-card", {
      scrollTrigger: {
        trigger: workflowRef.current,
        start: "top 75%",
      },
      x: 60,
      opacity: 0,
      duration: 1,
    });
    
    gsap.from(".testimonial-card", {
      scrollTrigger: {
        trigger: testimonialsRef.current,
        start: "top 80%",
      },
      y: 40,
      opacity: 0,
      duration: 0.6,
      stagger: 0.15,
    });
    
    gsap.from(ctaRef.current, {
      scrollTrigger: {
        trigger: ctaRef.current,
        start: "top 85%",
      },
      scale: 0.9,
      opacity: 0,
      duration: 0.8,
    });
  }, { scope: containerRef });
  
  const handleCreateRoom = () => {
    if (!name.trim()) {
      toast.error("Please enter your name");
      return;
    }
    const newRoomId = generateRoomId();
    const newUserId = currentUser?.id || generateUserId();
    setUserId(newUserId);
    setUsername(name);
    setIsHost(true);
    navigate(`/room/${newRoomId}`);
  };
  
  const handleJoinRoom = () => {
    if (!name.trim()) {
      toast.error("Please enter your name");
      return;
    }
    if (!roomCode.match(/^[a-z]{3}-[a-z]{3}$/)) {
      toast.error("Invalid room code format. Should be xxx-xxx");
      return;
    }
    const newUserId = currentUser?.id || generateUserId();
    setUserId(newUserId);
    setUsername(name);
    setIsHost(false);
    navigate(`/room/${roomCode}`);
  };

  return (
    <div ref={containerRef} className="min-h-screen w-full" style={{ backgroundColor: '#FCFCFA' }}>
      <nav className="w-full px-6 py-6 flex items-center justify-between max-w-7xl mx-auto">
        <div className="flex items-center gap-2">
          <Flower2 className="w-8 h-8" style={{ color: '#1F1F1F' }} />
          <span className="text-2xl font-serif" style={{ color: '#1F1F1F', fontFamily: 'Playfair Display, serif' }}>
            Popcorn
          </span>
        </div>
        
        <div className="flex items-center gap-6">
          {!isAuthenticated && (
            <a href="#" className="text-base font-medium hover:opacity-70 transition-opacity" style={{ color: '#666666' }}>
              Log in
            </a>
          )}
          <Button
            onClick={handleCreateRoom}
            variant="default"
            className="rounded-full px-8"
          >
            Start a meeting
          </Button>
        </div>
      </nav>

      <section ref={heroRef} className="w-full px-6 py-20 md:py-32">
        <div className="max-w-4xl mx-auto text-center">
          <h1 
            className="hero-title text-5xl md:text-6xl lg:text-7xl font-serif mb-8 leading-tight"
            style={{ color: '#1F1F1F', fontFamily: 'Playfair Display, serif' }}
          >
            Collaboration,
            <br />without the chaos.
          </h1>
          
          <p 
            className="hero-subtitle text-lg md:text-xl mb-12 max-w-2xl mx-auto leading-relaxed"
            style={{ color: '#666666', fontFamily: 'Inter, sans-serif' }}
          >
            High-fidelity video for creative teams. 4K audio, AI summaries, and zero installs.
          </p>

          <div className="w-full flex justify-center mb-6">
            <div 
              className="hero-input inline-flex items-center rounded-full px-2 py-1.5 shadow-lg w-full max-w-lg"
              style={{ backgroundColor: '#FFFFFF', border: '1px solid #E5E5E5' }}
            >
              <div className="flex-1 px-4">
                <Input
                  type="text"
                  value={showJoinInput ? roomCode : ""}
                  onChange={(e) => setRoomCode(e.target.value.toLowerCase())}
                  onFocus={() => setShowJoinInput(true)}
                  placeholder="Enter room code"
                  className="border-0 shadow-none bg-transparent text-base"
                  style={{ color: '#1F1F1F' }}
                  maxLength={7}
                />
              </div>
              <Button
                variant="default"
                onClick={handleJoinRoom}
                disabled={!showJoinInput}
                className="rounded-full px-6"
              >
                Join Room
              </Button>
            </div>
          </div>

          <div className="mb-10">
            <button 
              onClick={handleCreateRoom}
              className="text-base font-medium underline hover:opacity-70 transition-opacity"
              style={{ color: '#666666' }}
            >
              Or start a personal meeting →
            </button>
          </div>

          <div className="flex justify-center mb-16">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full" style={{ backgroundColor: '#EAD4CE' }}>
              <span className="w-2 h-2 rounded-full bg-red-500"></span>
              <span className="text-sm font-medium" style={{ color: '#1F1F1F' }}>REC</span>
            </div>
          </div>

          <div className="w-full flex justify-center">
            <div className="w-full max-w-5xl relative">
              <div 
                className="hero-mockup rounded-2xl overflow-hidden shadow-2xl"
                style={{ 
                  backgroundColor: '#FFFFFF', 
                  border: '1px solid #E5E5E5',
                  transform: 'rotate(-1deg)'
                }}
              >
                <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: '1px solid #E5E5E5' }}>
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#EAD4CE' }}></div>
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#D4E2D4' }}></div>
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#E5E5E5' }}></div>
                  <div className="flex-1 mx-4 rounded-md px-3 py-1" style={{ backgroundColor: '#FCFCFA', border: '1px solid #E5E5E5' }}>
                    <span className="text-xs" style={{ color: '#666666' }}>popcorn.meet</span>
                  </div>
                </div>
                
                <div className="p-6 grid grid-cols-2 gap-4" style={{ backgroundColor: '#FCFCFA' }}>
                  {[1, 2, 3, 4].map((i) => (
                    <div 
                      key={i}
                      className="aspect-video rounded-xl overflow-hidden relative"
                      style={{ 
                        backgroundColor: i === 1 ? '#D4E2D4' : '#E5E5E5',
                        border: '1px solid #E5E5E5'
                      }}
                    >
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div 
                          className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-serif"
                          style={{ backgroundColor: '#FFFFFF', color: '#1F1F1F' }}
                        >
                          {['S', 'D', 'K', 'M'][i-1]}
                        </div>
                      </div>
                      <div className="absolute bottom-2 left-2 right-2">
                        <span 
                          className="text-xs px-2 py-1 rounded"
                          style={{ backgroundColor: 'rgba(0,0,0,0.5)', color: '#FFFFFF' }}
                        >
                          {['Sarah', 'Davide', 'Kenji', 'You'][i-1]}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="px-6 py-4 flex items-center justify-center gap-4" style={{ borderTop: '1px solid #E5E5E5' }}>
                  <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: '#1F1F1F' }}>
                    <Mic className="w-5 h-5 text-white" />
                  </div>
                  <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: '#1F1F1F' }}>
                    <Video className="w-5 h-5 text-white" />
                  </div>
                  <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: '#D4E2D4' }}>
                    <Monitor className="w-5 h-5" style={{ color: '#1F1F1F' }} />
                  </div>
                  <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: '#EAD4CE' }}>
                    <Users className="w-5 h-5" style={{ color: '#1F1F1F' }} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section ref={featuresRef} className="w-full px-6 py-24" style={{ backgroundColor: '#FCFCFA' }}>
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-3 gap-12">
            <div className="feature-card text-center">
              <div 
                className="w-16 h-16 rounded-full mx-auto mb-6 flex items-center justify-center"
                style={{ backgroundColor: '#D4E2D4' }}
              >
                <Zap className="w-8 h-8" style={{ color: '#1F1F1F' }} />
              </div>
              <h3 
                className="text-xl font-serif mb-3"
                style={{ color: '#1F1F1F', fontFamily: 'Playfair Display, serif' }}
              >
                Instant Flow
              </h3>
              <p className="text-base leading-relaxed" style={{ color: '#666666' }}>
                No downloads. Just send a link and you're live in the browser.
              </p>
            </div>

            <div className="feature-card text-center">
              <div 
                className="w-16 h-16 rounded-full mx-auto mb-6 flex items-center justify-center"
                style={{ backgroundColor: '#EAD4CE' }}
              >
                <Waves className="w-8 h-8" style={{ color: '#1F1F1F' }} />
              </div>
              <h3 
                className="text-xl font-serif mb-3"
                style={{ color: '#1F1F1F', fontFamily: 'Playfair Display, serif' }}
              >
                Studio Sound
              </h3>
              <p className="text-base leading-relaxed" style={{ color: '#666666' }}>
                Crystal clear 4K audio so you hear every breath and bass drop.
              </p>
            </div>

            <div className="feature-card text-center">
              <div 
                className="w-16 h-16 rounded-full mx-auto mb-6 flex items-center justify-center"
                style={{ backgroundColor: '#D4E2D4' }}
              >
                <Sparkles className="w-8 h-8" style={{ color: '#1F1F1F' }} />
              </div>
              <h3 
                className="text-xl font-serif mb-3"
                style={{ color: '#1F1F1F', fontFamily: 'Playfair Display, serif' }}
              >
                AI Scribe
              </h3>
              <p className="text-base leading-relaxed" style={{ color: '#666666' }}>
                Focus on the art. We'll transcribe and summarize the critique.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section ref={workflowRef} className="w-full px-6 py-24" style={{ backgroundColor: '#FAF5F4' }}>
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-2 gap-16 items-center">
            <div className="workflow-text">
              <h2 
                className="text-4xl font-serif mb-6 leading-tight"
                style={{ color: '#1F1F1F', fontFamily: 'Playfair Display, serif' }}
              >
                Share pixels, not blurry approximations.
              </h2>
              <p className="text-lg mb-8 leading-relaxed" style={{ color: '#666666' }}>
                Screen sharing optimized for design software. True color accuracy and 60fps framerate.
              </p>
              <div className="flex items-center gap-3">
                <span className="text-base font-medium" style={{ color: '#1F1F1F' }}>
                  Noise Cancellation:
                </span>
                <div 
                  className="w-12 h-6 rounded-full relative"
                  style={{ backgroundColor: '#D4E2D4' }}
                >
                  <div 
                    className="absolute right-1 top-1 w-4 h-4 rounded-full"
                    style={{ backgroundColor: '#1F1F1F' }}
                  ></div>
                </div>
                <span className="text-sm font-medium" style={{ color: '#1F1F1F' }}>ON</span>
              </div>
            </div>

            <div 
              className="workflow-card rounded-xl p-8 relative"
              style={{ backgroundColor: '#FFFFFF', border: '1px solid #E5E5E5' }}
            >
              <div className="aspect-video rounded-lg mb-6" style={{ backgroundColor: '#F1F5F1' }}>
                <div className="w-full h-full flex items-center justify-center">
                  <Monitor className="w-16 h-16" style={{ color: '#666666' }} />
                </div>
              </div>
              
              <div 
                className="absolute -right-4 top-4 px-4 py-2 rounded-full shadow-lg flex items-center gap-2"
                style={{ backgroundColor: '#1F1F1F' }}
              >
                <span className="w-2 h-2 rounded-full bg-green-500"></span>
                <span className="text-sm font-medium" style={{ color: '#FFFFFF' }}>Recording started</span>
              </div>
              
              <div className="flex items-center justify-between">
                <span className="text-sm" style={{ color: '#666666' }}>Screen Share Active</span>
                <Users className="w-5 h-5" style={{ color: '#666666' }} />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section ref={testimonialsRef} className="w-full px-6 py-24" style={{ backgroundColor: '#FCFCFA' }}>
        <div className="max-w-6xl mx-auto">
          <div className="flex justify-center gap-6 overflow-x-auto pb-4">
            <div 
              className="testimonial-card shrink-0 w-80 p-8 rounded-xl"
              style={{ backgroundColor: '#FFFFFF', border: '1px solid #E5E5E5' }}
            >
              <p className="text-lg mb-6 leading-relaxed" style={{ color: '#1F1F1F' }}>
                "Finally, a video tool that doesn't compress my Figma designs."
              </p>
              <div className="flex items-center gap-3">
                <div 
                  className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium"
                  style={{ backgroundColor: '#D4E2D4', color: '#1F1F1F' }}
                >
                  S
                </div>
                <div>
                  <p className="font-medium" style={{ color: '#1F1F1F' }}>Sarah</p>
                  <p className="text-sm" style={{ color: '#666666' }}>Art Director</p>
                </div>
              </div>
            </div>

            <div 
              className="testimonial-card shrink-0 w-80 p-8 rounded-xl"
              style={{ backgroundColor: '#FFFFFF', border: '1px solid #E5E5E5' }}
            >
              <p className="text-lg mb-6 leading-relaxed" style={{ color: '#1F1F1F' }}>
                "The AI summaries save me 20 minutes after every sync."
              </p>
              <div className="flex items-center gap-3">
                <div 
                  className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium"
                  style={{ backgroundColor: '#EAD4CE', color: '#1F1F1F' }}
                >
                  D
                </div>
                <div>
                  <p className="font-medium" style={{ color: '#1F1F1F' }}>Davide</p>
                  <p className="text-sm" style={{ color: '#666666' }}>Producer</p>
                </div>
              </div>
            </div>

            <div 
              className="testimonial-card shrink-0 w-80 p-8 rounded-xl"
              style={{ backgroundColor: '#FFFFFF', border: '1px solid #E5E5E5' }}
            >
              <p className="text-lg mb-6 leading-relaxed" style={{ color: '#1F1F1F' }}>
                "The audio quality is actually good enough for music production review."
              </p>
              <div className="flex items-center gap-3">
                <div 
                  className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium"
                  style={{ backgroundColor: '#D4E2D4', color: '#1F1F1F' }}
                >
                  K
                </div>
                <div>
                  <p className="font-medium" style={{ color: '#1F1F1F' }}>Kenji</p>
                  <p className="text-sm" style={{ color: '#666666' }}>Composer</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section ref={ctaRef} className="w-full px-6 py-24">
        <div className="max-w-6xl mx-auto flex justify-center">
          <div 
            className="w-full max-w-5xl rounded-2xl p-16 text-center"
            style={{ backgroundColor: '#1F1F1F' }}
          >
            <h2 
              className="text-4xl md:text-5xl font-serif mb-6"
              style={{ color: '#FFFFFF', fontFamily: 'Playfair Display, serif' }}
            >
              Ready to flow?
            </h2>
            
            <div className="mb-8">
              <span className="text-5xl font-medium" style={{ color: '#FFFFFF' }}>$0</span>
              <span className="text-lg ml-2" style={{ color: '#999999' }}>/mo</span>
            </div>
            
            <p className="text-base mb-10" style={{ color: '#999999' }}>
              Free for personal use.
            </p>
            
            <div className="flex justify-center">
              <Button
                variant="secondary"
                onClick={handleCreateRoom}
                className="rounded-full px-8 py-3 text-lg inline-flex items-center"
              >
                Start Meeting Now <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
            </div>
          </div>
        </div>
      </section>

      <footer className="w-full px-6 py-10 border-t" style={{ borderColor: '#E5E5E5' }}>
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <Flower2 className="w-6 h-6" style={{ color: '#1F1F1F' }} />
            <span className="text-lg font-serif" style={{ color: '#1F1F1F', fontFamily: 'Playfair Display, serif' }}>
              Popcorn
            </span>
          </div>
          
          <div className="flex items-center gap-8 text-sm" style={{ color: '#666666' }}>
            <a href="#" className="hover:text-black transition-colors">Privacy</a>
            <a href="#" className="hover:text-black transition-colors">Terms</a>
            <a href="#" className="hover:text-black transition-colors">Contact</a>
          </div>
          
          <p className="text-sm" style={{ color: '#666666' }}>
            © {new Date().getFullYear()} Popcorn. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}