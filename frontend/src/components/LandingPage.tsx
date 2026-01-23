import * as React from "react";
import { useAtom } from "jotai";
import { userAtom } from "../store/atoms";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { gsap } from "gsap";
import { webrtcApi } from "../services/api";
import { 
  Video, 
  Keyboard, 
  Menu, 
  HelpCircle, 
  MessageSquare, 
  Settings, 
  Grip, 
  ChevronLeft, 
  ChevronRight,
  Clock,
  Link as LinkIcon
} from "lucide-react";

interface LandingPageProps {
  onJoin: (roomName: string) => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onJoin }) => {
  const [user] = useAtom(userAtom);
  const [roomCode, setRoomCode] = React.useState("");
  const [currentTime, setCurrentTime] = React.useState<string>("");
  const navigate = useNavigate();
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Update clock to match header style
  React.useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const options: Intl.DateTimeFormatOptions = {
        hour: 'numeric',
        minute: 'numeric',
        weekday: 'short',
        month: 'short',
        day: 'numeric'
      };
      setCurrentTime(now.toLocaleDateString('en-US', options).replace(',', ' •'));
    };
    updateTime();
    const timer = setInterval(updateTime, 60000);
    return () => clearInterval(timer);
  }, []);

  // GSAP animation
  React.useEffect(() => {
    if (containerRef.current) {
      gsap.from(containerRef.current, { opacity: 0, y: 20, duration: 0.5, ease: "power2.inOut" });
    }
  }, []);

  const handleNewMeeting = async () => {
    if (!user) {
      toast.error("Please sign in to create a meeting");
      navigate("/login");
      return;
    }
    try {
      const { roomId } = await webrtcApi.createRoom();
      navigate(`/room/${roomId}`);
    } catch {
      toast.error("Failed to create room");
    }
  };

  const handleJoin = () => {
    if (!user) {
      toast.error("Please sign in to join a meeting");
      navigate(`/login?redirect=${roomCode}`);
      return;
    }
    if (roomCode) onJoin(roomCode);
  };

  return (
    <div ref={containerRef} className="flex flex-col h-screen bg-white text-gray-800 font-sans">
      <header className="flex items-center justify-between px-4 py-3 sticky top-0 bg-white z-50">
        <div className="flex items-center gap-4">
          <button className="p-2 hover:bg-gray-100 rounded-full text-gray-600">
            <Menu className="w-6 h-6" />
          </button>
          
          <div className="flex items-center gap-2 mb-1">
            <div className="flex items-center gap-1">
              <div className="relative w-8 h-8 flex items-center justify-center">
                 <Video className="w-8 h-8 text-green-600 fill-green-600" />
                 <div className="absolute bg-white w-2 h-2 -bottom-1 -left-1"></div>
              </div>
              <span className="text-xl text-gray-600 tracking-tight font-medium">
                Google <span className="font-medium text-gray-800">Meet</span>
              </span>
            </div>
          </div>
        </div>

         <div className="flex items-center gap-5">
           <span className="text-lg text-gray-600 hidden md:block">{currentTime}</span>
           <div className="flex items-center gap-2 text-gray-600">
             <button className="p-2 hover:bg-gray-100 rounded-full"><HelpCircle className="w-6 h-6" /></button>
             <button className="p-2 hover:bg-gray-100 rounded-full"><MessageSquare className="w-6 h-6" /></button>
             <button className="p-2 hover:bg-gray-100 rounded-full"><Settings className="w-6 h-6" /></button>
           </div>
           <div className="pl-2 flex items-center gap-4">
             <button className="p-2 hover:bg-gray-100 rounded-full"><Grip className="w-6 h-6 text-gray-600" /></button>
             {user ? (
               <div className="w-8 h-8 bg-purple-600 rounded-full flex items-center justify-center text-white text-sm font-medium cursor-pointer hover:ring-4 hover:ring-gray-100">
                 {user.name ? user.name.charAt(0).toUpperCase() : "U"}
               </div>
             ) : (
               <button
                 onClick={() => navigate("/login")}
                 className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium"
               >
                 Sign In
               </button>
             )}
           </div>
         </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        
        <aside className="hidden lg:flex flex-col w-[256px] pt-4 pr-4">
            <div className="flex flex-col gap-1">
                <button className="flex items-center gap-4 px-6 py-3 bg-blue-50 text-blue-600 rounded-r-full font-medium">
                    <Video className="w-6 h-6" />
                    <span>Meetings</span>
                </button>
                <button className="flex items-center gap-4 px-6 py-3 text-gray-700 hover:bg-gray-100 rounded-r-full font-medium">
                    <Clock className="w-6 h-6" />
                    <span>Calls</span>
                </button>
            </div>
        </aside>

        <main className="flex-1 flex items-center justify-center p-6 overflow-y-auto">
          <div className="w-full max-w-7xl grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            
            <div className="max-w-xl space-y-8 pl-4 lg:pl-8">
              <div className="space-y-4">
                <h1 className="text-4xl md:text-5xl text-gray-900 leading-[1.15]">
                  Video calls and meetings for everyone
                </h1>
                <p className="text-xl text-gray-500 font-light leading-relaxed">
                  Connect, collaborate, and celebrate from anywhere with Google Meet
                </p>
              </div>

               <div className="flex flex-wrap items-center gap-4 md:gap-6 pt-4">
                 <button
                   onClick={handleNewMeeting}
                   className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-3 rounded-md font-medium transition-colors shadow-sm"
                 >
                   <Video className="w-5 h-5 fill-current" />
                   New meeting
                 </button>

                <div className="flex items-center gap-2 relative">
                  <div className="relative group">
                    <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                      <Keyboard className="w-5 h-5 text-gray-500 group-focus-within:text-blue-600" />
                    </div>
                    <input
                      type="text"
                      placeholder="Enter a code or link"
                      className="pl-10 pr-4 py-3 w-64 border border-gray-500 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent text-gray-700 font-medium placeholder:font-normal placeholder:text-gray-500"
                      value={roomCode}
                      onChange={(e) => setRoomCode(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
                    />
                  </div>
                  <button 
                    onClick={handleJoin}
                    disabled={!roomCode}
                    className={`font-medium px-4 py-3 rounded-md transition-colors ${
                      roomCode 
                      ? 'text-blue-600 hover:bg-blue-50' 
                      : 'text-gray-300 cursor-not-allowed'
                    }`}
                  >
                    Join
                  </button>
                </div>
              </div>
              
              <div className="pt-8 border-b border-gray-300 w-full"></div>
              <div className="pt-2">
                 <a href="#" className="text-blue-600 hover:underline text-sm font-medium">Learn more</a> <span className="text-gray-500 text-sm">about Google Meet</span>
              </div>
            </div>

            <div className="flex flex-col items-center justify-center space-y-8">
              <div className="flex items-center w-full justify-center gap-4">
                <button className="p-3 hover:bg-gray-100 rounded-full border border-gray-200 text-gray-600 hidden md:block">
                  <ChevronLeft className="w-6 h-6" />
                </button>

                <div className="flex flex-col items-center text-center space-y-6 max-w-sm">
                    <div className="w-64 h-64 md:w-80 md:h-80 bg-blue-50 rounded-full flex items-center justify-center overflow-hidden mb-2 relative">
                        <div className="absolute inset-0 bg-blue-100/50 rounded-full"></div>
                        <img 
                           src="https://img.freepik.com/free-vector/video-conferencing-concept-illustration_114360-1596.jpg" 
                           alt="Meeting Illustration"
                           className="w-48 h-48 object-cover mix-blend-multiply opacity-80"
                        />
                        <div className="absolute top-1/2 bg-blue-500 p-2 rounded-full shadow-lg">
                           <LinkIcon className="w-6 h-6 text-white" />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <h2 className="text-2xl text-gray-900">Get a link you can share</h2>
                        <p className="text-gray-600 text-sm md:text-base">
                            Click <span className="font-bold">New meeting</span> to get a link you can send to people you want to meet with
                        </p>
                    </div>
                </div>

                <button className="p-3 hover:bg-gray-100 rounded-full border border-gray-200 text-gray-600 hidden md:block">
                  <ChevronRight className="w-6 h-6" />
                </button>
              </div>

              <div className="flex gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-600"></div>
                <div className="w-1.5 h-1.5 rounded-full bg-gray-300"></div>
                <div className="w-1.5 h-1.5 rounded-full bg-gray-300"></div>
              </div>
            </div>

          </div>
        </main>
      </div>
    </div>
  );
};