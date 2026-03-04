import { createRoot } from 'react-dom/client';
import gsap from 'gsap';
import { Flip } from 'gsap/Flip';
import './index.css';
import App from './App.tsx';

gsap.registerPlugin(Flip);

createRoot(document.getElementById('root')!).render(
    <App />
);
