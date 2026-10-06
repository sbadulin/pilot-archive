import { createRoot } from 'react-dom/client';
import App from './app';
import { AgeGate } from './ageGate';
import './style.css';
createRoot(document.getElementById('root')!).render(<AgeGate><App /></AgeGate>);
