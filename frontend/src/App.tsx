import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { JoinRoom } from './pages/JoinRoom';
import { Room } from './pages/Room';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<JoinRoom />} />
        <Route path="/room/:roomId" element={<Room />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}